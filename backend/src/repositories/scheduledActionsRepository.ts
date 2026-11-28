import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type ActionType = 'INVITATION' | 'REMINDER' | 'CLOSURE';
export type ActionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export function createDocumentClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({}));
}

export function toActionId(actionType: ActionType, matchId: string): string {
  return `${actionType}#${matchId}`;
}

/**
 * Attempts to claim a scheduled action with a conditional write. Returns
 * true if this call claimed it, false if it is already claimed and
 * in-flight or done (PROCESSING/COMPLETED) - the caller should treat
 * false as a no-op, not an error, so duplicate coordinator runs never
 * duplicate sends. A previously FAILED action can be reclaimed and
 * retried; a brand new action can always be claimed.
 */
export async function claimAction(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  action: { actionType: ActionType; matchId: string; scheduledFor: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { actionId: toActionId(action.actionType, action.matchId) },
        UpdateExpression: 'SET matchId = :matchId, actionType = :actionType, #status = :processing, scheduledFor = :scheduledFor, startedAt = :now ADD attemptCount :one',
        ConditionExpression: 'attribute_not_exists(actionId) OR #status = :failed',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':matchId': action.matchId,
          ':actionType': action.actionType,
          ':processing': 'PROCESSING' satisfies ActionStatus,
          ':failed': 'FAILED' satisfies ActionStatus,
          ':scheduledFor': action.scheduledFor,
          ':now': now,
          ':one': 1,
        },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

export async function markActionCompleted(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  actionType: ActionType,
  matchId: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { actionId: toActionId(actionType, matchId) },
      UpdateExpression: 'SET #status = :completed, completedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':completed': 'COMPLETED' satisfies ActionStatus, ':now': new Date().toISOString() },
    }),
  );
}

export async function markActionFailed(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  actionType: ActionType,
  matchId: string,
  sanitizedErrorSummary: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { actionId: toActionId(actionType, matchId) },
      UpdateExpression: 'SET #status = :failed, lastError = :err ADD attemptCount :one',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':failed': 'FAILED' satisfies ActionStatus, ':err': sanitizedErrorSummary, ':one': 1 },
    }),
  );
}

/** A match snapshot kept with a hand-sent invitation, so the hourly closing check needs no schedule fetch. */
export interface ManualInvitationMatch {
  matchId: string;
  seasonId: string;
  matchDate: string;
  time: string;
  opponent: string;
  competition: string;
  ground: string;
}

export interface ActionRecord {
  status: ActionStatus;
  /** ISO instant availability closes, only on a hand-sent invitation with its own closing time. */
  closesAt?: string;
  match?: ManualInvitationMatch;
  requestedBy?: string;
}

export async function getAction(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  actionType: ActionType,
  matchId: string,
): Promise<ActionRecord | null> {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: { actionId: toActionId(actionType, matchId) } }));
  const item = result.Item;
  if (!item?.status) return null;
  return { status: item.status as ActionStatus, closesAt: item.closesAt as string | undefined, match: item.match as ManualInvitationMatch | undefined, requestedBy: item.requestedBy as string | undefined };
}

/**
 * Claims the INVITATION action for a captain's "send invitations now",
 * with the same rule as claimAction (new or FAILED only) so it can never
 * race the daily coordinator into a double send. Records who asked, the
 * match, and - when the normal deadline has already gone - its own
 * closing time.
 */
export async function claimManualInvitation(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  input: { match: ManualInvitationMatch; closesAt: string | null; requestedBy: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  const values: Record<string, unknown> = {
    ':matchId': input.match.matchId,
    ':actionType': 'INVITATION' satisfies ActionType,
    ':processing': 'PROCESSING' satisfies ActionStatus,
    ':failed': 'FAILED' satisfies ActionStatus,
    ':now': now,
    ':one': 1,
    ':match': input.match,
    ':requestedBy': input.requestedBy,
    ':manual': 'MANUAL',
  };
  let set = 'SET matchId = :matchId, actionType = :actionType, #status = :processing, scheduledFor = :now, startedAt = :now, #match = :match, requestedBy = :requestedBy, #trigger = :manual';
  let remove = '';
  if (input.closesAt) {
    set += ', closesAt = :closesAt';
    values[':closesAt'] = input.closesAt;
  } else {
    remove = ' REMOVE closesAt';
  }
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { actionId: toActionId('INVITATION', input.match.matchId) },
        UpdateExpression: `${set}${remove} ADD attemptCount :one`,
        ConditionExpression: 'attribute_not_exists(actionId) OR #status = :failed',
        ExpressionAttributeNames: { '#status': 'status', '#match': 'match', '#trigger': 'trigger' },
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

/** Hand-sent invitations that carry their own closing time - what the hourly closing check looks at. */
export async function listCustomClosings(docClient: DynamoDBDocumentClient, tableName: string): Promise<Array<ActionRecord & { match: ManualInvitationMatch; closesAt: string }>> {
  const found: Array<ActionRecord & { match: ManualInvitationMatch; closesAt: string }> = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'actionType = :invitation AND attribute_exists(closesAt) AND attribute_exists(#match)',
        ExpressionAttributeNames: { '#match': 'match' },
        ExpressionAttributeValues: { ':invitation': 'INVITATION' },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      found.push({ status: item.status as ActionStatus, closesAt: item.closesAt as string, match: item.match as ManualInvitationMatch, requestedBy: item.requestedBy as string | undefined });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return found;
}

export async function getActionStatus(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  actionType: ActionType,
  matchId: string,
): Promise<ActionStatus | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { actionId: toActionId(actionType, matchId) },
    }),
  );
  return (result.Item?.status as ActionStatus | undefined) ?? null;
}

import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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

import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type Availability = 'NOT_SUBMITTED' | 'AVAILABLE' | 'UNAVAILABLE' | 'MAYBE';

export interface InvitationRecord {
  matchId: string;
  playerEmail: string;
  playerName: string;
  availability: Availability;
  comments?: string;
  tokenHash: string;
  /** Unix seconds. Also doubles as the submission deadline for this match. */
  tokenExpiry: number;
  invitationSentAt: string;
  reminderSentAt?: string;
  submittedAt?: string;
  updatedAt?: string;
  createdAt: string;
  /** Match snapshot at invitation time - there is no separate Matches table (see plan doc Phase 2). */
  opponent: string;
  competition: string;
  matchDate: string;
  /** Optional: absent on records created before these fields were added. */
  time?: string;
  ground?: string;
  /** Set by the captain's squad-selection UI. Absent means not selected. */
  selected?: boolean;
  selectedAt?: string;
}

export async function createInvitation(docClient: DynamoDBDocumentClient, tableName: string, record: InvitationRecord): Promise<void> {
  await docClient.send(new PutCommand({ TableName: tableName, Item: record }));
}

export async function getInvitation(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  matchId: string,
  playerEmail: string,
): Promise<InvitationRecord | null> {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: { matchId, playerEmail } }));
  return (result.Item as InvitationRecord | undefined) ?? null;
}

export async function findByTokenHash(docClient: DynamoDBDocumentClient, tableName: string, tokenHash: string): Promise<InvitationRecord | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'TokenLookupIndex',
      KeyConditionExpression: 'tokenHash = :tokenHash',
      ExpressionAttributeValues: { ':tokenHash': tokenHash },
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as InvitationRecord | undefined) ?? null;
}

/** All MatchAvailability rows for a match - used by reminders and the closure summary. */
export async function listByMatch(docClient: DynamoDBDocumentClient, tableName: string, matchId: string): Promise<InvitationRecord[]> {
  const records: InvitationRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'matchId = :matchId',
        ExpressionAttributeValues: { ':matchId': matchId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    records.push(...((result.Items as InvitationRecord[] | undefined) ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return records;
}

/**
 * Every row across every match - used by the admin panel to build the match
 * list (small table, no GSI by design per the plan doc, so a full scan is
 * the simplest option; see ceylon-sharks-admin-panel-idea.md).
 */
export async function scanAllInvitations(docClient: DynamoDBDocumentClient, tableName: string): Promise<InvitationRecord[]> {
  const records: InvitationRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: exclusiveStartKey }));
    records.push(...((result.Items as InvitationRecord[] | undefined) ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return records;
}

/**
 * Only the token hash is ever persisted (section 7), so a reminder cannot
 * resend the original link - it must mint a fresh token and overwrite the
 * stored hash, which the plan doc explicitly allows ("If a new token is
 * generated, invalidate the previous token hash").
 */
export async function markReminderSent(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  matchId: string,
  playerEmail: string,
  tokenHash: string,
  reminderSentAt: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { matchId, playerEmail },
      UpdateExpression: 'SET tokenHash = :tokenHash, reminderSentAt = :reminderSentAt',
      ExpressionAttributeValues: { ':tokenHash': tokenHash, ':reminderSentAt': reminderSentAt },
    }),
  );
}

export async function setSelection(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  matchId: string,
  playerEmail: string,
  selected: boolean,
  now: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { matchId, playerEmail },
      UpdateExpression: 'SET selected = :selected, selectedAt = :now',
      ExpressionAttributeValues: { ':selected': selected, ':now': now },
    }),
  );
}

/** Preserves the original submittedAt on repeat updates (section 8.2 step 7 of the plan doc). */
export async function updateAvailability(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  matchId: string,
  playerEmail: string,
  availability: Availability,
  comments: string | undefined,
  now: string,
): Promise<InvitationRecord> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { matchId, playerEmail },
      UpdateExpression: 'SET availability = :availability, comments = :comments, updatedAt = :now, submittedAt = if_not_exists(submittedAt, :now)',
      ExpressionAttributeValues: { ':availability': availability, ':comments': comments ?? '', ':now': now },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as InvitationRecord;
}

import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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

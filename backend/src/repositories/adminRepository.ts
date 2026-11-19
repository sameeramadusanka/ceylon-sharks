import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface AdminLoginCode {
  email: string;
  codeHash: string;
  /** Unix seconds - also the DynamoDB TTL attribute, so an expired code self-deletes. */
  expiresAt: number;
  attempts: number;
}

export interface AdminSession {
  sessionTokenHash: string;
  email: string;
  /** Unix seconds - also the DynamoDB TTL attribute. */
  expiresAt: number;
}

export async function isAllowlisted(docClient: DynamoDBDocumentClient, tableName: string, email: string): Promise<boolean> {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: { email } }));
  return result.Item !== undefined;
}

/** Overwrites any existing code for this email, resetting attempts to 0. */
export async function putLoginCode(docClient: DynamoDBDocumentClient, tableName: string, email: string, codeHash: string, expiresAt: number): Promise<void> {
  await docClient.send(new PutCommand({ TableName: tableName, Item: { email, codeHash, expiresAt, attempts: 0 } }));
}

export async function getLoginCode(docClient: DynamoDBDocumentClient, tableName: string, email: string): Promise<AdminLoginCode | null> {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: { email } }));
  return (result.Item as AdminLoginCode | undefined) ?? null;
}

export async function incrementLoginCodeAttempts(docClient: DynamoDBDocumentClient, tableName: string, email: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { email },
      UpdateExpression: 'ADD attempts :one',
      ExpressionAttributeValues: { ':one': 1 },
    }),
  );
}

/** Deleted once consumed by a successful verify, so a code can never be replayed. */
export async function deleteLoginCode(docClient: DynamoDBDocumentClient, tableName: string, email: string): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: tableName, Key: { email } }));
}

export async function createSession(docClient: DynamoDBDocumentClient, tableName: string, sessionTokenHash: string, email: string, expiresAt: number): Promise<void> {
  await docClient.send(new PutCommand({ TableName: tableName, Item: { sessionTokenHash, email, expiresAt } }));
}

export async function getSession(docClient: DynamoDBDocumentClient, tableName: string, sessionTokenHash: string): Promise<AdminSession | null> {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: { sessionTokenHash } }));
  return (result.Item as AdminSession | undefined) ?? null;
}

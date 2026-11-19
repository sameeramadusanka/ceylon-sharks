import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession, deleteLoginCode, getLoginCode, getSession, incrementLoginCodeAttempts, isAllowlisted, putLoginCode } from '../src/repositories/adminRepository.js';

const ALLOWLIST_TABLE = 'AdminAllowlist';
const CODES_TABLE = 'AdminLoginCodes';
const SESSIONS_TABLE = 'AdminSessions';
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());
afterEach(() => ddbMock.reset());

describe('isAllowlisted', () => {
  it('returns true when the email has an allowlist item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { email: 'captain@example.com', name: 'Captain', addedAt: '2026-11-19T00:00:00.000Z' } });
    const result = await isAllowlisted(ddbMock as unknown as DynamoDBDocumentClient, ALLOWLIST_TABLE, 'captain@example.com');
    expect(result).toBe(true);
  });

  it('returns false when no item is found', async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await isAllowlisted(ddbMock as unknown as DynamoDBDocumentClient, ALLOWLIST_TABLE, 'nobody@example.com');
    expect(result).toBe(false);
  });
});

describe('putLoginCode / getLoginCode', () => {
  it('puts a code with attempts reset to 0', async () => {
    ddbMock.on(PutCommand).resolves({});
    await putLoginCode(ddbMock as unknown as DynamoDBDocumentClient, CODES_TABLE, 'captain@example.com', 'hash123', 1234567890);
    const call = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(call.TableName).toBe(CODES_TABLE);
    expect(call.Item).toEqual({ email: 'captain@example.com', codeHash: 'hash123', expiresAt: 1234567890, attempts: 0 });
  });

  it('returns the stored code when found', async () => {
    const item = { email: 'captain@example.com', codeHash: 'hash123', expiresAt: 1234567890, attempts: 2 };
    ddbMock.on(GetCommand).resolves({ Item: item });
    const result = await getLoginCode(ddbMock as unknown as DynamoDBDocumentClient, CODES_TABLE, 'captain@example.com');
    expect(result).toEqual(item);
  });

  it('returns null when no code exists', async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await getLoginCode(ddbMock as unknown as DynamoDBDocumentClient, CODES_TABLE, 'captain@example.com');
    expect(result).toBeNull();
  });
});

describe('incrementLoginCodeAttempts', () => {
  it('issues an ADD update on attempts', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await incrementLoginCodeAttempts(ddbMock as unknown as DynamoDBDocumentClient, CODES_TABLE, 'captain@example.com');
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.Key).toEqual({ email: 'captain@example.com' });
    expect(call.UpdateExpression).toBe('ADD attempts :one');
  });
});

describe('deleteLoginCode', () => {
  it('deletes the code item by email', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await deleteLoginCode(ddbMock as unknown as DynamoDBDocumentClient, CODES_TABLE, 'captain@example.com');
    const call = ddbMock.commandCalls(DeleteCommand)[0].args[0].input;
    expect(call.TableName).toBe(CODES_TABLE);
    expect(call.Key).toEqual({ email: 'captain@example.com' });
  });
});

describe('createSession / getSession', () => {
  it('puts a session keyed by the token hash', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, 'sessionHash', 'captain@example.com', 1234567890);
    const call = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(call.Item).toEqual({ sessionTokenHash: 'sessionHash', email: 'captain@example.com', expiresAt: 1234567890 });
  });

  it('returns the session when found', async () => {
    const item = { sessionTokenHash: 'sessionHash', email: 'captain@example.com', expiresAt: 1234567890 };
    ddbMock.on(GetCommand).resolves({ Item: item });
    const result = await getSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, 'sessionHash');
    expect(result).toEqual(item);
  });

  it('returns null when no session exists', async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await getSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, 'missingHash');
    expect(result).toBeNull();
  });
});

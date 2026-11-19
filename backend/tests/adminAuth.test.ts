import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractBearerToken, resolveAdminSession } from '../src/adminAuth.js';
import { hashToken } from '../src/token.js';

const SESSIONS_TABLE = 'AdminSessions';
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());
afterEach(() => ddbMock.reset());

describe('extractBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('returns null when the header is missing', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null when the header lacks the Bearer prefix', () => {
    expect(extractBearerToken('abc123')).toBeNull();
  });

  it('returns null when only "Bearer " is present with no token', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
  });
});

describe('resolveAdminSession', () => {
  it('returns null when there is no Authorization header', async () => {
    const result = await resolveAdminSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, undefined);
    expect(result).toBeNull();
  });

  it('returns null when the session does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await resolveAdminSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, 'Bearer sometoken');
    expect(result).toBeNull();
  });

  it('returns null when the session has expired', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { sessionTokenHash: hashToken('sometoken'), email: 'captain@example.com', expiresAt: Math.floor(Date.now() / 1000) - 10 },
    });
    const result = await resolveAdminSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, 'Bearer sometoken');
    expect(result).toBeNull();
  });

  it('returns the email for a valid, unexpired session', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { sessionTokenHash: hashToken('sometoken'), email: 'captain@example.com', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
    });
    const result = await resolveAdminSession(ddbMock as unknown as DynamoDBDocumentClient, SESSIONS_TABLE, 'Bearer sometoken');
    expect(result).toEqual({ email: 'captain@example.com' });
  });
});

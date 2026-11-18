import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInvitation, findByTokenHash, getInvitation, updateAvailability } from '../src/repositories/matchAvailabilityRepository.js';

const TABLE = 'MatchAvailability';
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());
afterEach(() => ddbMock.reset());

const RECORD = {
  matchId: 'match-1',
  playerEmail: 'player@example.com',
  playerName: 'Sam Rivera',
  availability: 'NOT_SUBMITTED' as const,
  tokenHash: 'hash123',
  tokenExpiry: 1234567890,
  invitationSentAt: '2026-11-19T00:00:00.000Z',
  createdAt: '2026-11-19T00:00:00.000Z',
  opponent: 'Cool Stars',
  competition: 'League',
  matchDate: '2026-11-28',
};

describe('createInvitation', () => {
  it('puts the full record', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createInvitation(ddbMock as unknown as DynamoDBDocumentClient, TABLE, RECORD);
    const call = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(call.TableName).toBe(TABLE);
    expect(call.Item).toEqual(RECORD);
  });
});

describe('getInvitation', () => {
  it('returns the item when found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: RECORD });
    const result = await getInvitation(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'match-1', 'player@example.com');
    expect(result).toEqual(RECORD);
  });

  it('returns null when not found', async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await getInvitation(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'match-1', 'player@example.com');
    expect(result).toBeNull();
  });
});

describe('findByTokenHash', () => {
  it('queries the TokenLookupIndex and returns the first match', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [RECORD] });
    const result = await findByTokenHash(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'hash123');
    expect(result).toEqual(RECORD);
    const call = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(call.IndexName).toBe('TokenLookupIndex');
  });

  it('returns null when no item matches the token', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = await findByTokenHash(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'missing');
    expect(result).toBeNull();
  });
});

describe('updateAvailability', () => {
  it('preserves submittedAt via if_not_exists and sets updatedAt', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { ...RECORD, availability: 'AVAILABLE' } });
    await updateAvailability(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'match-1', 'player@example.com', 'AVAILABLE', 'can play', '2026-11-20T00:00:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.UpdateExpression).toContain('if_not_exists(submittedAt, :now)');
    expect(call.ExpressionAttributeValues?.[':availability']).toBe('AVAILABLE');
    expect(call.ExpressionAttributeValues?.[':comments']).toBe('can play');
  });

  it('defaults comments to an empty string when omitted', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: RECORD });
    await updateAvailability(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'match-1', 'player@example.com', 'UNAVAILABLE', undefined, '2026-11-20T00:00:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.ExpressionAttributeValues?.[':comments']).toBe('');
  });
});

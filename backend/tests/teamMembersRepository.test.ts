import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listActiveMembers } from '../src/repositories/teamMembersRepository.js';

const TABLE = 'TeamMembers';
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());
afterEach(() => ddbMock.reset());

describe('listActiveMembers', () => {
  it('filters to active members only via FilterExpression', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ email: 'a@example.com', name: 'A', role: 'PLAYER', isActive: true }] });
    const members = await listActiveMembers(ddbMock as unknown as DynamoDBDocumentClient, TABLE);
    expect(members).toHaveLength(1);
    const call = ddbMock.commandCalls(ScanCommand)[0].args[0].input;
    expect(call.FilterExpression).toBe('isActive = :active');
  });

  it('pages through LastEvaluatedKey until exhausted', async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({ Items: [{ email: 'a@example.com', name: 'A', role: 'PLAYER', isActive: true }], LastEvaluatedKey: { email: 'a@example.com' } })
      .resolvesOnce({ Items: [{ email: 'b@example.com', name: 'B', role: 'PLAYER', isActive: true }] });

    const members = await listActiveMembers(ddbMock as unknown as DynamoDBDocumentClient, TABLE);
    expect(members.map((m) => m.email)).toEqual(['a@example.com', 'b@example.com']);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(2);
  });

  it('returns an empty array when the table is empty', async () => {
    ddbMock.on(ScanCommand).resolves({});
    const members = await listActiveMembers(ddbMock as unknown as DynamoDBDocumentClient, TABLE);
    expect(members).toEqual([]);
  });
});

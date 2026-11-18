import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimAction, getActionStatus, markActionCompleted, markActionFailed, toActionId } from '../src/repositories/scheduledActionsRepository.js';

const TABLE = 'ScheduledActions';
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

afterEach(() => {
  ddbMock.reset();
});

describe('toActionId', () => {
  it('builds the deterministic actionId', () => {
    expect(toActionId('INVITATION', 'abc123')).toBe('INVITATION#abc123');
  });
});

describe('claimAction', () => {
  it('returns true when the conditional write succeeds', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const claimed = await claimAction(ddbMock as unknown as DynamoDBDocumentClient, TABLE, {
      actionType: 'INVITATION',
      matchId: 'match-1',
      scheduledFor: '2026-11-19T00:00:00.000Z',
    });
    expect(claimed).toBe(true);
  });

  it('returns false (not an error) when the action is already claimed', async () => {
    ddbMock.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: 'condition failed', $metadata: {} }));
    const claimed = await claimAction(ddbMock as unknown as DynamoDBDocumentClient, TABLE, {
      actionType: 'INVITATION',
      matchId: 'match-1',
      scheduledFor: '2026-11-19T00:00:00.000Z',
    });
    expect(claimed).toBe(false);
  });

  it('propagates unexpected errors instead of swallowing them', async () => {
    ddbMock.on(UpdateCommand).rejects(new Error('network blip'));
    await expect(
      claimAction(ddbMock as unknown as DynamoDBDocumentClient, TABLE, { actionType: 'INVITATION', matchId: 'match-1', scheduledFor: 'now' }),
    ).rejects.toThrow('network blip');
  });

  it('allows a previously FAILED action to be reclaimed', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const claimed = await claimAction(ddbMock as unknown as DynamoDBDocumentClient, TABLE, {
      actionType: 'CLOSURE',
      matchId: 'match-2',
      scheduledFor: 'now',
    });
    expect(claimed).toBe(true);
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.ConditionExpression).toContain('attribute_not_exists(actionId)');
    expect(call.ConditionExpression).toContain('#status = :failed');
  });
});

describe('markActionCompleted / markActionFailed', () => {
  it('sets status to COMPLETED', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await markActionCompleted(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'REMINDER', 'match-1');
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.ExpressionAttributeValues?.[':completed']).toBe('COMPLETED');
  });

  it('sets status to FAILED with a sanitised error summary', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await markActionFailed(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'REMINDER', 'match-1', 'SES send failed');
    const call = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(call.ExpressionAttributeValues?.[':err']).toBe('SES send failed');
  });
});

describe('getActionStatus', () => {
  it('returns the status when the item exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { status: 'COMPLETED' } });
    const status = await getActionStatus(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'INVITATION', 'match-1');
    expect(status).toBe('COMPLETED');
  });

  it('returns null when the item does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const status = await getActionStatus(ddbMock as unknown as DynamoDBDocumentClient, TABLE, 'INVITATION', 'match-1');
    expect(status).toBeNull();
  });
});

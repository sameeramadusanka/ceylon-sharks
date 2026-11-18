import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/validateAvailability.js';
import { hashToken } from '../src/token.js';

const ENV = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main',
  AVAILABILITY_FRONTEND_URL: 'https://ceylonsharks.com',
  SES_FROM_EMAIL: 'noreply@ceylonsharks.com',
  CAPTAIN_EMAIL: 'captain@example.com',
  VICE_CAPTAIN_EMAIL: 'vice@example.com',
  TIME_ZONE: 'Asia/Singapore',
  INVITATION_DAYS_BEFORE: '5',
  REMINDER_DAYS_BEFORE: '3',
  CLOSURE_DAYS_BEFORE: '2',
  CLOSURE_LOCAL_TIME: '23:59',
};

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  Object.assign(process.env, ENV);
});

afterEach(() => ddbMock.reset());

function fakeEvent(queryStringParameters: Record<string, string> | undefined): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/availability/validate',
    rawQueryString: '',
    headers: {},
    queryStringParameters,
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'GET', path: '/availability/validate', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function parseBody(response: unknown): Record<string, unknown> {
  return JSON.parse((response as { body: string }).body);
}

describe('validateAvailability handler', () => {
  it('returns 400 when the token is missing', async () => {
    const response = (await handler(fakeEvent(undefined), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 401 when no record matches the token', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const response = (await handler(fakeEvent({ token: 'bad-token' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(401);
  });

  it('returns 410 once the deadline has passed', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ matchId: 'm1', playerEmail: 'p@example.com', playerName: 'Sam', availability: 'NOT_SUBMITTED', tokenExpiry: Math.floor(Date.now() / 1000) - 10, opponent: 'X', competition: 'League', matchDate: '2026-11-28' }],
    });
    const response = (await handler(fakeEvent({ token: 'expired' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(410);
  });

  it('returns match/player details (no email or token) on a valid token', async () => {
    const rawToken = 'valid-raw-token';
    ddbMock.on(QueryCommand).resolves({
      Items: [{
        matchId: 'm1',
        playerEmail: 'p@example.com',
        playerName: 'Sam Rivera',
        availability: 'MAYBE',
        tokenHash: hashToken(rawToken),
        tokenExpiry: Math.floor(Date.now() / 1000) + 10_000,
        opponent: 'Cool Stars',
        competition: 'League',
        matchDate: '2026-11-28',
      }],
    });

    const response = (await handler(fakeEvent({ token: rawToken }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = parseBody(response);
    expect(body.valid).toBe(true);
    expect(body.playerName).toBe('Sam Rivera');
    expect(body.currentAvailability).toBe('MAYBE');
    expect(JSON.stringify(body)).not.toContain('p@example.com');
    expect(JSON.stringify(body)).not.toContain(rawToken);
  });

  it('returns 500 without leaking internal error details when the lookup throws', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));
    const response = (await handler(fakeEvent({ token: 'x' }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

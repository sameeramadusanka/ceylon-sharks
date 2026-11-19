import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/adminMatchDetail.js';
import { hashToken } from '../src/token.js';

const ENV = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  ADMIN_ALLOWLIST_TABLE: 'AdminAllowlist',
  ADMIN_LOGIN_CODES_TABLE: 'AdminLoginCodes',
  ADMIN_SESSIONS_TABLE: 'AdminSessions',
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
const VALID_SESSION_TOKEN = 'valid-session-token';

beforeEach(() => {
  ddbMock.reset();
  Object.assign(process.env, ENV);
});

afterEach(() => ddbMock.reset());

function fakeEvent(matchId: string | undefined, authorization?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: `/admin/matches/${matchId ?? ''}`,
    rawQueryString: '',
    headers: authorization ? { authorization } : {},
    pathParameters: matchId ? { matchId } : undefined,
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'GET', path: '/admin/matches/{matchId}', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function parseBody(response: unknown): Record<string, unknown> {
  return JSON.parse((response as { body: string }).body);
}

function validSession() {
  return { sessionTokenHash: hashToken(VALID_SESSION_TOKEN), email: 'captain@example.com', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
}

describe('adminMatchDetail handler', () => {
  it('returns 400 when matchId is missing', async () => {
    const response = (await handler(fakeEvent(undefined, `Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 401 when there is no valid session', async () => {
    ddbMock.on(GetCommand).resolves({});
    const response = (await handler(fakeEvent('m1'), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 when the match has no records', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const response = (await handler(fakeEvent('missing-match', `Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(404);
  });

  it('returns the match summary with players sorted by name', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { matchId: 'm1', playerEmail: 'b@example.com', playerName: 'Bravo', availability: 'AVAILABLE', opponent: 'Cool Stars', competition: 'League', matchDate: '2026-11-07' },
        { matchId: 'm1', playerEmail: 'a@example.com', playerName: 'Alpha', availability: 'MAYBE', opponent: 'Cool Stars', competition: 'League', matchDate: '2026-11-07' },
      ],
    });

    const response = (await handler(fakeEvent('m1', `Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = parseBody(response) as { totalInvited: number; counts: Record<string, number>; players: Array<{ playerName: string }> };
    expect(body.totalInvited).toBe(2);
    expect(body.counts).toEqual({ AVAILABLE: 1, UNAVAILABLE: 0, MAYBE: 1, NOT_SUBMITTED: 0 });
    expect(body.players.map((p) => p.playerName)).toEqual(['Alpha', 'Bravo']);
  });

  it('returns 500 without leaking internal error details when the query throws', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));
    const response = (await handler(fakeEvent('m1', `Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

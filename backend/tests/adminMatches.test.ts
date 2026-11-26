import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/adminMatches.js';
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

function fakeEvent(authorization?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/admin/matches',
    rawQueryString: '',
    headers: authorization ? { authorization } : {},
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'GET', path: '/admin/matches', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
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

describe('adminMatches handler', () => {
  it('returns 401 when there is no session', async () => {
    ddbMock.on(GetCommand).resolves({});
    const response = (await handler(fakeEvent(), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(401);
  });

  it('returns matches grouped by matchId, most recent first, with per-status counts', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { matchId: 'm1', playerEmail: 'a@example.com', availability: 'AVAILABLE', opponent: 'Cool Stars', competition: 'League', matchDate: '2026-11-07' },
        { matchId: 'm1', playerEmail: 'b@example.com', availability: 'UNAVAILABLE', opponent: 'Cool Stars', competition: 'League', matchDate: '2026-11-07' },
        { matchId: 'm2', playerEmail: 'a@example.com', availability: 'NOT_SUBMITTED', opponent: 'Hot Rockets', competition: 'League', matchDate: '2026-11-14' },
      ],
    });

    const response = (await handler(fakeEvent(`Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = parseBody(response) as { matches: Array<{ matchId: string; totalInvited: number; counts: Record<string, number> }> };
    expect(body.matches).toHaveLength(2);
    expect(body.matches[0].matchId).toBe('m2');
    expect(body.matches[1].matchId).toBe('m1');
    expect(body.matches[1].totalInvited).toBe(2);
    expect(body.matches[1].counts).toEqual({ AVAILABLE: 1, UNAVAILABLE: 1, MAYBE: 0, NOT_SUBMITTED: 0 });
  });

  it('tells the page whether the signed-in admin may publish Player of the Week', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    ddbMock.on(GetCommand).resolves({ Item: { ...validSession(), email: 'another-admin@example.com' } });
    const other = (await handler(fakeEvent(`Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { body: string };
    expect(parseBody(other).canPublishPlayerOfTheWeek).toBe(false);

    ddbMock.on(GetCommand).resolves({ Item: { ...validSession(), email: 'vice@example.com' } });
    const vice = (await handler(fakeEvent(`Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { body: string };
    expect(parseBody(vice).canPublishPlayerOfTheWeek).toBe(true);
  });

  it('returns 500 without leaking internal error details when the scan throws', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(ScanCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));
    const response = (await handler(fakeEvent(`Bearer ${VALID_SESSION_TOKEN}`), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

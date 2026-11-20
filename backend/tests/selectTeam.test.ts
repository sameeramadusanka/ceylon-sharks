import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../src/token.js';

const sendEmailMock = vi.fn();
vi.mock('../src/email/sesClient.js', () => ({
  createSesClient: vi.fn(() => ({})),
  sendEmail: sendEmailMock,
}));

const { handler } = await import('../src/handlers/selectTeam.js');

const CAPTAIN_SELECTION_EMAIL = 'test-captain@example.com';
const TEST_RECIPIENT_EMAIL = 'test-inbox@example.com';

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
  TEAM_SELECTION_CAPTAIN_EMAIL: CAPTAIN_SELECTION_EMAIL,
  TEAM_SELECTION_TEST_RECIPIENT_EMAIL: '',
};

const ddbMock = mockClient(DynamoDBDocumentClient);
const VALID_SESSION_TOKEN = 'valid-session-token';

function validSession(email = CAPTAIN_SELECTION_EMAIL) {
  return { sessionTokenHash: hashToken(VALID_SESSION_TOKEN), email, expiresAt: Math.floor(Date.now() / 1000) + 3600 };
}

function invitationRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    matchId: 'm1',
    playerEmail: 'alpha@example.com',
    playerName: 'Alpha',
    availability: 'AVAILABLE',
    opponent: 'Cool Stars',
    competition: 'League',
    matchDate: '2026-11-28',
    time: '14:00',
    ground: 'Padang A',
    ...overrides,
  };
}

beforeEach(() => {
  ddbMock.reset();
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  Object.assign(process.env, ENV);
  vi.useFakeTimers();
});

afterEach(() => {
  ddbMock.reset();
  vi.useRealTimers();
});

function fakeEvent(matchId: string | undefined, body: unknown, authorization?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: `/admin/matches/${matchId ?? ''}/selection`,
    rawQueryString: '',
    headers: authorization ? { authorization } : {},
    pathParameters: matchId ? { matchId } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'PUT', path: '/admin/matches/{matchId}/selection', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function parseBody(response: unknown): Record<string, unknown> {
  return JSON.parse((response as { body: string }).body);
}

async function runHandler(event: APIGatewayProxyEventV2) {
  const promise = handler(event, {} as never, () => undefined) as Promise<{ statusCode: number; body: string }>;
  await vi.runAllTimersAsync();
  return promise;
}

describe('selectTeam handler', () => {
  it('returns 400 when matchId is missing', async () => {
    const response = await runHandler(fakeEvent(undefined, { selectedPlayerEmails: [] }, `Bearer ${VALID_SESSION_TOKEN}`));
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for an invalid body', async () => {
    const response = await runHandler(fakeEvent('m1', { selectedPlayerEmails: ['not-an-email'] }, `Bearer ${VALID_SESSION_TOKEN}`));
    expect(response.statusCode).toBe(400);
  });

  it('returns 401 when there is no valid session', async () => {
    ddbMock.on(GetCommand).resolves({});
    const response = await runHandler(fakeEvent('m1', { selectedPlayerEmails: [] }));
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when the signed-in admin is not the selection captain', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession('vice@example.com') });
    const response = await runHandler(fakeEvent('m1', { selectedPlayerEmails: [] }, `Bearer ${VALID_SESSION_TOKEN}`));
    expect(response.statusCode).toBe(403);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the feature is not configured (empty captain email)', async () => {
    process.env.TEAM_SELECTION_CAPTAIN_EMAIL = '';
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    const response = await runHandler(fakeEvent('m1', { selectedPlayerEmails: [] }, `Bearer ${VALID_SESSION_TOKEN}`));
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 when the match has no records', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const response = await runHandler(fakeEvent('missing-match', { selectedPlayerEmails: [] }, `Bearer ${VALID_SESSION_TOKEN}`));
    expect(response.statusCode).toBe(404);
  });

  it('notifies only newly selected players and skips already-selected ones', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).resolves({
      Items: [
        invitationRecord({ playerEmail: 'alpha@example.com', playerName: 'Alpha', selected: true }),
        invitationRecord({ playerEmail: 'bravo@example.com', playerName: 'Bravo' }),
        invitationRecord({ playerEmail: 'charlie@example.com', playerName: 'Charlie' }),
      ],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const response = await runHandler(
      fakeEvent('m1', { selectedPlayerEmails: ['alpha@example.com', 'bravo@example.com'] }, `Bearer ${VALID_SESSION_TOKEN}`),
    );

    expect(response.statusCode).toBe(200);
    const body = parseBody(response) as { selectedCount: number; notifiedCount: number; failedNotifications: string[] };
    expect(body.selectedCount).toBe(2);
    expect(body.notifiedCount).toBe(1);
    expect(body.failedNotifications).toEqual([]);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1].to).toEqual(['bravo@example.com']);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(3);
    const selectedByEmail = new Map(updateCalls.map((call) => [call.args[0].input.Key?.playerEmail, call.args[0].input.ExpressionAttributeValues?.[':selected']]));
    expect(selectedByEmail.get('alpha@example.com')).toBe(true);
    expect(selectedByEmail.get('bravo@example.com')).toBe(true);
    expect(selectedByEmail.get('charlie@example.com')).toBe(false);
  });

  it('redirects notifications to the configured test recipient instead of the real player', async () => {
    process.env.TEAM_SELECTION_TEST_RECIPIENT_EMAIL = TEST_RECIPIENT_EMAIL;
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).resolves({ Items: [invitationRecord({ playerEmail: 'bravo@example.com' })] });
    ddbMock.on(UpdateCommand).resolves({});

    await runHandler(fakeEvent('m1', { selectedPlayerEmails: ['bravo@example.com'] }, `Bearer ${VALID_SESSION_TOKEN}`));

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1].to).toEqual([TEST_RECIPIENT_EMAIL]);
  });

  it('returns 500 without leaking internal error details when the query throws', async () => {
    ddbMock.on(GetCommand).resolves({ Item: validSession() });
    ddbMock.on(QueryCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));
    const response = await runHandler(fakeEvent('m1', { selectedPlayerEmails: [] }, `Bearer ${VALID_SESSION_TOKEN}`));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

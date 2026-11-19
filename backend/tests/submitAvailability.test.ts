import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../src/token.js';

const sendEmailMock = vi.fn();
vi.mock('../src/email/sesClient.js', () => ({
  createSesClient: vi.fn(() => ({})),
  sendEmail: sendEmailMock,
}));

const { handler } = await import('../src/handlers/submitAvailability.js');

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
const VALID_TOKEN = 'valid-raw-token';

function invitationRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    matchId: 'm1',
    playerEmail: 'p@example.com',
    playerName: 'Sam Rivera',
    availability: 'NOT_SUBMITTED',
    tokenHash: hashToken(VALID_TOKEN),
    tokenExpiry: Math.floor(Date.now() / 1000) + 10_000,
    opponent: 'Cool Stars',
    competition: 'League',
    matchDate: '2026-11-28',
    ...overrides,
  };
}

beforeEach(() => {
  ddbMock.reset();
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  Object.assign(process.env, ENV);
});

afterEach(() => ddbMock.reset());

function fakeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/availability/submit',
    rawQueryString: '',
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'POST', path: '/availability/submit', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function parseBody(response: unknown): Record<string, unknown> {
  return JSON.parse((response as { body: string }).body);
}

describe('submitAvailability handler', () => {
  it('returns 400 for malformed JSON', async () => {
    const response = (await handler({ ...fakeEvent(undefined), body: '{not json' } as APIGatewayProxyEventV2, {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for an invalid availability value', async () => {
    const response = (await handler(fakeEvent({ token: VALID_TOKEN, availability: 'MAYBE_NOT_SURE' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 401 when the token does not match any record', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const response = (await handler(fakeEvent({ token: 'unknown', availability: 'AVAILABLE' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(401);
  });

  it('returns 410 once the deadline has passed', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [invitationRecord({ tokenExpiry: Math.floor(Date.now() / 1000) - 10 })] });
    const response = (await handler(fakeEvent({ token: VALID_TOKEN, availability: 'AVAILABLE' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(410);
  });

  it('persists the response, derives identity from the token (ignores a client-supplied email), and notifies the captain/vice-captain', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [invitationRecord()] });
    ddbMock.on(UpdateCommand).resolves({ Attributes: invitationRecord({ availability: 'AVAILABLE' }) });

    const response = (await handler(
      fakeEvent({ token: VALID_TOKEN, availability: 'AVAILABLE', comments: 'can play', playerEmail: 'attacker@example.com' }),
      {} as never,
      () => undefined,
    )) as { statusCode: number; body: string };

    expect(response.statusCode).toBe(200);
    const body = parseBody(response);
    expect(body.success).toBe(true);
    expect(body.availability).toBe('AVAILABLE');

    const updateCall = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(updateCall.Key).toEqual({ matchId: 'm1', playerEmail: 'p@example.com' });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailArgs = sendEmailMock.mock.calls[0][1];
    expect(emailArgs.to).toEqual(['captain@example.com', 'vice@example.com']);
  });

  it('still returns success to the player when the captain-notification email fails', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [invitationRecord()] });
    ddbMock.on(UpdateCommand).resolves({ Attributes: invitationRecord({ availability: 'MAYBE' }) });
    sendEmailMock.mockRejectedValue(new Error('SES unavailable'));

    const response = (await handler(fakeEvent({ token: VALID_TOKEN, availability: 'MAYBE' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(200);
  });

  it('returns 500 without leaking internal error details when persistence throws', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [invitationRecord()] });
    ddbMock.on(UpdateCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));

    const response = (await handler(fakeEvent({ token: VALID_TOKEN, availability: 'AVAILABLE' }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

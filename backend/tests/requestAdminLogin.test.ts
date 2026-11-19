import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmailMock = vi.fn();
vi.mock('../src/email/sesClient.js', () => ({
  createSesClient: vi.fn(() => ({})),
  sendEmail: sendEmailMock,
}));

const { handler } = await import('../src/handlers/requestAdminLogin.js');

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

beforeEach(() => {
  ddbMock.reset();
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  Object.assign(process.env, ENV);
});

afterEach(() => ddbMock.reset());

function fakeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/admin/login/request',
    rawQueryString: '',
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'POST', path: '/admin/login/request', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function parseBody(response: unknown): Record<string, unknown> {
  return JSON.parse((response as { body: string }).body);
}

describe('requestAdminLogin handler', () => {
  it('returns 400 for malformed JSON', async () => {
    const response = (await handler({ ...fakeEvent(undefined), body: '{not json' } as APIGatewayProxyEventV2, {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for an invalid email', async () => {
    const response = (await handler(fakeEvent({ email: 'not-an-email' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('responds with the generic message and sends no email when the address is not allowlisted', async () => {
    ddbMock.on(GetCommand).resolves({});
    const response = (await handler(fakeEvent({ email: 'nobody@example.com' }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    expect(parseBody(response).message).toMatch(/if that email has admin access/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('stores a hashed code and emails it when the address is allowlisted with no recent code', async () => {
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: { email: 'captain@example.com', name: 'Captain', addedAt: '2026-11-19T00:00:00.000Z' } })
      .resolvesOnce({});
    ddbMock.on(PutCommand).resolves({});

    const response = (await handler(fakeEvent({ email: 'CAPTAIN@example.com' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(200);

    const putCall = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(putCall.Item?.email).toBe('captain@example.com');
    expect(putCall.Item?.attempts).toBe(0);
    expect(typeof putCall.Item?.codeHash).toBe('string');

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const emailArgs = sendEmailMock.mock.calls[0][1];
    expect(emailArgs.to).toEqual(['captain@example.com']);
  });

  it('does not resend within the cooldown window of an existing code', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: { email: 'captain@example.com', name: 'Captain', addedAt: '2026-11-19T00:00:00.000Z' } })
      .resolvesOnce({ Item: { email: 'captain@example.com', codeHash: 'existing-hash', expiresAt: nowSeconds + 590, attempts: 0 } });

    const response = (await handler(fakeEvent({ email: 'captain@example.com' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('returns 500 without leaking internal error details when a lookup throws', async () => {
    ddbMock.on(GetCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));
    const response = (await handler(fakeEvent({ email: 'captain@example.com' }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

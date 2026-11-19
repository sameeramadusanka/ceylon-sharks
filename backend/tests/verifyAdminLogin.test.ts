import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/verifyAdminLogin.js';
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
const NOW_SECONDS = Math.floor(Date.now() / 1000);

beforeEach(() => {
  ddbMock.reset();
  Object.assign(process.env, ENV);
});

afterEach(() => ddbMock.reset());

function fakeEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/admin/login/verify',
    rawQueryString: '',
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      http: { method: 'POST', path: '/admin/login/verify', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function parseBody(response: unknown): Record<string, unknown> {
  return JSON.parse((response as { body: string }).body);
}

function loginCodeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'captain@example.com',
    codeHash: hashToken('482913'),
    expiresAt: NOW_SECONDS + 600,
    attempts: 0,
    ...overrides,
  };
}

describe('verifyAdminLogin handler', () => {
  it('returns 400 for malformed JSON', async () => {
    const response = (await handler({ ...fakeEvent(undefined), body: '{not json' } as APIGatewayProxyEventV2, {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when code is missing', async () => {
    const response = (await handler(fakeEvent({ email: 'captain@example.com' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(400);
  });

  it('returns 401 when no code exists for the email', async () => {
    ddbMock.on(GetCommand).resolves({});
    const response = (await handler(fakeEvent({ email: 'captain@example.com', code: '482913' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(401);
  });

  it('returns 410 and deletes the code once it has expired', async () => {
    ddbMock.on(GetCommand).resolves({ Item: loginCodeItem({ expiresAt: NOW_SECONDS - 10 }) });
    ddbMock.on(DeleteCommand).resolves({});
    const response = (await handler(fakeEvent({ email: 'captain@example.com', code: '482913' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(410);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it('returns 429 and deletes the code once attempts are exhausted', async () => {
    ddbMock.on(GetCommand).resolves({ Item: loginCodeItem({ attempts: 5 }) });
    ddbMock.on(DeleteCommand).resolves({});
    const response = (await handler(fakeEvent({ email: 'captain@example.com', code: '482913' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(429);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it('increments attempts and returns 401 on a wrong code', async () => {
    ddbMock.on(GetCommand).resolves({ Item: loginCodeItem() });
    ddbMock.on(UpdateCommand).resolves({});
    const response = (await handler(fakeEvent({ email: 'captain@example.com', code: '000000' }), {} as never, () => undefined)) as { statusCode: number };
    expect(response.statusCode).toBe(401);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('consumes the code and issues a session on a correct code', async () => {
    ddbMock.on(GetCommand).resolves({ Item: loginCodeItem() });
    ddbMock.on(DeleteCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const response = (await handler(fakeEvent({ email: 'captain@example.com', code: '482913' }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = parseBody(response);
    expect(body.success).toBe(true);
    expect(typeof body.sessionToken).toBe('string');
    expect(body.email).toBe('captain@example.com');

    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
    const putCall = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(putCall.Item?.email).toBe('captain@example.com');
  });

  it('returns 500 without leaking internal error details when a lookup throws', async () => {
    ddbMock.on(GetCommand).rejects(new Error('ProvisionedThroughputExceededException: internal detail'));
    const response = (await handler(fakeEvent({ email: 'captain@example.com', code: '482913' }), {} as never, () => undefined)) as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('ProvisionedThroughputExceededException');
  });
});

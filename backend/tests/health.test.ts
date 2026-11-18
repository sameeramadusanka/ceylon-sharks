import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/health.js';

function fakeEvent(): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /availability/health',
    rawPath: '/availability/health',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/availability/health', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' },
      requestId: 'test-request-id',
      routeKey: 'GET /availability/health',
      stage: '$default',
      time: '19/Nov/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe('health handler', () => {
  it('returns 200 with a status and config presence map, no secret values', async () => {
    const response = await handler(fakeEvent(), {} as never, () => undefined);
    expect(response).toBeDefined();
    const result = response as { statusCode: number; body: string };
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('ok');
    expect(typeof body.configPresent).toBe('object');
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });
});

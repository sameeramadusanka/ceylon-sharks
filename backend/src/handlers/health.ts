import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { configPresence } from '../config.js';
import { logger } from '../logger.js';

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info('health check requested', { route: event.rawPath, requestId: event.requestContext.requestId });

  return jsonResponse(200, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    configPresent: configPresence(),
  });
};

import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { logger } from '../logger.js';

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Phase 1 scaffold only. Token validation, DynamoDB lookup via TokenLookupIndex,
 * and expiry/deadline checks land in Phase 3.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info('validate endpoint called (not yet implemented)', {
    route: event.rawPath,
    requestId: event.requestContext.requestId,
  });

  return jsonResponse(501, { valid: false, message: 'Availability validation is not yet implemented.' });
};

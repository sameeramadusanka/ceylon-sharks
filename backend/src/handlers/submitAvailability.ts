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
 * Phase 1 scaffold only. Token-derived identity, conditional write to
 * MatchAvailability, and captain/vice-captain notification land in Phase 3.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info('submit endpoint called (not yet implemented)', {
    route: event.rawPath,
    requestId: event.requestContext.requestId,
  });

  return jsonResponse(501, { success: false, message: 'Availability submission is not yet implemented.' });
};

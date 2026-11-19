import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { findByTokenHash } from '../repositories/matchAvailabilityRepository.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';
import { hashToken } from '../token.js';

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) {
    return jsonResponse(400, { valid: false, message: 'Missing token' });
  }

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();
    const record = await findByTokenHash(docClient, config.matchAvailabilityTable, hashToken(token));

    if (!record) {
      return jsonResponse(401, { valid: false, message: 'Invalid or expired invitation' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds > record.tokenExpiry) {
      return jsonResponse(410, { valid: false, message: 'The submission deadline has passed' });
    }

    return jsonResponse(200, {
      valid: true,
      playerName: record.playerName,
      match: {
        matchId: record.matchId,
        opponent: record.opponent,
        competition: record.competition,
        matchDate: record.matchDate,
        time: record.time,
        ground: record.ground,
      },
      currentAvailability: record.availability,
      deadline: new Date(record.tokenExpiry * 1000).toISOString(),
    });
  } catch (error) {
    logger.error('validate endpoint failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { valid: false, message: 'Unexpected server error' });
  }
};

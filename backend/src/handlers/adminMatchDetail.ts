import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { Availability } from '../repositories/matchAvailabilityRepository.js';
import { resolveAdminSession } from '../adminAuth.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { listByMatch } from '../repositories/matchAvailabilityRepository.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function emptyCounts(): Record<Availability, number> {
  return { AVAILABLE: 0, UNAVAILABLE: 0, MAYBE: 0, NOT_SUBMITTED: 0 };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const matchId = event.pathParameters?.matchId;
  if (!matchId) {
    return jsonResponse(400, { success: false, message: 'Missing matchId' });
  }

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();

    const session = await resolveAdminSession(docClient, config.adminSessionsTable, event.headers.authorization ?? event.headers.Authorization);
    if (!session) {
      return jsonResponse(401, { success: false, message: 'Sign in required' });
    }

    const records = await listByMatch(docClient, config.matchAvailabilityTable, matchId);
    if (records.length === 0) {
      return jsonResponse(404, { success: false, message: 'Match not found' });
    }

    const [first] = records;
    const counts = emptyCounts();
    for (const record of records) counts[record.availability]++;

    const players = records
      .map((record) => ({
        playerEmail: record.playerEmail,
        playerName: record.playerName,
        availability: record.availability,
        comments: record.comments,
        submittedAt: record.submittedAt,
        updatedAt: record.updatedAt,
        selected: record.selected === true,
      }))
      .sort((a, b) => a.playerName.localeCompare(b.playerName));

    const canSelectTeam = Boolean(config.teamSelectionCaptainEmail) && session.email === config.teamSelectionCaptainEmail.toLowerCase();

    return jsonResponse(200, {
      success: true,
      matchId,
      opponent: first.opponent,
      competition: first.competition,
      matchDate: first.matchDate,
      time: first.time,
      ground: first.ground,
      totalInvited: records.length,
      counts,
      players,
      canSelectTeam,
    });
  } catch (error) {
    logger.error('admin match detail endpoint failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { Availability, InvitationRecord } from '../repositories/matchAvailabilityRepository.js';
import { resolveAdminSession } from '../adminAuth.js';
import { canPublishPlayerOfTheWeek, loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { scanAllInvitations } from '../repositories/matchAvailabilityRepository.js';
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

function summarize(records: InvitationRecord[]) {
  const byMatch = new Map<string, InvitationRecord[]>();
  for (const record of records) {
    const bucket = byMatch.get(record.matchId);
    if (bucket) bucket.push(record);
    else byMatch.set(record.matchId, [record]);
  }

  const matches = Array.from(byMatch.entries()).map(([matchId, rows]) => {
    const [first] = rows;
    const counts = emptyCounts();
    for (const row of rows) counts[row.availability]++;

    return {
      matchId,
      opponent: first.opponent,
      competition: first.competition,
      matchDate: first.matchDate,
      time: first.time,
      ground: first.ground,
      totalInvited: rows.length,
      counts,
    };
  });

  // matchDate is YYYY-MM-DD, so a plain string comparison sorts chronologically; most recent first (full history, per the design doc).
  matches.sort((a, b) => (a.matchDate < b.matchDate ? 1 : a.matchDate > b.matchDate ? -1 : 0));
  return matches;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const config = loadConfig();
    const docClient = createDocumentClient();

    const session = await resolveAdminSession(docClient, config.adminSessionsTable, event.headers.authorization ?? event.headers.Authorization);
    if (!session) {
      return jsonResponse(401, { success: false, message: 'Sign in required' });
    }

    const records = await scanAllInvitations(docClient, config.matchAvailabilityTable);
    return jsonResponse(200, { success: true, matches: summarize(records), canPublishPlayerOfTheWeek: canPublishPlayerOfTheWeek(config, session.email) });
  } catch (error) {
    logger.error('admin matches endpoint failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

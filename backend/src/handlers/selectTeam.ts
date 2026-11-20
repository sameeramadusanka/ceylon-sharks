import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { resolveAdminSession } from '../adminAuth.js';
import { loadConfig } from '../config.js';
import { createSesClient, sendEmail } from '../email/sesClient.js';
import { logoUrlFor, teamSelectionEmail } from '../email/templates.js';
import { logger } from '../logger.js';
import { listByMatch, setSelection } from '../repositories/matchAvailabilityRepository.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';

const RequestSchema = z.object({ selectedPlayerEmails: z.array(z.string().email()) });

// SES sandbox in this account confirmed MaxSendRate: 1 request/second (ap-southeast-1) - see notifications.ts.
const SES_SEND_PACING_MS = 1100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const matchId = event.pathParameters?.matchId;
  if (!matchId) {
    return jsonResponse(400, { success: false, message: 'Missing matchId' });
  }

  let payload: unknown;
  try {
    payload = event.body ? JSON.parse(event.body) : undefined;
  } catch {
    return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { success: false, message: 'Invalid request' });
  }

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();

    const session = await resolveAdminSession(docClient, config.adminSessionsTable, event.headers.authorization ?? event.headers.Authorization);
    if (!session) {
      return jsonResponse(401, { success: false, message: 'Sign in required' });
    }

    if (!config.teamSelectionCaptainEmail || session.email !== config.teamSelectionCaptainEmail.toLowerCase()) {
      return jsonResponse(403, { success: false, message: 'Only the captain can select the squad' });
    }

    const records = await listByMatch(docClient, config.matchAvailabilityTable, matchId);
    if (records.length === 0) {
      return jsonResponse(404, { success: false, message: 'Match not found' });
    }

    const selectedEmails = new Set(parsed.data.selectedPlayerEmails.map((email) => email.toLowerCase()));
    const logoUrl = logoUrlFor(config.availabilityFrontendUrl);
    const sesClient = createSesClient();
    const now = new Date().toISOString();

    let notifiedCount = 0;
    const failedNotifications: string[] = [];

    for (const record of records) {
      const isSelected = selectedEmails.has(record.playerEmail.toLowerCase());
      const wasSelected = record.selected === true;
      await setSelection(docClient, config.matchAvailabilityTable, matchId, record.playerEmail, isSelected, now);

      if (!isSelected || wasSelected) continue;

      try {
        const { subject, text, html } = teamSelectionEmail({
          playerName: record.playerName,
          opponent: record.opponent,
          matchDate: record.matchDate,
          time: record.time,
          ground: record.ground,
          logoUrl,
        });
        const recipient = config.teamSelectionTestRecipientEmail || record.playerEmail;
        await sendEmail(sesClient, { from: config.sesFromEmail, to: [recipient], subject, html, text });
        notifiedCount++;
      } catch (error) {
        logger.error('team selection email failed', {
          matchId,
          recipient: record.playerEmail,
          errorCategory: error instanceof Error ? error.message : 'unknown error',
        });
        failedNotifications.push(record.playerEmail);
      }

      await sleep(SES_SEND_PACING_MS);
    }

    return jsonResponse(200, { success: true, selectedCount: selectedEmails.size, notifiedCount, failedNotifications });
  } catch (error) {
    logger.error('select team endpoint failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

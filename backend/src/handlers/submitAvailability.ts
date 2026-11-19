import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createSesClient, sendEmail } from '../email/sesClient.js';
import { captainNotificationEmail, logoUrlFor } from '../email/templates.js';
import { logger } from '../logger.js';
import { findByTokenHash, updateAvailability } from '../repositories/matchAvailabilityRepository.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';
import { hashToken } from '../token.js';

const SubmitRequestSchema = z.object({
  token: z.string().min(1),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE', 'MAYBE']),
  comments: z.string().max(60).optional(),
});

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let payload: unknown;
  try {
    payload = event.body ? JSON.parse(event.body) : undefined;
  } catch {
    return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
  }

  const parsed = SubmitRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { success: false, message: 'Invalid request' });
  }
  const { token, availability, comments } = parsed.data;

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();
    // Player identity is always derived from the token's stored record, never from the request body.
    const record = await findByTokenHash(docClient, config.matchAvailabilityTable, hashToken(token));

    if (!record) {
      return jsonResponse(401, { success: false, message: 'Invalid invitation' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds > record.tokenExpiry) {
      return jsonResponse(410, { success: false, message: 'The submission deadline has passed' });
    }

    const nowIso = new Date().toISOString();
    const previousAvailability = record.availability;
    await updateAvailability(docClient, config.matchAvailabilityTable, record.matchId, record.playerEmail, availability, comments, nowIso);

    try {
      const sesClient = createSesClient();
      const { subject, text, html } = captainNotificationEmail({
        playerName: record.playerName,
        opponent: record.opponent,
        matchDate: record.matchDate,
        newAvailability: availability,
        previousAvailability,
        comments,
        submittedAt: nowIso,
        logoUrl: logoUrlFor(config.availabilityFrontendUrl),
      });
      await sendEmail(sesClient, { from: config.sesFromEmail, to: [config.captainEmail, config.viceCaptainEmail], subject, html, text });
    } catch (notifyError) {
      // The player's response is already persisted - a notification-email failure
      // must never turn into a failed submission for the player.
      logger.error('failed to notify captain/vice-captain of a submission', {
        matchId: record.matchId,
        actionType: 'SUBMIT_NOTIFY',
        errorCategory: notifyError instanceof Error ? notifyError.message : 'unknown error',
      });
    }

    return jsonResponse(200, { success: true, message: 'Availability submitted successfully', availability, updatedAt: nowIso });
  } catch (error) {
    logger.error('submit endpoint failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { LOGIN_CODE_RESEND_COOLDOWN_SECONDS, LOGIN_CODE_TTL_SECONDS } from '../adminAuth.js';
import { loadConfig } from '../config.js';
import { adminLoginCodeEmail, logoUrlFor } from '../email/templates.js';
import { createSesClient, sendEmail } from '../email/sesClient.js';
import { logger } from '../logger.js';
import { getLoginCode, isAllowlisted, putLoginCode } from '../repositories/adminRepository.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';
import { generateLoginCode, hashToken } from '../token.js';

const RequestSchema = z.object({ email: z.string().email() });

// Deliberately identical for allowlisted and non-allowlisted emails - this
// endpoint never reveals who is on the admin allowlist.
const GENERIC_MESSAGE = 'If that email has admin access, a sign-in code was sent.';

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

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { success: false, message: 'Invalid request' });
  }
  const email = parsed.data.email.toLowerCase();

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();

    const allowlisted = await isAllowlisted(docClient, config.adminAllowlistTable, email);
    if (!allowlisted) {
      return jsonResponse(200, { success: true, message: GENERIC_MESSAGE });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const existing = await getLoginCode(docClient, config.adminLoginCodesTable, email);
    const issuedAt = existing ? existing.expiresAt - LOGIN_CODE_TTL_SECONDS : 0;
    if (existing && nowSeconds - issuedAt < LOGIN_CODE_RESEND_COOLDOWN_SECONDS) {
      // Within the resend cooldown - respond the same way without sending another email.
      return jsonResponse(200, { success: true, message: GENERIC_MESSAGE });
    }

    const code = generateLoginCode();
    await putLoginCode(docClient, config.adminLoginCodesTable, email, hashToken(code), nowSeconds + LOGIN_CODE_TTL_SECONDS);

    const sesClient = createSesClient();
    const { subject, text, html } = adminLoginCodeEmail({ code, logoUrl: logoUrlFor(config.availabilityFrontendUrl) });
    await sendEmail(sesClient, { from: config.sesFromEmail, to: [email], subject, html, text });

    logger.info('admin login code sent', { recipient: email });
    return jsonResponse(200, { success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    logger.error('admin login request failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

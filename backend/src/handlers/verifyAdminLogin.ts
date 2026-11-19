import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { MAX_LOGIN_CODE_ATTEMPTS, SESSION_TTL_SECONDS } from '../adminAuth.js';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createSession, deleteLoginCode, getLoginCode, incrementLoginCodeAttempts } from '../repositories/adminRepository.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';
import { generateToken, hashToken } from '../token.js';

const VerifySchema = z.object({ email: z.string().email(), code: z.string().min(1) });

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

  const parsed = VerifySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { success: false, message: 'Invalid request' });
  }
  const email = parsed.data.email.toLowerCase();
  const { code } = parsed.data;

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();

    const loginCode = await getLoginCode(docClient, config.adminLoginCodesTable, email);
    if (!loginCode) {
      return jsonResponse(401, { success: false, message: 'Invalid or expired code' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds > loginCode.expiresAt) {
      await deleteLoginCode(docClient, config.adminLoginCodesTable, email);
      return jsonResponse(410, { success: false, message: 'That code has expired - request a new one' });
    }

    if (loginCode.attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
      await deleteLoginCode(docClient, config.adminLoginCodesTable, email);
      return jsonResponse(429, { success: false, message: 'Too many attempts - request a new code' });
    }

    if (loginCode.codeHash !== hashToken(code)) {
      await incrementLoginCodeAttempts(docClient, config.adminLoginCodesTable, email);
      return jsonResponse(401, { success: false, message: 'Invalid or expired code' });
    }

    // Consumed - a code can never be replayed for a second session.
    await deleteLoginCode(docClient, config.adminLoginCodesTable, email);

    const { rawToken, tokenHash } = generateToken();
    await createSession(docClient, config.adminSessionsTable, tokenHash, email, nowSeconds + SESSION_TTL_SECONDS);

    logger.info('admin signed in', { recipient: email });
    return jsonResponse(200, { success: true, sessionToken: rawToken, email });
  } catch (error) {
    logger.error('admin login verify failed', {
      route: event.rawPath,
      errorCategory: error instanceof Error ? error.message : 'unknown error',
    });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

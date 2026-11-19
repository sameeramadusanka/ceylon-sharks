import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getSession } from './repositories/adminRepository.js';
import { hashToken } from './token.js';

export const LOGIN_CODE_TTL_SECONDS = 10 * 60;
export const LOGIN_CODE_RESEND_COOLDOWN_SECONDS = 60;
export const MAX_LOGIN_CODE_ATTEMPTS = 5;
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Resolves the Authorization header to the signed-in admin's email, or null if missing/invalid/expired. */
export async function resolveAdminSession(docClient: DynamoDBDocumentClient, sessionsTable: string, authHeader: string | undefined): Promise<{ email: string } | null> {
  const token = extractBearerToken(authHeader);
  if (!token) return null;

  const session = await getSession(docClient, sessionsTable, hashToken(token));
  if (!session) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds > session.expiresAt) return null;

  return { email: session.email };
}

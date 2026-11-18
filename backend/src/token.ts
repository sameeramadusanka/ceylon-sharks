import { createHash, randomBytes } from 'node:crypto';

/** Generates a new magic-link token. Email the raw token; store only the hash. */
export function generateToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashToken(rawToken) };
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

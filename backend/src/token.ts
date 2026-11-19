import { createHash, randomBytes, randomInt } from 'node:crypto';

/** Generates a new magic-link token. Email the raw token; store only the hash. */
export function generateToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashToken(rawToken) };
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Admin login code: a 6-digit string (zero-padded), easy to type back in from an email. */
export function generateLoginCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

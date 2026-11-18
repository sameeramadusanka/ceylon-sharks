import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '../src/token.js';

describe('generateToken', () => {
  it('generates a unique raw token each call', () => {
    const first = generateToken();
    const second = generateToken();
    expect(first.rawToken).not.toBe(second.rawToken);
  });

  it('returns a tokenHash matching sha256(rawToken)', () => {
    const { rawToken, tokenHash } = generateToken();
    expect(tokenHash).toBe(hashToken(rawToken));
  });

  it('produces a hash that does not reveal the raw token', () => {
    const { rawToken, tokenHash } = generateToken();
    expect(tokenHash).not.toContain(rawToken);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('same-input')).toBe(hashToken('same-input'));
  });

  it('differs for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

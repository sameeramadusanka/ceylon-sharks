import { describe, expect, it, vi } from 'vitest';
import { logger, maskRecipient } from '../src/logger.js';

describe('maskRecipient', () => {
  it('masks the local part of an email but keeps the domain', () => {
    expect(maskRecipient('alexmorgan@example.com')).toBe('a***n@example.com');
  });

  it('fully masks very short local parts', () => {
    expect(maskRecipient('ab@example.com')).toBe('**@example.com');
  });

  it('returns a placeholder for a non-email identifier', () => {
    expect(maskRecipient('not-an-email')).toBe('***');
  });
});

describe('logger', () => {
  it('masks the recipient field before writing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('invitation sent', { recipient: 'player@example.com' });
    const loggedLine = spy.mock.calls[0][0] as string;
    expect(loggedLine).toContain('p***r@example.com');
    expect(loggedLine).not.toContain('player@example.com');
    spy.mockRestore();
  });

  it('refuses to log fields that look like secrets', () => {
    expect(() => logger.info('oops', { rawToken: 'abc123' })).toThrow(/sensitive/);
    expect(() => logger.info('oops', { tokenHash: 'abc123' })).toThrow(/sensitive/);
  });
});

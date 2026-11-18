import { describe, expect, it } from 'vitest';
import { captainNotificationEmail, invitationEmail } from '../src/email/templates.js';

describe('invitationEmail', () => {
  const params = {
    playerName: 'Sam Rivera',
    opponent: 'Cool Stars',
    matchDate: '2026-11-28',
    competition: 'League',
    deadline: '26 Nov 2026 23:59',
    magicLink: 'https://www.ceylonsharks.com/availability/respond?token=abc123',
  };

  it('includes the magic link and key match details', () => {
    const { text, html } = invitationEmail(params);
    expect(text).toContain(params.magicLink);
    expect(html).toContain(params.magicLink);
    expect(text).toContain('Cool Stars');
    expect(html).toContain('Cool Stars');
  });

  it('escapes HTML-unsafe characters in player-controlled text', () => {
    const { html } = invitationEmail({ ...params, playerName: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('captainNotificationEmail', () => {
  it('notes the previous availability when it changed', () => {
    const { text } = captainNotificationEmail({
      playerName: 'Sam Rivera',
      opponent: 'Cool Stars',
      matchDate: '2026-11-28',
      newAvailability: 'AVAILABLE',
      previousAvailability: 'MAYBE',
      submittedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(text).toContain('changed from MAYBE');
  });

  it('omits the change note for a first-time submission', () => {
    const { text } = captainNotificationEmail({
      playerName: 'Sam Rivera',
      opponent: 'Cool Stars',
      matchDate: '2026-11-28',
      newAvailability: 'AVAILABLE',
      previousAvailability: 'NOT_SUBMITTED',
      submittedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(text).not.toContain('changed from');
  });

  it('escapes player-supplied comments', () => {
    const { html } = captainNotificationEmail({
      playerName: 'Sam Rivera',
      opponent: 'Cool Stars',
      matchDate: '2026-11-28',
      newAvailability: 'MAYBE',
      comments: '<img src=x onerror=alert(1)>',
      submittedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

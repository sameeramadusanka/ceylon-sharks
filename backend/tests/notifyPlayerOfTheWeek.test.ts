import { describe, expect, it, vi } from 'vitest';
import type { EmailContent } from '../src/email/sesClient.js';
import { displayDate, findWinner, notifyPlayerOfTheWeek, publisherEmails, type NotifyDeps, type NotifyPlayerOfTheWeekEvent } from '../src/handlers/notifyPlayerOfTheWeek.js';
import type { TeamMember } from '../src/repositories/teamMembersRepository.js';

const PAGE = 'https://ceylonsharks.com/player-of-the-week/2026-11-14/';

const EVENT: NotifyPlayerOfTheWeekEvent = {
  season: '2026_SEPTEMBER_SUPREME_DIVISION',
  date: '2026-11-14',
  playerId: 2791118,
  details: {
    playerName: 'Hasanka Chandrasena',
    opponent: 'Singa Smashers',
    competition: 'SCL - Supreme Division',
    batting: '73* (36, 4×4, 7×6)',
    fielding: '2 catches',
    caption: 'An unbeaten 73 off just 36 balls.',
  },
  notifyPlayer: true,
  replaced: false,
  publishedBy: 'owner@example.com',
  commitUrl: 'https://github.com/example/repo/commit/abc',
};

const MEMBERS: TeamMember[] = [
  { email: 'someone@example.com', name: 'Someone Else', role: 'PLAYER', isActive: true },
  { email: 'hasanka@example.com', name: 'Hasanka Chandrasena', role: 'PLAYER', isActive: true },
];

function page(status: number, body = '') {
  return new Response(body, { status });
}

function deps(overrides: Partial<NotifyDeps> & { pages?: Response[] } = {}) {
  const sent: EmailContent[] = [];
  const pages = overrides.pages ?? [page(200, '<title>Hasanka Chandrasena - Player of the Week</title>')];
  const fetchImpl = vi.fn(async (_url: string) => pages.shift() ?? page(404));
  const result: NotifyDeps = {
    config: {
      availabilityFrontendUrl: 'https://ceylonsharks.com',
      sesFromEmail: 'noreply@ceylonsharks.com',
      captainEmail: 'captain@example.com',
      viceCaptainEmail: 'vice@example.com',
      playerOfTheWeekOwnerEmail: 'owner@example.com',
      teamMembersTable: 'TeamMembers',
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: vi.fn(async () => undefined),
    send: vi.fn(async (content: EmailContent) => {
      sent.push(content);
    }),
    listMembers: vi.fn(async () => MEMBERS),
    timing: { firstCheckAfter: 60_000, interval: 30_000, giveUpAfter: 12 * 60_000 },
    ...overrides,
  };
  return { deps: result, sent, fetchImpl };
}

describe('notifyPlayerOfTheWeek', () => {
  it('waits for the page, then emails the winner first and the publishers second', async () => {
    const { deps: d, sent, fetchImpl } = deps();
    const outcome = await notifyPlayerOfTheWeek(EVENT, d);

    expect(outcome).toEqual({ live: true, playerEmail: 'sent' });
    expect(d.sleep).toHaveBeenNthCalledWith(1, 60_000);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(new RegExp(`^${PAGE}\\?check=\\d+$`));

    expect(sent).toHaveLength(2);
    expect(sent[0].to).toEqual(['hasanka@example.com']);
    expect(sent[0].subject).toBe("Congratulations Hasanka - you're Ceylon Sharks Player of the Week!");
    expect(sent[0].html).toContain(PAGE);
    expect(sent[0].html).toContain('73* (36, 4×4, 7×6)');
    expect(sent[0].html).toContain('ceylon-sharks-logo.png');
    // Empty figures are left out.
    expect(sent[0].text).not.toContain('Bowling');

    expect(sent[1].to).toEqual(['captain@example.com', 'vice@example.com', 'owner@example.com']);
    expect(sent[1].subject).toBe('Player of the Week is live: Hasanka Chandrasena');
    expect(sent[1].text).toContain('has been emailed a congratulations message');
    expect(sent[1].text).toContain(EVENT.commitUrl);
  });

  it('keeps checking until the page shows the new winner (an old page for the date also returns 200)', async () => {
    const { deps: d, sent } = deps({ pages: [page(404), page(200, '<title>Old Winner</title>'), page(200, 'Hasanka Chandrasena')] });
    const outcome = await notifyPlayerOfTheWeek(EVENT, d);
    expect(outcome.live).toBe(true);
    expect(d.sleep).toHaveBeenCalledWith(30_000);
    expect(sent).toHaveLength(2);
  });

  it('matches names the site HTML-escapes', async () => {
    const event = { ...EVENT, details: { ...EVENT.details, playerName: "D'Silva" } };
    const { deps: d } = deps({ pages: [page(200, 'D&#39;Silva')], listMembers: vi.fn(async () => []) });
    expect((await notifyPlayerOfTheWeek(event, d)).live).toBe(true);
  });

  it('warns the publishers and does not email the player if the page never goes live', async () => {
    const { deps: d, sent, fetchImpl } = deps({ pages: [] });
    const outcome = await notifyPlayerOfTheWeek(EVENT, d);

    expect(outcome).toEqual({ live: false, playerEmail: null });
    // 60s, then every 30s up to 12 minutes = 23 checks.
    expect(fetchImpl).toHaveBeenCalledTimes(23);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['captain@example.com', 'vice@example.com', 'owner@example.com']);
    expect(sent[0].subject).toMatch(/not live yet/);
    expect(d.listMembers).not.toHaveBeenCalled();
  });

  it('skips the winner when "Email the player" was unticked', async () => {
    const { deps: d, sent } = deps();
    const outcome = await notifyPlayerOfTheWeek({ ...EVENT, notifyPlayer: false }, d);
    expect(outcome.playerEmail).toBe('skipped');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('"Email the player" was unticked');
  });

  it('tells the publishers when the winner has no email on file', async () => {
    const { deps: d, sent } = deps({ listMembers: vi.fn(async () => [MEMBERS[0]]) });
    expect((await notifyPlayerOfTheWeek(EVENT, d)).playerEmail).toBe('no-email');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('has no email on file');
  });

  it('still emails the publishers when the winner email fails', async () => {
    const sent: EmailContent[] = [];
    const send = vi.fn(async (content: EmailContent) => {
      if (content.to.includes('hasanka@example.com')) throw new Error('MessageRejected');
      sent.push(content);
    });
    const { deps: d } = deps({ send });
    expect((await notifyPlayerOfTheWeek(EVENT, d)).playerEmail).toBe('failed');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("couldn't be sent");
  });

  it('says "replaced" when an existing winner was replaced', async () => {
    const { deps: d, sent } = deps();
    await notifyPlayerOfTheWeek({ ...EVENT, replaced: true }, d);
    expect(sent[1].text).toContain('replaced the Player of the Week');
  });
});

describe('helpers', () => {
  it('finds the winner by player ID before name', () => {
    const members: TeamMember[] = [
      { email: 'by-name@example.com', name: 'Hasanka Chandrasena', role: 'PLAYER', isActive: true },
      { email: 'by-id@example.com', name: 'H. Chandrasena', playerId: '2791118', role: 'PLAYER', isActive: true },
    ];
    expect(findWinner(members, 2791118, 'Hasanka Chandrasena')?.email).toBe('by-id@example.com');
    expect(findWinner(members, 1, ' hasanka chandrasena ')?.email).toBe('by-name@example.com');
    expect(findWinner(members, 1, 'Nobody')).toBeUndefined();
  });

  it('de-duplicates publishers and drops unset ones', () => {
    expect(publisherEmails({ captainEmail: 'Same@example.com', viceCaptainEmail: 'same@example.com', playerOfTheWeekOwnerEmail: '' })).toEqual(['same@example.com']);
  });

  it('formats dates like the site', () => {
    expect(displayDate('2026-11-14')).toBe('14 Nov 2026');
  });
});

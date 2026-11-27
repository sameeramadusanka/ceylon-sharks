import { describe, expect, it, vi } from 'vitest';
import { deployedCommit, notifySitePhotos, type NotifySitePhotosDeps } from '../src/handlers/notifySitePhotos.js';

const EVENT = { commitSha: 'ours', commitUrl: 'https://github.com/example/repo/commit/ours', publishedBy: 'captain@example.com', summary: ['Banner: 1 added'] };
const TIMING = { firstCheckAfter: 0, interval: 1, giveUpAfter: 3 };

function deps(deployed: (string | null)[], contains = (ours: string, head: string) => ours === head || head === 'newer'): NotifySitePhotosDeps & { sent: Parameters<NotifySitePhotosDeps['send']>[0][] } {
  const sent: Parameters<NotifySitePhotosDeps['send']>[0][] = [];
  const fetchImpl = vi.fn(async () => {
    const commit = deployed.length > 1 ? deployed.shift() : deployed[0];
    return commit === null ? new Response('nope', { status: 404 }) : new Response(JSON.stringify({ commit }), { status: 200 });
  });
  return {
    config: { availabilityFrontendUrl: 'https://ceylonsharks.com/', sesFromEmail: 'noreply@ceylonsharks.com', captainEmail: 'captain@example.com', viceCaptainEmail: 'vice@example.com', playerOfTheWeekOwnerEmail: 'none' },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
    send: async (content) => {
      sent.push(content);
    },
    containsCommit: async (ours, head) => contains(ours, head),
    timing: TIMING,
    sent,
  };
}

describe('notifySitePhotos', () => {
  it('emails the publishers once the live site includes the commit', async () => {
    const d = deps(['older', null, 'newer']);
    expect(await notifySitePhotos(EVENT, d)).toEqual({ live: true });
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].to).toEqual(['captain@example.com', 'vice@example.com']);
    expect(d.sent[0].subject).toBe('Site photos are live');
    expect(d.sent[0].text).toContain('- Banner: 1 added');
    expect(d.sent[0].html).toContain('https://ceylonsharks.com/');
  });

  it('sends a warning instead if the site never picks it up', async () => {
    const d = deps(['older']);
    expect(await notifySitePhotos(EVENT, d)).toEqual({ live: false });
    expect(d.sent[0].subject).toBe('Site photos saved, but not live yet');
  });

  it('reads the deployed commit, cache-busted, and copes with a missing file', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ commit: 'abc' }), { status: 200 }));
    expect(await deployedCommit(fetchImpl as unknown as typeof fetch, 'https://ceylonsharks.com')).toBe('abc');
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/ceylonsharks\.com\/build-info\.json\?check=\d+$/);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await deployedCommit(failing as unknown as typeof fetch, 'https://ceylonsharks.com')).toBeNull();
  });
});

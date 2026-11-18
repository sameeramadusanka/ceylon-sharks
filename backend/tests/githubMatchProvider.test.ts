import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUpcomingMatches } from '../src/providers/githubMatchProvider.js';

const BASE_URL = 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main';
const CONTENTS_URL = 'https://api.github.com/repos/sameeramadusanka/ceylon-sharks/contents/public/upcoming_schedules?ref=main';
const SCHEDULE_FILE_URL = 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main/public/upcoming_schedules/2026_SEPTEMBER_SUPREME_DIVISION__SCHEDULE__2026.json';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchUpcomingMatches', () => {
  it('maps scheduled matches and skips cancelled/unrecognised ones', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) {
        return jsonResponse([{ name: 'schedule.json', type: 'file', download_url: SCHEDULE_FILE_URL }]);
      }
      if (url === SCHEDULE_FILE_URL) {
        return jsonResponse({
          season: { name: '2026_SEPTEMBER_SUPREME_DIVISION' },
          matches: [
            { date: '2026-11-28', time: '9:45 AM', teamOne: 'Ceylon Sharks', teamTwo: 'Cool Stars', ground: 'SCL5', matchType: 'League', status: 'Scheduled' },
            { date: '2026-11-21', time: '7:30 AM', teamOne: 'Ceylon Sharks', teamTwo: 'Lightning Hawks', ground: 'SCL2', matchType: 'League', status: 'Cancelled' },
            { date: '2026-11-14', time: '12:00 PM', teamOne: 'Singa Smashers', teamTwo: 'Ceylon Sharks', ground: 'SCL1', matchType: 'League', status: 'SomethingUnexpected' },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const matches = await fetchUpcomingMatches(BASE_URL);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      seasonId: '2026_SEPTEMBER_SUPREME_DIVISION',
      matchDate: '2026-11-28',
      opponent: 'Cool Stars',
      competition: 'League',
      ground: 'SCL5',
      status: 'UPCOMING',
    });
    expect(matches[0].matchId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives the opponent correctly when Ceylon Sharks is teamTwo', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return jsonResponse([{ name: 'schedule.json', type: 'file', download_url: SCHEDULE_FILE_URL }]);
      return jsonResponse({
        season: { name: '2026_SEPTEMBER_SUPREME_DIVISION' },
        matches: [{ date: '2026-09-26', time: '7:30 AM', teamOne: 'Gully Boyz', teamTwo: 'Ceylon Sharks', ground: 'SCL2', matchType: 'League', status: 'Scheduled' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const matches = await fetchUpcomingMatches(BASE_URL);
    expect(matches[0].opponent).toBe('Gully Boyz');
  });

  it('throws on a malformed schedule file', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === CONTENTS_URL) return jsonResponse([{ name: 'schedule.json', type: 'file', download_url: SCHEDULE_FILE_URL }]);
      return jsonResponse({ season: { name: '2026' }, matches: [{ date: '2026-11-28' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchUpcomingMatches(BASE_URL)).rejects.toThrow();
  });

  it('throws when the GitHub contents API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 503)));
    await expect(fetchUpcomingMatches(BASE_URL)).rejects.toThrow(/503/);
  });

  it('throws on an unsupported GITHUB_MATCH_DATA_BASE_URL shape', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(fetchUpcomingMatches('https://example.com/not-github')).rejects.toThrow(/Unsupported/);
  });
});

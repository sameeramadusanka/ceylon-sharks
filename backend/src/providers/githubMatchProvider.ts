import { z } from 'zod';
import { computeMatchId } from '../matchId.js';
import { logger } from '../logger.js';

/**
 * Single-tenant backend: this club's own name as it appears in the
 * schedule feed's teamOne/teamTwo fields, matching src/data/team.json's
 * "name" in the frontend. Used to derive the opponent for each fixture.
 */
const CLUB_NAME = 'Ceylon Sharks';

const FETCH_TIMEOUT_MS = 10_000;

export type MatchStatus = 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';

export interface Match {
  matchId: string;
  seasonId: string;
  matchDate: string;
  time: string;
  opponent: string;
  competition: string;
  ground: string;
  status: MatchStatus;
}

const ContentsApiEntrySchema = z.object({
  name: z.string(),
  type: z.string(),
  download_url: z.string().nullable(),
});

const ScheduleMatchSchema = z
  .object({
    date: z.string(),
    time: z.string(),
    teamOne: z.string(),
    teamTwo: z.string(),
    ground: z.string(),
    matchType: z.string(),
    status: z.string(),
  })
  .loose();

const ScheduleFileSchema = z
  .object({
    season: z.object({
      name: z.string(),
    }),
    matches: z.array(ScheduleMatchSchema),
  })
  .loose();

function parseGithubBaseUrl(githubMatchDataBaseUrl: string): { owner: string; repo: string; branch: string } {
  const match = githubMatchDataBaseUrl.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Unsupported GITHUB_MATCH_DATA_BASE_URL shape: ${githubMatchDataBaseUrl}`);
  }
  const [, owner, repo, branch] = match;
  return { owner, repo, branch };
}

async function listScheduleFileUrls(githubMatchDataBaseUrl: string): Promise<string[]> {
  const { owner, repo, branch } = parseGithubBaseUrl(githubMatchDataBaseUrl);
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/public/upcoming_schedules?ref=${branch}`;

  const response = await fetch(contentsUrl, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'ceylon-sharks-availability-backend' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub contents API request failed with status ${response.status}`);
  }

  const entries = z.array(ContentsApiEntrySchema).parse(await response.json());
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.json') && entry.download_url !== null)
    .map((entry) => entry.download_url as string);
}

async function fetchScheduleFile(url: string): ReturnType<typeof ScheduleFileSchema.parseAsync> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to fetch schedule file, status ${response.status}`);
  }
  return ScheduleFileSchema.parseAsync(await response.json());
}

/**
 * Maps the schedule feed's free-text status onto the internal enum.
 * Only "Scheduled" has been observed in the real data so far (see
 * backend/docs/existing-match-data-mapping.md). Anything unrecognised
 * fails safe: returns null so the caller skips it rather than treating
 * an unknown value as upcoming and sending invitations for it.
 */
function mapStatus(rawStatus: string): MatchStatus | null {
  const normalized = rawStatus.trim().toLowerCase();
  if (normalized === 'scheduled') return 'UPCOMING';
  if (normalized.includes('cancel')) return 'CANCELLED';
  if (normalized.includes('postpone')) return 'POSTPONED';
  if (normalized.includes('complete') || normalized.includes('played')) return 'COMPLETED';
  return null;
}

/**
 * Fetches every published schedule file and returns only the fixtures
 * that are currently upcoming and actionable. Cancelled/postponed/
 * completed fixtures, and anything with an unrecognised status, are
 * logged and excluded rather than returned.
 */
export async function fetchUpcomingMatches(githubMatchDataBaseUrl: string): Promise<Match[]> {
  const fileUrls = await listScheduleFileUrls(githubMatchDataBaseUrl);
  const upcoming: Match[] = [];

  for (const url of fileUrls) {
    const file = await fetchScheduleFile(url);
    for (const entry of file.matches) {
      const status = mapStatus(entry.status);
      if (status === null) {
        logger.warn('unrecognised match status, skipping', { matchId: entry.date, actionType: 'SYNC' });
        continue;
      }
      if (status !== 'UPCOMING') {
        logger.info('match is not upcoming, skipping', { matchId: entry.date, actionType: 'SYNC', result: status });
        continue;
      }

      const opponent = entry.teamOne === CLUB_NAME ? entry.teamTwo : entry.teamOne;
      upcoming.push({
        matchId: computeMatchId(file.season.name, entry.date, entry.teamOne, entry.teamTwo),
        seasonId: file.season.name,
        matchDate: entry.date,
        time: entry.time,
        opponent,
        competition: entry.matchType,
        ground: entry.ground,
        status,
      });
    }
  }

  return upcoming;
}

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '../src/token.js';

const github = {
  ensureBranch: vi.fn(),
  listDirectory: vi.fn(),
  readTextFile: vi.fn(),
  commitFiles: vi.fn(),
  createBlob: vi.fn(),
};
const getGithubToken = vi.fn();
const resetGithubTokenCache = vi.fn();

vi.mock('../src/github/githubClient.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/github/githubClient.js')>();
  return { ...original, createGithubClient: vi.fn(() => github) };
});
vi.mock('../src/github/githubToken.js', () => ({ getGithubToken, resetGithubTokenCache }));

const { handler, applyChange, knownOpponents, seasonsNewestFirst, sortMatches } = await import('../src/handlers/adminSchedule.js');
const { GithubApiError } = await import('../src/github/githubClient.js');

const ENV = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  ADMIN_ALLOWLIST_TABLE: 'AdminAllowlist',
  ADMIN_LOGIN_CODES_TABLE: 'AdminLoginCodes',
  ADMIN_SESSIONS_TABLE: 'AdminSessions',
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/example/ceylon-sharks/main',
  AVAILABILITY_FRONTEND_URL: 'https://ceylonsharks.com',
  SES_FROM_EMAIL: 'noreply@ceylonsharks.com',
  CAPTAIN_EMAIL: 'captain@example.com',
  VICE_CAPTAIN_EMAIL: 'vice@example.com',
  POTW_OWNER_EMAIL: 'owner@example.com',
  TIME_ZONE: 'Asia/Singapore',
  INVITATION_DAYS_BEFORE: '5',
  REMINDER_DAYS_BEFORE: '3',
  CLOSURE_DAYS_BEFORE: '2',
  CLOSURE_LOCAL_TIME: '23:59',
  GITHUB_REPO: 'example/ceylon-sharks',
  POTW_PUBLISH_BRANCH: 'main',
  POTW_BASE_BRANCH: 'main',
  GITHUB_TOKEN_PARAMETER: '/ceylon-sharks/github-publish-token',
};

const SEASON = '2026_SEPTEMBER_SUPREME_DIVISION';
const OLD_SEASON = '2026_MAY_SUPREME_DIVISION';
const SCHEDULE_PATH = `public/upcoming_schedules/${SEASON}__SCHEDULE__2026.json`;
const SESSION_TOKEN = 'valid-session-token';
const ddbMock = mockClient(DynamoDBDocumentClient);

const stored = (date: string, time: string, teamOne: string, teamTwo: string, ground = 'SCL1') => ({
  series: SEASON,
  division: SEASON,
  matchType: 'League',
  date,
  time,
  teamOne,
  teamTwo,
  ground,
  umpireOne: 'Inferno',
  umpireTwo: 'Inferno',
  status: 'Scheduled',
  result: null,
});

const scheduleFile = () => ({
  season: { name: SEASON, division: SEASON, year: 2026 },
  matches: [stored('2026-12-05', '4:30 PM', 'Sengkang Tigers', 'Ceylon Sharks', 'BCG'), stored('2026-12-12', '9:45 AM', 'Royal Strikers', 'Ceylon Sharks')],
});

const semiFinal = { format: 'Semi Final', opponent: 'Cool Stars', date: '2026-12-19', time: '2:15 PM', ground: 'KRJ' } as const;

function signIn(email: string) {
  ddbMock.on(GetCommand).resolves({ Item: { sessionTokenHash: hashToken(SESSION_TOKEN), email, expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
}

function fakeEvent(method: string, body?: unknown, authorization: string | undefined = `Bearer ${SESSION_TOKEN}`): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/admin/schedule',
    rawQueryString: '',
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { requestId: 'r', http: { method, path: '/admin/schedule', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' } },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

async function invoke(method: string, body?: unknown, authorization?: string) {
  const result = (await handler(fakeEvent(method, body, authorization), {} as never, () => undefined)) as { statusCode: number; body: string };
  return { status: result.statusCode, body: JSON.parse(result.body) as Record<string, unknown> };
}

function committedFile() {
  const [{ files }] = github.commitFiles.mock.calls[0] as [{ files: { path: string; contentBase64: string }[] }];
  return { path: files[0].path, json: JSON.parse(Buffer.from(files[0].contentBase64, 'base64').toString('utf8')) as ReturnType<typeof scheduleFile> };
}

beforeEach(() => {
  ddbMock.reset();
  Object.assign(process.env, ENV);
  for (const fn of Object.values(github)) fn.mockReset();
  getGithubToken.mockReset().mockResolvedValue('gh-test');
  resetGithubTokenCache.mockReset();
  github.ensureBranch.mockResolvedValue(undefined);
  github.listDirectory.mockImplementation(async (path: string) => {
    if (path === 'public/upcoming_schedules') return [{ name: `${SEASON}__SCHEDULE__2026.json`, path: SCHEDULE_PATH, type: 'file', sha: 's1' }];
    if (path === 'public/players') return [OLD_SEASON, SEASON].map((name) => ({ name, path: `public/players/${name}`, type: 'dir', sha: name }));
    return [];
  });
  github.readTextFile.mockImplementation(async (path: string) => (path === SCHEDULE_PATH ? JSON.stringify(scheduleFile()) : null));
  github.commitFiles.mockResolvedValue({ commitSha: 'abc123', commitUrl: 'https://github.com/example/ceylon-sharks/commit/abc123' });
  signIn('captain@example.com');
});

afterEach(() => ddbMock.reset());

describe('adminSchedule handler', () => {
  it('requires a session and the captain, vice-captain or owner', async () => {
    expect((await invoke('GET', undefined, '')).status).toBe(401);
    signIn('player@example.com');
    expect((await invoke('GET')).status).toBe(403);
    expect(getGithubToken).not.toHaveBeenCalled();
  });

  it('lists every season newest first, with its fixtures and the known opponents', async () => {
    const { status, body } = await invoke('GET');
    expect(status).toBe(200);
    const seasons = body.seasons as { season: string; matches: { key: string; opponent: string; format: string }[] }[];
    expect(seasons.map((season) => season.season)).toEqual([SEASON, OLD_SEASON]);
    expect(seasons[0].matches.map((match) => match.opponent)).toEqual(['Sengkang Tigers', 'Royal Strikers']);
    expect(seasons[0].matches[0]).toMatchObject({ key: '2026-12-05|Sengkang Tigers|Ceylon Sharks', format: 'League', ground: 'BCG', time: '4:30 PM' });
    expect(seasons[1].matches).toEqual([]);
    expect(body.opponents).toEqual(['Royal Strikers', 'Sengkang Tigers']);
    expect(body.grounds).toEqual(['SCL1', 'SCL2', 'SCL3', 'SCL4', 'SCL5', 'BCG', 'KRJ']);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('adds a knockout match in date order and commits the schedule file', async () => {
    const { status, body } = await invoke('POST', { action: 'add', season: SEASON, match: semiFinal });
    expect(status).toBe(200);
    expect(body.summary).toBe('Add Semi Final vs Cool Stars on 2026-12-19');
    const { path, json } = committedFile();
    expect(path).toBe(SCHEDULE_PATH);
    expect(json.matches.map((match) => match.date)).toEqual(['2026-12-05', '2026-12-12', '2026-12-19']);
    expect(json.matches[2]).toMatchObject({ matchType: 'Semi Final', teamOne: 'Ceylon Sharks', teamTwo: 'Cool Stars', ground: 'KRJ', time: '2:15 PM', status: 'Scheduled', result: null });
    expect((github.commitFiles.mock.calls[0][0] as { message: string }).message).toContain('Add Semi Final vs Cool Stars on 2026-12-19');
    // The response carries the updated schedule so the panel needn't reload.
    expect((body.seasons as { matches: unknown[] }[])[0].matches).toHaveLength(3);
  });

  it('creates the schedule file for a season that has none yet', async () => {
    const { status } = await invoke('POST', { action: 'add', season: OLD_SEASON, match: { ...semiFinal, date: '2026-08-15' } });
    expect(status).toBe(200);
    const { path, json } = committedFile();
    expect(path).toBe(`public/upcoming_schedules/${OLD_SEASON}__SCHEDULE__2026.json`);
    expect(json.season).toEqual({ name: OLD_SEASON, division: OLD_SEASON, year: 2026 });
    expect(json.matches).toHaveLength(1);
  });

  it('updates a match, keeping home/away order and the fields the form does not edit', async () => {
    const { status } = await invoke('POST', {
      action: 'update',
      season: SEASON,
      key: '2026-12-12|Royal Strikers|Ceylon Sharks',
      match: { format: 'Final', opponent: 'Gully Boyz', date: '2026-12-13', time: '7:30 AM', ground: 'SCL3' },
    });
    expect(status).toBe(200);
    const updated = committedFile().json.matches[1];
    expect(updated).toMatchObject({ matchType: 'Final', teamOne: 'Gully Boyz', teamTwo: 'Ceylon Sharks', date: '2026-12-13', time: '7:30 AM', ground: 'SCL3', umpireOne: 'Inferno' });
  });

  it('removes a match', async () => {
    const { status, body } = await invoke('POST', { action: 'delete', season: SEASON, key: '2026-12-05|Sengkang Tigers|Ceylon Sharks' });
    expect(status).toBe(200);
    expect(body.summary).toBe('Remove League vs Sengkang Tigers on 2026-12-05');
    expect(committedFile().json.matches.map((match) => match.teamOne)).toEqual(['Royal Strikers']);
  });

  it('refuses a stale key, a clash, an unknown season and bad fields without committing', async () => {
    expect((await invoke('POST', { action: 'delete', season: SEASON, key: '2026-01-01|A|B' })).status).toBe(409);
    expect((await invoke('POST', { action: 'add', season: SEASON, match: { ...semiFinal, date: '2026-12-05', time: '4:30 PM' } })).status).toBe(409);
    expect((await invoke('POST', { action: 'add', season: '2030_JANUARY_SUPREME_DIVISION', match: semiFinal })).status).toBe(400);
    expect((await invoke('POST', { action: 'add', season: SEASON, match: { ...semiFinal, ground: 'Lords' } })).status).toBe(400);
    expect((await invoke('POST', { action: 'add', season: SEASON, match: { ...semiFinal, format: 'Friendly' } })).status).toBe(400);
    expect((await invoke('POST', { action: 'add', season: SEASON, match: { ...semiFinal, opponent: 'Ceylon Sharks' } })).status).toBe(400);
    expect((await invoke('POST', { action: 'add', season: SEASON, match: { ...semiFinal, time: '25:00' } })).status).toBe(400);
    expect((await invoke('POST', { action: 'add', season: SEASON, match: { ...semiFinal, date: '2026-02-30' } })).status).toBe(400);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('reports GitHub failures and drops a rejected token', async () => {
    github.commitFiles.mockRejectedValue(new GithubApiError('bad credentials', 401));
    const { status, body } = await invoke('POST', { action: 'add', season: SEASON, match: semiFinal });
    expect(status).toBe(502);
    expect(body.message).toContain('token may have expired');
    expect(resetGithubTokenCache).toHaveBeenCalled();
  });
});

describe('schedule helpers', () => {
  it('allows two knockout games on one day at different times', () => {
    const file = { season: { name: SEASON }, matches: [stored('2026-12-19', '9:45 AM', 'Ceylon Sharks', 'Gillies')] };
    const { file: next } = applyChange(file, { action: 'add', season: SEASON, match: { ...semiFinal, time: '2:15 PM' } });
    expect(next.matches.map((match) => match.time)).toEqual(['9:45 AM', '2:15 PM']);
  });

  it('sorts by date then by clock time, not text', () => {
    const sorted = sortMatches([stored('2026-12-19', '2:15 PM', 'A', 'B'), stored('2026-12-19', '12:00 PM', 'A', 'C'), stored('2026-12-19', '9:45 AM', 'A', 'D')]);
    expect(sorted.map((match) => match.time)).toEqual(['9:45 AM', '12:00 PM', '2:15 PM']);
  });

  it('rejects an update that changes nothing', () => {
    const file = scheduleFile();
    expect(() =>
      applyChange(file, { action: 'update', season: SEASON, key: '2026-12-05|Sengkang Tigers|Ceylon Sharks', match: { format: 'League', opponent: 'Sengkang Tigers', date: '2026-12-05', time: '4:30 PM', ground: 'BCG' } }),
    ).toThrow('Nothing changed');
  });

  it('orders seasons by year then month and lists opponents once', () => {
    expect(seasonsNewestFirst(['2026_MAY_SUPREME_DIVISION', '2025_SEPTEMBER_X', '2026_SEPTEMBER_SUPREME_DIVISION'])).toEqual(['2026_SEPTEMBER_SUPREME_DIVISION', '2026_MAY_SUPREME_DIVISION', '2025_SEPTEMBER_X']);
    expect(knownOpponents([scheduleFile(), scheduleFile()])).toEqual(['Royal Strikers', 'Sengkang Tigers']);
  });
});

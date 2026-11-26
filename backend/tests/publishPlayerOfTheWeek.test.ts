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
};
const getGithubToken = vi.fn();
const resetGithubTokenCache = vi.fn();

vi.mock('../src/github/githubClient.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/github/githubClient.js')>();
  return { ...original, createGithubClient: vi.fn(() => github) };
});
vi.mock('../src/github/githubToken.js', () => ({ getGithubToken, resetGithubTokenCache }));

const { handler, imageExtension } = await import('../src/handlers/publishPlayerOfTheWeek.js');
const { GithubApiError } = await import('../src/github/githubClient.js');

const ENV = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  ADMIN_ALLOWLIST_TABLE: 'AdminAllowlist',
  ADMIN_LOGIN_CODES_TABLE: 'AdminLoginCodes',
  ADMIN_SESSIONS_TABLE: 'AdminSessions',
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main',
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
  POTW_PUBLISH_BRANCH: 'potw-test',
  POTW_BASE_BRANCH: 'main',
  GITHUB_TOKEN_PARAMETER: '/ceylon-sharks/github-publish-token',
};

const SEASON = '2026_SEPTEMBER_SUPREME_DIVISION';
const SESSION_TOKEN = 'valid-session-token';
const ddbMock = mockClient(DynamoDBDocumentClient);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

function signIn(email: string) {
  ddbMock.on(GetCommand).resolves({ Item: { sessionTokenHash: hashToken(SESSION_TOKEN), email, expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    season: SEASON,
    date: '2026-11-22',
    playerId: 3190737,
    details: { playerName: 'Tharindu Hettiarachchi', opponent: 'Cool Blue', competition: 'SCL - Supreme Division', batting: '45 (32)', bowling: '', wicketKeeping: '1 stumping', caption: 'Top score.' },
    image: { dataBase64: PNG.toString('base64') },
    ...overrides,
  };
}

function fakeEvent(body: unknown, authorization: string | undefined = `Bearer ${SESSION_TOKEN}`): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/admin/player-of-the-week',
    rawQueryString: '',
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { requestId: 'r', http: { method: 'POST', path: '/admin/player-of-the-week', protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' } },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

type Result = { statusCode: number; body: string };
async function invoke(body: unknown, authorization?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = (await handler(fakeEvent(body, authorization), {} as never, () => undefined)) as Result;
  return { status: result.statusCode, body: JSON.parse(result.body) };
}

beforeEach(() => {
  ddbMock.reset();
  Object.assign(process.env, ENV);
  for (const fn of Object.values(github)) fn.mockReset();
  getGithubToken.mockReset().mockResolvedValue('gh-test');
  resetGithubTokenCache.mockReset();
  github.ensureBranch.mockResolvedValue(undefined);
  github.listDirectory.mockImplementation(async (path: string) =>
    path.startsWith('public/players/') ? [{ name: `${SEASON}__PLAYERS__2026.json`, path: `public/players/${SEASON}/${SEASON}__PLAYERS__2026.json`, type: 'file' }] : [],
  );
  github.readTextFile.mockResolvedValue(JSON.stringify({ season: { players: [{ id: 3190737, name: 'Tharindu Hettiarachchi' }] } }));
  github.commitFiles.mockResolvedValue({ commitSha: 'abc123', commitUrl: 'https://github.com/example/ceylon-sharks/commit/abc123' });
});

afterEach(() => ddbMock.reset());

describe('publishPlayerOfTheWeek handler', () => {
  it('requires a session', async () => {
    const { status } = await invoke(validBody(), '');
    expect(status).toBe(401);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('rejects admins who are not the captain, vice-captain or owner', async () => {
    signIn('someone-else@example.com');
    const { status } = await invoke(validBody());
    expect(status).toBe(403);
    expect(getGithubToken).not.toHaveBeenCalled();
  });

  it.each(['captain@example.com', 'VICE@example.com', 'owner@example.com'])('lets %s publish', async (email) => {
    signIn(email.toLowerCase());
    const { status } = await invoke(validBody());
    expect(status).toBe(200);
  });

  it('commits the poster and details as one commit with the site naming convention', async () => {
    signIn('owner@example.com');
    const { status, body } = await invoke(validBody());

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, branch: 'potw-test', pagePath: '/player-of-the-week/2026-11-22/', replaced: false });
    expect(github.ensureBranch).toHaveBeenCalledWith('potw-test', 'main');
    expect(github.commitFiles).toHaveBeenCalledTimes(1);

    const request = github.commitFiles.mock.calls[0][0];
    expect(request.branch).toBe('potw-test');
    expect(request.message).toMatch(/^Add Player of the Week for 2026-11-22: Tharindu Hettiarachchi/);
    expect(request.message).not.toContain('@');
    expect(request.deletePaths).toEqual([]);
    const paths = request.files.map((file: { path: string }) => file.path);
    expect(paths).toEqual([
      `src/assets/player_of_the_week/${SEASON}/2026-11-22__3190737.png`,
      `src/assets/player_of_the_week/${SEASON}/2026-11-22__3190737.json`,
    ]);

    const details = JSON.parse(Buffer.from(request.files[1].contentBase64, 'base64').toString('utf8'));
    // Empty optional fields are dropped rather than written as "".
    expect(details).toEqual({ playerName: 'Tharindu Hettiarachchi', opponent: 'Cool Blue', competition: 'SCL - Supreme Division', batting: '45 (32)', wicketKeeping: '1 stumping', caption: 'Top score.' });
  });

  it('names JPEG posters .jpg', async () => {
    signIn('owner@example.com');
    await invoke(validBody({ image: { dataBase64: JPEG.toString('base64') } }));
    expect(github.commitFiles.mock.calls[0][0].files[0].path).toMatch(/2026-11-22__3190737\.jpg$/);
  });

  it('rejects files that are not JPEG or PNG', async () => {
    signIn('owner@example.com');
    const { status } = await invoke(validBody({ image: { dataBase64: Buffer.from('GIF89a-not-allowed').toString('base64') } }));
    expect(status).toBe(400);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('rejects posters over 4 MB', async () => {
    signIn('owner@example.com');
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
    const { status } = await invoke(validBody({ image: { dataBase64: big.toString('base64') } }));
    expect(status).toBe(413);
  });

  it.each([
    ['bad date', { date: '2026-13-40' }],
    ['bad season', { season: '../../etc' }],
    ['missing opponent', { details: { playerName: 'X', opponent: '' } }],
    ['non-integer player', { playerId: 'abc' }],
  ])('rejects a %s', async (_label, overrides) => {
    signIn('owner@example.com');
    const { status } = await invoke(validBody(overrides));
    expect(status).toBe(400);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('rejects a player who is not in the season squad', async () => {
    signIn('owner@example.com');
    const { status, body } = await invoke(validBody({ playerId: 999 }));
    expect(status).toBe(400);
    expect(body.message).toMatch(/isn't in the/);
  });

  it('refuses to overwrite an existing winner on that date unless asked to', async () => {
    signIn('owner@example.com');
    github.listDirectory.mockImplementation(async (path: string) =>
      path.startsWith('public/players/')
        ? [{ name: `${SEASON}__PLAYERS__2026.json`, path: `public/players/${SEASON}/${SEASON}__PLAYERS__2026.json`, type: 'file' }]
        : [
            { name: '2026-11-22__4202974.jpg', path: `src/assets/player_of_the_week/${SEASON}/2026-11-22__4202974.jpg`, type: 'file' },
            { name: '2026-11-22__4202974.json', path: `src/assets/player_of_the_week/${SEASON}/2026-11-22__4202974.json`, type: 'file' },
            { name: '2026-11-21__1111111.jpg', path: `src/assets/player_of_the_week/${SEASON}/2026-11-21__1111111.jpg`, type: 'file' },
          ],
    );

    const refused = await invoke(validBody());
    expect(refused.status).toBe(409);
    expect(github.commitFiles).not.toHaveBeenCalled();

    const replaced = await invoke(validBody({ replaceExisting: true }));
    expect(replaced.status).toBe(200);
    expect(replaced.body.replaced).toBe(true);
    const request = github.commitFiles.mock.calls[0][0];
    expect(request.message).toMatch(/^Replace Player of the Week/);
    // The other date's files are untouched; the old winner's files for this date are removed.
    expect(request.deletePaths).toEqual([`src/assets/player_of_the_week/${SEASON}/2026-11-22__4202974.jpg`, `src/assets/player_of_the_week/${SEASON}/2026-11-22__4202974.json`]);
  });

  it('returns 502 and drops the cached token when GitHub rejects it', async () => {
    signIn('owner@example.com');
    github.ensureBranch.mockRejectedValue(new GithubApiError('bad credentials', 401));
    const { status, body } = await invoke(validBody());
    expect(status).toBe(502);
    expect(body.message).toMatch(/token may have expired/);
    expect(resetGithubTokenCache).toHaveBeenCalled();
  });
});

describe('imageExtension', () => {
  it('detects JPEG and PNG by magic bytes', () => {
    expect(imageExtension(JPEG)).toBe('jpg');
    expect(imageExtension(PNG)).toBe('png');
    expect(imageExtension(Buffer.from('hello'))).toBeNull();
  });
});

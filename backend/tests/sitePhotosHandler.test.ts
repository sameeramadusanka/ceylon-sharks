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
const startAsyncInvoke = vi.fn();

vi.mock('../src/github/githubClient.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/github/githubClient.js')>();
  return { ...original, createGithubClient: vi.fn(() => github) };
});
vi.mock('../src/github/githubToken.js', () => ({ getGithubToken, resetGithubTokenCache }));
vi.mock('../src/handlers/notifyTrigger.js', () => ({ startAsyncInvoke }));

const { handler, uploadStamp } = await import('../src/handlers/sitePhotos.js');
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
  NOTIFY_SITE_PHOTOS_FUNCTION: 'ceylon-sharks-availability-notify-site-photos',
};

const SEASON = '2026_SEPTEMBER_SUPREME_DIVISION';
const SESSION_TOKEN = 'valid-session-token';
const BLOB = 'a'.repeat(40);
const ddbMock = mockClient(DynamoDBDocumentClient);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

const file = (folder: string, name: string) => ({ name, path: `src/assets/${folder}/${name}`, type: 'file', sha: `sha-${name}`, download_url: `https://raw.example/${name}` });
const FOLDERS: Record<string, ReturnType<typeof file>[]> = {
  'src/assets/banner_images': [file('banner_images', 'b1.jpg'), file('banner_images', 'b2.jpg')],
  'src/assets/history_images': [file('history_images', 'h1.jpg')],
  'src/assets/player_images': [file('player_images', '3190737.PNG'), file('player_images', 'notes.txt')],
};

function signIn(email: string) {
  ddbMock.on(GetCommand).resolves({ Item: { sessionTokenHash: hashToken(SESSION_TOKEN), email, expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
}

function fakeEvent(method: string, path: string, body?: unknown, authorization: string | undefined = `Bearer ${SESSION_TOKEN}`): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: path,
    rawQueryString: '',
    headers: authorization ? { authorization } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { requestId: 'r', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '0.0.0.0', userAgent: 'vitest' } },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

async function invoke(method: string, path: string, body?: unknown, authorization?: string) {
  const result = (await handler(fakeEvent(method, path, body, authorization), {} as never, () => undefined)) as { statusCode: number; body: string };
  return { status: result.statusCode, body: JSON.parse(result.body) as Record<string, unknown> };
}
const publish = (body: unknown) => invoke('POST', '/admin/site-photos', body);

beforeEach(() => {
  ddbMock.reset();
  Object.assign(process.env, ENV);
  for (const fn of Object.values(github)) fn.mockReset();
  getGithubToken.mockReset().mockResolvedValue('gh-test');
  resetGithubTokenCache.mockReset();
  startAsyncInvoke.mockReset().mockResolvedValue(undefined);
  github.ensureBranch.mockResolvedValue(undefined);
  github.listDirectory.mockImplementation(async (path: string) =>
    path.startsWith('public/players/') ? [{ name: `${SEASON}__PLAYERS__2026.json`, path: `public/players/${SEASON}/${SEASON}__PLAYERS__2026.json`, type: 'file', sha: 's' }] : (FOLDERS[path] ?? []),
  );
  github.readTextFile.mockResolvedValue(JSON.stringify({ season: { players: [{ id: 3190737, name: 'Tharindu Hettiarachchi' }, { id: 111, name: 'Sam Silva' }] } }));
  github.commitFiles.mockResolvedValue({ commitSha: 'abc123', commitUrl: 'https://github.com/example/ceylon-sharks/commit/abc123' });
  github.createBlob.mockResolvedValue(BLOB);
  signIn('captain@example.com');
});

afterEach(() => ddbMock.reset());

describe('sitePhotos handler', () => {
  it('requires a session and a publisher', async () => {
    expect((await invoke('GET', '/admin/site-photos', undefined, '')).status).toBe(401);
    signIn('someone-else@example.com');
    expect((await invoke('GET', '/admin/site-photos')).status).toBe(403);
    expect(getGithubToken).not.toHaveBeenCalled();
  });

  it('lists the three folders, images only, players by ID', async () => {
    const { status, body } = await invoke('GET', '/admin/site-photos');
    expect(status).toBe(200);
    expect(body.banner).toEqual([
      { name: 'b1.jpg', sha: 'sha-b1.jpg', url: 'https://raw.example/b1.jpg' },
      { name: 'b2.jpg', sha: 'sha-b2.jpg', url: 'https://raw.example/b2.jpg' },
    ]);
    expect(body.players).toEqual([{ name: '3190737.PNG', sha: 'sha-3190737.PNG', url: 'https://raw.example/3190737.PNG', playerId: 3190737 }]);
  });

  it('stores an upload as a blob without committing', async () => {
    const { status, body } = await invoke('POST', '/admin/site-photos/upload', { image: { dataBase64: JPEG.toString('base64') } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ blobSha: BLOB, extension: 'jpg' });
    expect(github.createBlob).toHaveBeenCalledWith(JPEG.toString('base64'));
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('rejects uploads that are not JPEG or PNG', async () => {
    const { status } = await invoke('POST', '/admin/site-photos/upload', { image: { dataBase64: Buffer.from('GIF89a-not-allowed').toString('base64') } });
    expect(status).toBe(400);
    expect(github.createBlob).not.toHaveBeenCalled();
  });

  it('commits banner, Our Story and player changes as one commit and starts the email', async () => {
    const { status, body } = await publish({
      banner: { order: [{ existing: 'b2.jpg' }, { upload: { blobSha: BLOB, extension: 'jpg' } }] },
      history: { order: [] },
      players: [
        { action: 'upload', playerId: 3190737, season: SEASON, blobSha: BLOB, extension: 'jpg' },
        { action: 'remove', playerId: 111, season: SEASON },
      ],
    });
    expect(status).toBe(200);
    expect(github.commitFiles).toHaveBeenCalledTimes(1);
    const request = github.commitFiles.mock.calls[0][0];
    expect(request.branch).toBe('main');
    expect(request.files).toEqual([
      { path: 'src/assets/banner_images/010__b2.jpg', blobSha: 'sha-b2.jpg' },
      { path: expect.stringMatching(/^src\/assets\/banner_images\/020__photo-\d{8}-\d{6}-1\.jpg$/), blobSha: BLOB },
      { path: 'src/assets/player_images/3190737.jpg', blobSha: BLOB },
    ]);
    expect(request.deletePaths).toEqual([
      'src/assets/banner_images/b1.jpg',
      'src/assets/banner_images/b2.jpg',
      'src/assets/history_images/h1.jpg',
      'src/assets/player_images/3190737.PNG',
    ]);
    expect(body.summary).toEqual(['Banner: 1 added, 1 removed', 'Our Story: 1 removed', 'Player photos updated: Tharindu Hettiarachchi']);
    expect(startAsyncInvoke).toHaveBeenCalledWith(ENV.NOTIFY_SITE_PHOTOS_FUNCTION, expect.objectContaining({ commitSha: 'abc123', publishedBy: 'captain@example.com', summary: body.summary }));
    expect(body.notifications).toBe('scheduled');
  });

  it('keeps at least one banner photo', async () => {
    const { status } = await publish({ banner: { order: [] } });
    expect(status).toBe(400);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('reports a real player photo removal, and treats removing a missing photo as no change', async () => {
    const removed = await publish({ players: [{ action: 'remove', playerId: 3190737, season: SEASON }] });
    expect(removed.status).toBe(200);
    expect(removed.body.summary).toEqual(['Player photos removed: Tharindu Hettiarachchi']);
    const nothing = await publish({ players: [{ action: 'remove', playerId: 111, season: SEASON }] });
    expect(nothing.status).toBe(400);
  });

  it('refuses a player who is not in that season\'s squad', async () => {
    const { status, body } = await publish({ players: [{ action: 'remove', playerId: 999, season: SEASON }] });
    expect(status).toBe(400);
    expect(body.message).toContain("isn't in the");
  });

  it('says so when nothing changed, without committing or renaming', async () => {
    const { status } = await publish({ banner: { order: [{ existing: 'b1.jpg' }, { existing: 'b2.jpg' }] } });
    expect(status).toBe(400);
    expect(github.commitFiles).not.toHaveBeenCalled();
  });

  it('returns 409 when the photos changed since the page loaded', async () => {
    const { status } = await publish({ banner: { order: [{ existing: 'someone-deleted-this.jpg' }] } });
    expect(status).toBe(409);
  });

  it('still succeeds if the email could not be started', async () => {
    startAsyncInvoke.mockRejectedValue(new Error('boom'));
    const { status, body } = await publish({ history: { order: [] } });
    expect(status).toBe(200);
    expect(body.notifications).toBe('not-scheduled');
  });

  it('maps GitHub failures to 502 and resets the token on 401', async () => {
    github.commitFiles.mockRejectedValue(new GithubApiError('bad', 401));
    const { status, body } = await publish({ history: { order: [] } });
    expect(status).toBe(502);
    expect(body.message).toContain('token');
    expect(resetGithubTokenCache).toHaveBeenCalled();
  });

  it('stamps uploads with a sortable UTC time', () => {
    expect(uploadStamp(new Date('2026-11-27T09:05:03.120Z'))).toBe('20261127-090503');
  });
});

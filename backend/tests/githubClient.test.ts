import { describe, expect, it, vi } from 'vitest';
import { createGithubClient, GithubApiError } from '../src/github/githubClient.js';

type Route = (body: unknown) => { status: number; json?: unknown };

function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.github.com/repos/example/repo', '');
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const entry = routes[key];
    const handler = Array.isArray(entry) ? entry.shift() : entry;
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    const { status, json } = handler(body);
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('githubClient', () => {
  it('sends the token and lists a directory, returning [] for a missing folder', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'GET /contents/src/assets/x?ref=potw-test': () => ({ status: 200, json: [{ name: 'a.json', path: 'src/assets/x/a.json', type: 'file' }] }),
      'GET /contents/missing?ref=potw-test': () => ({ status: 404, json: { message: 'Not Found' } }),
    });
    const client = createGithubClient({ token: 'gh-test', repo: 'example/repo', fetchImpl });

    expect(await client.listDirectory('src/assets/x', 'potw-test')).toEqual([{ name: 'a.json', path: 'src/assets/x/a.json', type: 'file' }]);
    expect(await client.listDirectory('missing', 'potw-test')).toEqual([]);
    const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers.authorization).toBe('Bearer gh-test');
    expect(calls).toHaveLength(2);
  });

  it('decodes a text file', async () => {
    const { fetchImpl } = fakeFetch({
      'GET /contents/a.json?ref=main': () => ({ status: 200, json: { content: Buffer.from('{"ok":true}').toString('base64'), encoding: 'base64' } }),
    });
    const client = createGithubClient({ token: 't', repo: 'example/repo', fetchImpl });
    expect(await client.readTextFile('a.json', 'main')).toBe('{"ok":true}');
  });

  it('creates a missing branch from the base branch', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'GET /git/ref/heads/potw-test': () => ({ status: 404 }),
      'GET /git/ref/heads/main': () => ({ status: 200, json: { object: { sha: 'main-sha' } } }),
      'POST /git/refs': () => ({ status: 201, json: {} }),
    });
    const client = createGithubClient({ token: 't', repo: 'example/repo', fetchImpl });
    await client.ensureBranch('potw-test', 'main');
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/git/refs', body: { ref: 'refs/heads/potw-test', sha: 'main-sha' } });
  });

  it('commits files and deletions in one commit, retrying once if the branch moved', async () => {
    let blob = 0;
    const { fetchImpl, calls } = fakeFetch({
      'POST /git/blobs': () => ({ status: 201, json: { sha: `blob-${++blob}` } }),
      'GET /git/ref/heads/main': [() => ({ status: 200, json: { object: { sha: 'head-1' } } }), () => ({ status: 200, json: { object: { sha: 'head-2' } } })],
      'GET /git/commits/head-1': () => ({ status: 200, json: { tree: { sha: 'tree-1' } } }),
      'GET /git/commits/head-2': () => ({ status: 200, json: { tree: { sha: 'tree-2' } } }),
      'POST /git/trees': [() => ({ status: 201, json: { sha: 'new-tree-1' } }), () => ({ status: 201, json: { sha: 'new-tree-2' } })],
      'POST /git/commits': [() => ({ status: 201, json: { sha: 'c1', html_url: 'u1' } }), () => ({ status: 201, json: { sha: 'c2', html_url: 'u2' } })],
      'PATCH /git/refs/heads/main': [() => ({ status: 422, json: { message: 'Update is not a fast forward' } }), () => ({ status: 200, json: {} })],
    });
    const client = createGithubClient({ token: 't', repo: 'example/repo', fetchImpl });

    const result = await client.commitFiles({
      branch: 'main',
      message: 'msg',
      files: [
        { path: 'a.png', contentBase64: 'AAAA' },
        { path: 'a.json', contentBase64: 'e30=' },
      ],
      deletePaths: ['old.png'],
    });

    expect(result).toEqual({ commitSha: 'c2', commitUrl: 'u2' });
    const trees = calls.filter((call) => call.path === '/git/trees');
    expect(trees[1].body).toEqual({
      base_tree: 'tree-2',
      tree: [
        { path: 'a.png', mode: '100644', type: 'blob', sha: 'blob-1' },
        { path: 'a.json', mode: '100644', type: 'blob', sha: 'blob-2' },
        { path: 'old.png', mode: '100644', type: 'blob', sha: null },
      ],
    });
    const commits = calls.filter((call) => call.path === '/git/commits');
    expect(commits[1].body).toEqual({ message: 'msg', tree: 'new-tree-2', parents: ['head-2'] });
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
      { sha: 'c1', force: false },
      { sha: 'c2', force: false },
    ]);
  });

  it('throws GithubApiError with the status on failure', async () => {
    const { fetchImpl } = fakeFetch({ 'GET /contents/a?ref=main': () => ({ status: 401, json: { message: 'Bad credentials' } }) });
    const client = createGithubClient({ token: 't', repo: 'example/repo', fetchImpl });
    await expect(client.readTextFile('a', 'main')).rejects.toMatchObject({ status: 401, message: expect.stringContaining('Bad credentials') });
    await expect(client.readTextFile('a', 'main')).rejects.toBeInstanceOf(GithubApiError);
  });
});

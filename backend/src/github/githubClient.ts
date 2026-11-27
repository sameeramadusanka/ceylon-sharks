// Minimal GitHub REST client for publishing from the admin panel (Player of the
// Week, site photos): reads a few
// files from the site repository and writes several files as ONE commit via
// the Git Data API (blobs -> tree -> commit -> move branch ref), so the site
// never sees a poster without its details file.

const GITHUB_API = 'https://api.github.com';
const MAX_COMMIT_ATTEMPTS = 3;

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export interface GithubClientOptions {
  token: string;
  /** "owner/name" */
  repo: string;
  fetchImpl?: typeof fetch;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: string;
  /** Git blob SHA of the file's contents. */
  sha: string;
  /** Raw file URL (public repos only). */
  download_url?: string | null;
}

/** New file contents, or an existing blob (e.g. a photo uploaded earlier, or a file being renamed). */
export type FileToCommit = { path: string; contentBase64: string } | { path: string; blobSha: string };

export interface CommitRequest {
  branch: string;
  message: string;
  files: FileToCommit[];
  /** Paths to remove in the same commit (e.g. a replaced winner's old files). */
  deletePaths?: string[];
}

export interface CommitResult {
  commitSha: string;
  commitUrl: string;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGithubClient({ token, repo, fetchImpl = fetch }: GithubClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown, allowStatus: number[] = []): Promise<{ status: number; data: T | null }> {
    const response = await fetchImpl(`${GITHUB_API}/repos/${repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ceylon-sharks-admin',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allowStatus.includes(response.status)) return { status: response.status, data: null };
    if (!response.ok) {
      let detail = '';
      try {
        detail = ((await response.json()) as { message?: string }).message ?? '';
      } catch {
        // body wasn't JSON
      }
      throw new GithubApiError(`GitHub ${method} ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`, response.status);
    }
    return { status: response.status, data: (await response.json()) as T };
  }

  async function createBlob(contentBase64: string): Promise<string> {
    const { data } = await request<{ sha: string }>('POST', '/git/blobs', { content: contentBase64, encoding: 'base64' });
    return data!.sha;
  }

  async function getBranchHead(branch: string): Promise<string | null> {
    const { data } = await request<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodePath(branch)}`, undefined, [404]);
    return data ? data.object.sha : null;
  }

  return {
    /** Files directly inside a folder; an empty list if the folder doesn't exist yet. */
    async listDirectory(path: string, ref: string): Promise<DirectoryEntry[]> {
      const { data } = await request<DirectoryEntry[] | DirectoryEntry>('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, undefined, [404]);
      if (!data) return [];
      return Array.isArray(data) ? data : [];
    },

    /** A file's text, or null if it doesn't exist. */
    async readTextFile(path: string, ref: string): Promise<string | null> {
      const { data } = await request<{ content?: string; encoding?: string }>('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, undefined, [404]);
      if (!data?.content) return null;
      return Buffer.from(data.content, (data.encoding as BufferEncoding | undefined) ?? 'base64').toString('utf8');
    },

    /** Stores file contents in the repo without committing them; returns the blob SHA to use in a later commit. */
    createBlob,

    /** True if `head` contains commit `base` (same commit, or later on the same history). */
    async containsCommit(base: string, head: string): Promise<boolean> {
      if (base === head) return true;
      const { data } = await request<{ status: string }>('GET', `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, undefined, [404]);
      return data?.status === 'ahead' || data?.status === 'identical';
    },

    /** Makes sure `branch` exists, creating it from `baseBranch` if needed. */
    async ensureBranch(branch: string, baseBranch: string): Promise<void> {
      if (await getBranchHead(branch)) return;
      const baseSha = await getBranchHead(baseBranch);
      if (!baseSha) throw new GithubApiError(`Base branch "${baseBranch}" not found`, 404);
      await request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: baseSha });
    },

    /** Writes all files (and deletions) as a single commit on top of the branch, retrying if the branch moved meanwhile. */
    async commitFiles({ branch, message, files, deletePaths = [] }: CommitRequest): Promise<CommitResult> {
      const blobShas = await Promise.all(files.map((file) => ('blobSha' in file ? file.blobSha : createBlob(file.contentBase64))));

      for (let attempt = 1; ; attempt++) {
        const headSha = await getBranchHead(branch);
        if (!headSha) throw new GithubApiError(`Branch "${branch}" not found`, 404);
        const { data: headCommit } = await request<{ tree: { sha: string } }>('GET', `/git/commits/${headSha}`);

        const tree = [
          ...files.map((file, index) => ({ path: file.path, mode: '100644', type: 'blob', sha: blobShas[index] })),
          ...deletePaths.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
        ];
        const { data: newTree } = await request<{ sha: string }>('POST', '/git/trees', { base_tree: headCommit!.tree.sha, tree });
        const { data: newCommit } = await request<{ sha: string; html_url: string }>('POST', '/git/commits', { message, tree: newTree!.sha, parents: [headSha] });

        const { status } = await request('PATCH', `/git/refs/heads/${encodePath(branch)}`, { sha: newCommit!.sha, force: false }, attempt < MAX_COMMIT_ATTEMPTS ? [422] : []);
        if (status !== 422) return { commitSha: newCommit!.sha, commitUrl: newCommit!.html_url };
        // 422 = not a fast-forward: someone pushed to the branch between our read and write. Rebuild on the new head.
      }
    },
  };
}

export type GithubClient = ReturnType<typeof createGithubClient>;

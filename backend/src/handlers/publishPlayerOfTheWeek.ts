import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { resolveAdminSession } from '../adminAuth.js';
import { canPublishPlayerOfTheWeek, loadConfig, loadPublishConfig } from '../config.js';
import { createGithubClient, GithubApiError, type FileToCommit } from '../github/githubClient.js';
import { getGithubToken, resetGithubTokenCache } from '../github/githubToken.js';
import { logger } from '../logger.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';

// Publishes a Player of the Week entry by committing the poster + details JSON
// to the site repository, named exactly as src/lib/playerOfTheWeek.ts expects.
// The commit triggers the site's normal GitHub Pages deploy - this function
// never touches the live site directly.

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const RequestSchema = z.object({
  season: z.string().regex(/^\d{4}_[A-Z0-9]+(?:_[A-Z0-9]+)*$/, 'Invalid season'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Invalid date'),
  playerId: z.number().int().positive(),
  details: z.object({
    playerName: z.string().trim().min(1).max(80),
    opponent: z.string().trim().min(1).max(80),
    competition: optionalText(80),
    batting: optionalText(60),
    bowling: optionalText(60),
    fielding: optionalText(60),
    wicketKeeping: optionalText(60),
    caption: optionalText(400),
  }),
  image: z.object({ dataBase64: z.string().min(1) }),
  replaceExisting: z.boolean().optional().default(false),
});

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** File extension from the image's magic bytes; null if it isn't a JPEG or PNG. */
export function imageExtension(bytes: Buffer): 'jpg' | 'png' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

type SquadFile = { season?: { players?: { id: number; name: string }[] } };

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let payload: unknown;
  try {
    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    payload = raw ? JSON.parse(raw) : undefined;
  } catch {
    return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
  }

  try {
    const config = loadConfig();
    const docClient = createDocumentClient();

    const session = await resolveAdminSession(docClient, config.adminSessionsTable, event.headers.authorization ?? event.headers.Authorization);
    if (!session) return jsonResponse(401, { success: false, message: 'Sign in required' });

    if (!canPublishPlayerOfTheWeek(config, session.email)) {
      return jsonResponse(403, { success: false, message: 'Only the captain, vice-captain or site owner can publish Player of the Week' });
    }

    const parsed = RequestSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return jsonResponse(400, { success: false, message: `Invalid request: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'unknown field'}` });
    }
    const { season, date, playerId, details, image, replaceExisting } = parsed.data;

    const imageBytes = Buffer.from(image.dataBase64, 'base64');
    if (imageBytes.length > MAX_IMAGE_BYTES) {
      return jsonResponse(413, { success: false, message: 'The poster is too large (max 4 MB)' });
    }
    const extension = imageExtension(imageBytes);
    if (!extension) return jsonResponse(400, { success: false, message: 'The poster must be a JPEG or PNG image' });

    const publishConfig = loadPublishConfig();
    const token = await getGithubToken(publishConfig.githubTokenParameter);
    const github = createGithubClient({ token, repo: publishConfig.githubRepo });
    const branch = publishConfig.publishBranch;

    await github.ensureBranch(branch, publishConfig.baseBranch);

    // The player must be in that season's squad file - the same file the site reads.
    const squadEntries = await github.listDirectory(`public/players/${season}`, branch);
    const squadEntry = squadEntries.find((entry) => /__PLAYERS__\d{4}\.json$/.test(entry.name));
    if (!squadEntry) return jsonResponse(400, { success: false, message: `No squad file found for season ${season}` });
    const squad = JSON.parse((await github.readTextFile(squadEntry.path, branch)) ?? '{}') as SquadFile;
    if (!squad.season?.players?.some((player) => player.id === playerId)) {
      return jsonResponse(400, { success: false, message: `Player ${playerId} isn't in the ${season} squad` });
    }

    const folder = `src/assets/player_of_the_week/${season}`;
    const existing = (await github.listDirectory(folder, branch)).filter((entry) => entry.type === 'file' && entry.name.startsWith(`${date}__`));
    if (existing.length > 0 && !replaceExisting) {
      return jsonResponse(409, { success: false, message: `There is already a Player of the Week for ${date}. Tick "Replace existing" to overwrite it.` });
    }

    const baseName = `${folder}/${date}__${playerId}`;
    const detailsJson = `${JSON.stringify(details, null, 2)}\n`;
    const files: FileToCommit[] = [
      { path: `${baseName}.${extension}`, contentBase64: imageBytes.toString('base64') },
      { path: `${baseName}.json`, contentBase64: Buffer.from(detailsJson, 'utf8').toString('base64') },
    ];
    const newPaths = new Set(files.map((file) => file.path));
    const deletePaths = existing.map((entry) => entry.path).filter((path) => !newPaths.has(path));

    const verb = existing.length > 0 ? 'Replace' : 'Add';
    const commit = await github.commitFiles({
      branch,
      message: `${verb} Player of the Week for ${date}: ${details.playerName}\n\nPublished from the admin panel.`,
      files,
      deletePaths,
    });

    logger.info('player of the week published', { date, playerId, season, branch, replaced: existing.length > 0, recipient: session.email, commitSha: commit.commitSha });
    return jsonResponse(200, { success: true, branch, commitUrl: commit.commitUrl, pagePath: `/player-of-the-week/${date}/`, replaced: existing.length > 0 });
  } catch (error) {
    if (error instanceof GithubApiError) {
      if (error.status === 401) resetGithubTokenCache();
      logger.error('player of the week publish: GitHub error', { route: event.rawPath, errorCategory: error.message });
      const hint = error.status === 401 ? ' The GitHub token may have expired.' : '';
      return jsonResponse(502, { success: false, message: `Couldn't save to GitHub.${hint} Please try again or contact the site owner.` });
    }
    logger.error('player of the week publish failed', { route: event.rawPath, errorCategory: error instanceof Error ? error.message : 'unknown error' });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

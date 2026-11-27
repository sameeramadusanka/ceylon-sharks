import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { resolveAdminSession } from '../adminAuth.js';
import { canPublishPlayerOfTheWeek, loadConfig, loadPublishConfig } from '../config.js';
import { createGithubClient, GithubApiError, type FileToCommit, type GithubClient } from '../github/githubClient.js';
import { getGithubToken, resetGithubTokenCache } from '../github/githubToken.js';
import { imageExtension, MAX_IMAGE_BYTES } from '../images.js';
import { logger } from '../logger.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';
import {
  describeSection,
  imageEntries,
  PHOTO_FOLDERS,
  PhotoPlanError,
  planOrderedSection,
  planPlayerPhotos,
  toPlayerPhotos,
  toSitePhoto,
  type OrderedSection,
  type PlayerChange,
} from '../sitePhotos/sitePhotos.js';
import { startAsyncInvoke } from './notifyTrigger.js';

// Admin "Site photos" tab: banner, Our Story and player photos.
//   GET  /admin/site-photos         what's in the three folders on the publish branch now
//   POST /admin/site-photos/upload  stores one photo as a git blob (not committed yet)
//   POST /admin/site-photos         commits a batch of changes as ONE commit
// Photos upload one per request so each stays under the Lambda request size
// limit; the publish then only references them by blob SHA. Like Player of the
// Week, the commit triggers the site's normal deploy, and only the captain,
// vice-captain or site owner may use it.

const MAX_UPLOADS_PER_PUBLISH = 15;
const MAX_PLAYER_CHANGES = 40;
const SEASON = /^\d{4}_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

const Extension = z.enum(['jpg', 'png']);
const BlobSha = z.string().regex(/^[0-9a-f]{40}$/, 'Invalid upload id');
const OrderItemSchema = z.union([z.object({ existing: z.string().min(1).max(200) }), z.object({ upload: z.object({ blobSha: BlobSha, extension: Extension }) })]);
const SectionSchema = z.object({ order: z.array(OrderItemSchema).max(60) });
const PlayerChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upload'), playerId: z.number().int().positive(), season: z.string().regex(SEASON), blobSha: BlobSha, extension: Extension }),
  z.object({ action: z.literal('remove'), playerId: z.number().int().positive(), season: z.string().regex(SEASON) }),
]);
const PublishSchema = z.object({
  banner: SectionSchema.optional(),
  history: SectionSchema.optional(),
  players: z.array(PlayerChangeSchema).max(MAX_PLAYER_CHANGES).optional(),
});
const UploadSchema = z.object({ image: z.object({ dataBase64: z.string().min(1) }) });

const SECTION_LABELS: Record<OrderedSection, string> = { banner: 'Banner', history: 'Our Story' };

type SquadFile = { season?: { players?: { id: number; name: string }[] } };

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function parseBody(event: APIGatewayProxyEventV2): { ok: true; value: unknown } | { ok: false } {
  try {
    const raw = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    return { ok: true, value: raw ? JSON.parse(raw) : undefined };
  } catch {
    return { ok: false };
  }
}

function invalid(error: z.ZodError): APIGatewayProxyStructuredResultV2 {
  const issue = error.issues[0];
  return jsonResponse(400, { success: false, message: `Invalid request: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'unknown field'}` });
}

/** "20261127-0912": UTC time, so uploaded photos get unique, sortable names. */
export function uploadStamp(now = new Date()): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

async function listAll(github: GithubClient, branch: string) {
  const [banner, history, players] = await Promise.all([
    github.listDirectory(PHOTO_FOLDERS.banner, branch),
    github.listDirectory(PHOTO_FOLDERS.history, branch),
    github.listDirectory(PHOTO_FOLDERS.players, branch),
  ]);
  return { banner: imageEntries(banner), history: imageEntries(history), players: imageEntries(players) };
}

/** Player names by ID for every season the changes mention; an error message if a player isn't in that season's squad. */
async function checkSquads(github: GithubClient, branch: string, changes: { playerId: number; season: string }[]): Promise<{ names: Map<number, string> } | { error: string }> {
  const names = new Map<number, string>();
  for (const season of new Set(changes.map((change) => change.season))) {
    const squadEntry = (await github.listDirectory(`public/players/${season}`, branch)).find((entry) => /__PLAYERS__\d{4}\.json$/.test(entry.name));
    if (!squadEntry) return { error: `No squad file found for season ${season}` };
    const squad = JSON.parse((await github.readTextFile(squadEntry.path, branch)) ?? '{}') as SquadFile;
    const players = new Map((squad.season?.players ?? []).map((player) => [player.id, player.name]));
    for (const change of changes.filter((item) => item.season === season)) {
      const name = players.get(change.playerId);
      if (!name) return { error: `Player ${change.playerId} isn't in the ${season} squad` };
      names.set(change.playerId, name);
    }
  }
  return { names };
}

async function publish(github: GithubClient, branch: string, payload: z.infer<typeof PublishSchema>, publishedBy: string) {
  const uploads = [payload.banner, payload.history].flatMap((section) => section?.order.filter((item) => 'upload' in item) ?? []).length + (payload.players ?? []).filter((change) => change.action === 'upload').length;
  if (uploads > MAX_UPLOADS_PER_PUBLISH) return jsonResponse(400, { success: false, message: `Too many new photos at once (max ${MAX_UPLOADS_PER_PUBLISH}). Publish some, then add the rest.` });
  if (payload.banner && payload.banner.order.length === 0) return jsonResponse(400, { success: false, message: 'The banner needs at least one photo' });

  const playerIds = (payload.players ?? []).map((change) => change.playerId);
  if (new Set(playerIds).size !== playerIds.length) return jsonResponse(400, { success: false, message: 'Each player can only have one change per publish' });

  const current = await listAll(github, branch);
  const stamp = uploadStamp();
  const files: FileToCommit[] = [];
  const deletePaths: string[] = [];
  const summary: string[] = [];

  for (const section of ['banner', 'history'] as const) {
    const request = payload[section];
    if (!request) continue;
    const plan = planOrderedSection(PHOTO_FOLDERS[section], current[section], request.order, stamp);
    const line = describeSection(SECTION_LABELS[section], plan);
    if (!line) continue; // nothing actually changed - don't rename files for no reason
    files.push(...plan.files);
    deletePaths.push(...plan.deletePaths);
    summary.push(line);
  }

  if (payload.players?.length) {
    const squads = await checkSquads(github, branch, payload.players);
    if ('error' in squads) return jsonResponse(400, { success: false, message: squads.error });
    // Removing a photo that isn't there is a no-op, not a change worth reporting.
    const withPhoto = new Set(toPlayerPhotos(current.players).map((photo) => photo.playerId));
    const requested = payload.players.filter((change) => change.action === 'upload' || withPhoto.has(change.playerId));
    const changes: PlayerChange[] = requested.map((change) => (change.action === 'upload' ? { playerId: change.playerId, action: 'upload', blobSha: change.blobSha, extension: change.extension } : { playerId: change.playerId, action: 'remove' }));
    const plan = planPlayerPhotos(PHOTO_FOLDERS.players, current.players, changes);
    files.push(...plan.files);
    deletePaths.push(...plan.deletePaths);
    const named = (action: PlayerChange['action']) => requested.filter((change) => change.action === action).map((change) => squads.names.get(change.playerId)!);
    if (named('upload').length) summary.push(`Player photos updated: ${named('upload').join(', ')}`);
    if (named('remove').length) summary.push(`Player photos removed: ${named('remove').join(', ')}`);
  }

  if (files.length === 0 && deletePaths.length === 0) return jsonResponse(400, { success: false, message: 'There are no changes to publish' });

  const commit = await github.commitFiles({ branch, message: `Update site photos\n\n${summary.join('\n')}\n\nPublished from the admin panel.`, files, deletePaths });

  // The "photos are live" email comes from a separate Lambda; a failure here must never fail a publish that already landed.
  let notifications: 'scheduled' | 'not-scheduled' = 'not-scheduled';
  const notifyFunction = process.env.NOTIFY_SITE_PHOTOS_FUNCTION;
  if (notifyFunction) {
    try {
      await startAsyncInvoke(notifyFunction, { commitSha: commit.commitSha, commitUrl: commit.commitUrl, publishedBy, summary });
      notifications = 'scheduled';
    } catch (error) {
      logger.error('site photos: could not start notifications', { errorCategory: error instanceof Error ? error.message : 'unknown error' });
    }
  }

  logger.info('site photos published', { branch, recipient: publishedBy, commitSha: commit.commitSha, result: summary.join('; ') });
  return jsonResponse(200, { success: true, commitUrl: commit.commitUrl, summary, notifications });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const config = loadConfig();
    const docClient = createDocumentClient();
    const session = await resolveAdminSession(docClient, config.adminSessionsTable, event.headers.authorization ?? event.headers.Authorization);
    if (!session) return jsonResponse(401, { success: false, message: 'Sign in required' });
    if (!canPublishPlayerOfTheWeek(config, session.email)) {
      return jsonResponse(403, { success: false, message: 'Only the captain, vice-captain or site owner can change site photos' });
    }

    const publishConfig = loadPublishConfig();
    const token = await getGithubToken(publishConfig.githubTokenParameter);
    const github = createGithubClient({ token, repo: publishConfig.githubRepo });
    const branch = publishConfig.publishBranch;
    const method = event.requestContext?.http?.method ?? 'GET';
    const path = event.rawPath.replace(/\/+$/, '');

    if (method === 'GET') {
      const current = await listAll(github, branch);
      return jsonResponse(200, { success: true, banner: current.banner.map(toSitePhoto), history: current.history.map(toSitePhoto), players: toPlayerPhotos(current.players) });
    }

    const body = parseBody(event);
    if (!body.ok) return jsonResponse(400, { success: false, message: 'Invalid JSON body' });

    if (path.endsWith('/upload')) {
      const parsed = UploadSchema.safeParse(body.value);
      if (!parsed.success) return invalid(parsed.error);
      const bytes = Buffer.from(parsed.data.image.dataBase64, 'base64');
      if (bytes.length > MAX_IMAGE_BYTES) return jsonResponse(413, { success: false, message: 'The photo is too large (max 4 MB)' });
      const extension = imageExtension(bytes);
      if (!extension) return jsonResponse(400, { success: false, message: 'The photo must be a JPEG or PNG image' });
      const blobSha = await github.createBlob(bytes.toString('base64'));
      return jsonResponse(200, { success: true, blobSha, extension });
    }

    const parsed = PublishSchema.safeParse(body.value);
    if (!parsed.success) return invalid(parsed.error);
    await github.ensureBranch(branch, publishConfig.baseBranch);
    return await publish(github, branch, parsed.data, session.email);
  } catch (error) {
    if (error instanceof PhotoPlanError) return jsonResponse(error.status, { success: false, message: error.message });
    if (error instanceof GithubApiError) {
      if (error.status === 401) resetGithubTokenCache();
      logger.error('site photos: GitHub error', { route: event.rawPath, errorCategory: error.message });
      const hint = error.status === 401 ? ' The GitHub token may have expired.' : '';
      return jsonResponse(502, { success: false, message: `Couldn't save to GitHub.${hint} Please try again or contact the site owner.` });
    }
    logger.error('site photos failed', { route: event.rawPath, errorCategory: error instanceof Error ? error.message : 'unknown error' });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { resolveAdminSession } from '../adminAuth.js';
import { canPublishPlayerOfTheWeek, loadConfig, loadPublishConfig } from '../config.js';
import { createGithubClient, GithubApiError, type GithubClient } from '../github/githubClient.js';
import { getGithubToken, resetGithubTokenCache } from '../github/githubToken.js';
import { logger } from '../logger.js';
import { computeMatchId } from '../matchId.js';
import { planManualInvitation } from '../manualInvitation.js';
import { closureDeadline } from '../time.js';
import { claimManualInvitation, createDocumentClient, getAction, markActionFailed, type ManualInvitationMatch } from '../repositories/scheduledActionsRepository.js';
import { startAsyncInvoke } from './notifyTrigger.js';
import type { ManualInvitationEvent } from './coordinator.js';

// Admin "Schedule" tab: add, change or remove fixtures in a season's schedule
// file (public/upcoming_schedules/{SEASON}__SCHEDULE__{YEAR}.json), e.g. to add
// quarter-final, semi-final and final matches once the league stage ends.
//   GET  /admin/schedule   every season and its fixtures, read from the publish branch
//   POST /admin/schedule   one add / update / delete, committed as one commit
// Like Player of the Week and Site photos, the commit triggers the site's normal
// deploy, and only the captain, vice-captain or site owner may use it. The
// availability coordinator reads the same file, so a new fixture gets
// availability emails like any league match.
//   POST /admin/schedule {action:"invite"}   sends a match's availability
// invitations now, for a match added too late for the daily job (see
// manualInvitation.ts for when that's allowed and when it then closes).

export const CLUB_NAME = 'Ceylon Sharks';
export const MATCH_FORMATS = ['League', 'QF1', 'QF2', 'Quarter Final', 'Semi Final', 'Final'] as const;
export const GROUNDS = ['SCL1', 'SCL2', 'SCL3', 'SCL4', 'SCL5', 'BCG', 'KRJ'] as const;

const SCHEDULE_FOLDER = 'public/upcoming_schedules';
const SEASON = /^\d{4}_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Invalid date');

const MatchInputSchema = z.object({
  format: z.enum(MATCH_FORMATS),
  opponent: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(60)
    .refine((value) => value.toLowerCase() !== CLUB_NAME.toLowerCase(), `can't be ${CLUB_NAME}`),
  date: DateSchema,
  time: z.string().trim().regex(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/, 'must look like 9:45 AM'),
  ground: z.enum(GROUNDS),
});

const RequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), season: z.string().regex(SEASON, 'Invalid season'), match: MatchInputSchema }),
  z.object({ action: z.literal('update'), season: z.string().regex(SEASON, 'Invalid season'), key: z.string().min(1).max(200), match: MatchInputSchema }),
  z.object({ action: z.literal('delete'), season: z.string().regex(SEASON, 'Invalid season'), key: z.string().min(1).max(200) }),
  z.object({ action: z.literal('invite'), season: z.string().regex(SEASON, 'Invalid season'), key: z.string().min(1).max(200) }),
]);

export type MatchInput = z.infer<typeof MatchInputSchema>;
type ScheduleRequest = z.infer<typeof RequestSchema>;
type ChangeRequest = Exclude<ScheduleRequest, { action: 'invite' }>;

/** One fixture as stored in the schedule file. Unknown fields (umpires, scorers...) are kept as they are. */
export interface StoredMatch {
  series?: string;
  division?: string;
  matchType: string;
  date: string;
  time: string;
  teamOne: string;
  teamTwo: string;
  ground: string;
  status: string;
  result?: string | null;
  [field: string]: unknown;
}

export interface ScheduleFile {
  season: { name: string; division?: string; year?: number; [field: string]: unknown };
  matches: StoredMatch[];
  [field: string]: unknown;
}

/** A fixture as the admin panel sees it. */
export interface ScheduleItem {
  /** Identifies the fixture for update/delete: date + both team names, like the availability match ID. */
  key: string;
  format: string;
  opponent: string;
  date: string;
  time: string;
  ground: string;
  status: string;
  /** Availability invitations, for fixtures that haven't happened yet. */
  invitations?: InvitationInfo;
}

/**
 * Where a fixture's availability invitations stand:
 *  - sent / sending / failed: from the coordinator's record (closesAt = when availability closes);
 *  - not-sent + sendable: a captain may send them now (closesAt = when they would close);
 *  - not-sent + automaticDate: too early - the daily job sends them that day;
 *  - not-sent + tooLate: too close to the start to be worth sending.
 */
export interface InvitationInfo {
  status: 'not-sent' | 'sending' | 'sent' | 'failed';
  sendable: boolean;
  closesAt?: string;
  automaticDate?: string;
  tooLate?: boolean;
}

export class ScheduleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ScheduleError';
  }
}

export function matchKey(match: Pick<StoredMatch, 'date' | 'teamOne' | 'teamTwo'>): string {
  return `${match.date}|${match.teamOne}|${match.teamTwo}`;
}

export function opponentOf(match: Pick<StoredMatch, 'teamOne' | 'teamTwo'>): string {
  return match.teamOne === CLUB_NAME ? match.teamTwo : match.teamOne;
}

export function toScheduleItem(match: StoredMatch): ScheduleItem {
  return { key: matchKey(match), format: match.matchType, opponent: opponentOf(match), date: match.date, time: match.time, ground: match.ground, status: match.status };
}

/** "7:30 AM" -> minutes after midnight, for sorting; unknown formats sort last. */
function minutesOf(time: string): number {
  const parsed = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!parsed) return 24 * 60;
  let hour = Number(parsed[1]) % 12;
  if (parsed[3]?.toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(parsed[2]);
}

export function sortMatches(matches: StoredMatch[]): StoredMatch[] {
  return [...matches].sort((a, b) => a.date.localeCompare(b.date) || minutesOf(a.time) - minutesOf(b.time));
}

export function seasonYear(season: string): number {
  return Number(season.slice(0, 4));
}

export function emptyScheduleFile(season: string): ScheduleFile {
  return { season: { name: season, division: season, year: seasonYear(season) }, matches: [] };
}

function newMatch(season: string, input: MatchInput): StoredMatch {
  return {
    series: season,
    division: season,
    matchType: input.format,
    date: input.date,
    time: input.time,
    teamOne: CLUB_NAME,
    teamTwo: input.opponent,
    ground: input.ground,
    umpireOne: '',
    umpireTwo: '',
    umpireThree: '',
    umpireFour: '',
    matchManager: '',
    scorer1: '',
    scorer2: '',
    status: 'Scheduled',
    result: null,
  };
}

/** Keeps the fixture's home/away order and any other fields; only changes what the form edits. */
function updatedMatch(existing: StoredMatch, input: MatchInput): StoredMatch {
  const clubIsTeamOne = existing.teamOne === CLUB_NAME;
  return {
    ...existing,
    matchType: input.format,
    date: input.date,
    time: input.time,
    ground: input.ground,
    teamOne: clubIsTeamOne ? CLUB_NAME : input.opponent,
    teamTwo: clubIsTeamOne ? input.opponent : CLUB_NAME,
  };
}

function describe(input: Pick<StoredMatch, 'matchType' | 'date'> & { opponent: string }): string {
  return `${input.matchType} vs ${input.opponent} on ${input.date}`;
}

/** Applies one change to a schedule file. Pure, so it's easy to test; throws ScheduleError for a request that can't be applied. */
export function applyChange(file: ScheduleFile, request: ChangeRequest): { file: ScheduleFile; summary: string } {
  const matches = [...file.matches];
  // Two knockout games can fall on one day, so only the same date AND time is a clash.
  const clash = (input: MatchInput, ignoreIndex: number) => matches.some((match, index) => index !== ignoreIndex && match.date === input.date && minutesOf(match.time) === minutesOf(input.time));

  if (request.action === 'add') {
    if (clash(request.match, -1)) throw new ScheduleError(`There is already a match at ${request.match.time} on ${request.match.date}. Change that one instead.`, 409);
    const added = newMatch(request.season, request.match);
    return { file: { ...file, matches: sortMatches([...matches, added]) }, summary: `Add ${describe({ ...added, opponent: request.match.opponent })}` };
  }

  const index = matches.findIndex((match) => matchKey(match) === request.key);
  if (index === -1) throw new ScheduleError('That match is no longer in the schedule - someone may have changed it. Reload the schedule and try again.', 409);
  const existing = matches[index];

  if (request.action === 'delete') {
    matches.splice(index, 1);
    return { file: { ...file, matches }, summary: `Remove ${describe({ ...existing, opponent: opponentOf(existing) })}` };
  }

  if (clash(request.match, index)) throw new ScheduleError(`There is already another match at ${request.match.time} on ${request.match.date}.`, 409);
  const changed = updatedMatch(existing, request.match);
  matches[index] = changed;
  if (JSON.stringify(changed) === JSON.stringify(existing)) throw new ScheduleError('Nothing changed - edit at least one field first.', 400);
  return { file: { ...file, matches: sortMatches(matches) }, summary: `Update ${describe({ ...changed, opponent: request.match.opponent })}` };
}

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

interface LoadedSchedule {
  path: string;
  file: ScheduleFile;
}

/** Every schedule file in the folder, keyed by season name. */
async function loadSchedules(github: GithubClient, branch: string): Promise<Map<string, LoadedSchedule>> {
  const entries = (await github.listDirectory(SCHEDULE_FOLDER, branch)).filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'));
  const schedules = new Map<string, LoadedSchedule>();
  for (const entry of entries) {
    const text = await github.readTextFile(entry.path, branch);
    if (!text) continue;
    const file = JSON.parse(text) as ScheduleFile;
    const name = file.season?.name;
    if (!name || !Array.isArray(file.matches)) continue;
    schedules.set(name, { path: entry.path, file });
  }
  return schedules;
}

/** Seasons that have a squad folder, plus any that already have a schedule file; newest first. */
async function listSeasons(github: GithubClient, branch: string, schedules: Map<string, LoadedSchedule>): Promise<string[]> {
  const squadSeasons = (await github.listDirectory('public/players', branch)).filter((entry) => entry.type === 'dir' && SEASON.test(entry.name)).map((entry) => entry.name);
  return seasonsNewestFirst([...new Set([...squadSeasons, ...schedules.keys()])]);
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

export function seasonsNewestFirst(seasons: string[]): string[] {
  const order = (season: string) => seasonYear(season) * 100 + Math.max(0, MONTHS.indexOf(season.split('_')[1] ?? ''));
  return [...seasons].sort((a, b) => order(b) - order(a));
}

/** Teams we've played in any season's schedule, A-Z - the opponent dropdown's choices. */
export function knownOpponents(files: ScheduleFile[]): string[] {
  const names = new Set<string>();
  for (const file of files) for (const match of file.matches) names.add(opponentOf(match));
  names.delete(CLUB_NAME);
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

type Config = ReturnType<typeof loadConfig>;
type DocClient = ReturnType<typeof createDocumentClient>;

function isScheduled(match: StoredMatch): boolean {
  return match.status.trim().toLowerCase() === 'scheduled';
}

/** The availability system's view of a fixture - same ID and fields the coordinator derives from the schedule file. */
export function toInvitationMatch(file: ScheduleFile, match: StoredMatch): ManualInvitationMatch {
  return {
    matchId: computeMatchId(file.season.name, match.date, match.teamOne, match.teamTwo),
    seasonId: file.season.name,
    matchDate: match.date,
    time: match.time,
    opponent: opponentOf(match),
    competition: match.matchType,
    ground: match.ground,
  };
}

const STATUS_NAMES = { PROCESSING: 'sending', COMPLETED: 'sent', FAILED: 'failed', PENDING: 'not-sent' } as const;

async function invitationInfo(docClient: DocClient, config: Config, file: ScheduleFile, match: StoredMatch): Promise<InvitationInfo | undefined> {
  if (!isScheduled(match)) return undefined;
  const plan = planManualInvitation({ matchDate: match.date, time: match.time }, config);
  if (!plan.sendable && plan.reason === 'past') return undefined;

  const target = toInvitationMatch(file, match);
  const record = await getAction(docClient, config.scheduledActionsTable, 'INVITATION', target.matchId);
  const status = record ? STATUS_NAMES[record.status] : 'not-sent';
  if (status === 'sent' || status === 'sending') {
    const closesAt = record?.closesAt ?? closureDeadline(match.date, config.timeZone, config.closureDaysBefore, config.closureLocalTime).toISO() ?? undefined;
    return { status, sendable: false, closesAt };
  }
  if (plan.sendable) return { status, sendable: true, closesAt: plan.closesAt.toISO() ?? undefined };
  return { status, sendable: false, automaticDate: plan.automaticDate, tooLate: plan.reason === 'too-late' || undefined };
}

async function withInvitations(docClient: DocClient, config: Config, file: ScheduleFile | undefined): Promise<ScheduleItem[]> {
  if (!file) return [];
  return Promise.all(sortMatches(file.matches).map(async (match) => ({ ...toScheduleItem(match), invitations: await invitationInfo(docClient, config, file, match) })));
}

async function scheduleOverview(docClient: DocClient, config: Config, seasons: string[], schedules: Map<string, LoadedSchedule>) {
  return {
    seasons: await Promise.all(seasons.map(async (season) => ({ season, matches: await withInvitations(docClient, config, schedules.get(season)?.file) }))),
    opponents: knownOpponents([...schedules.values()].map((schedule) => schedule.file)),
    formats: MATCH_FORMATS,
    grounds: GROUNDS,
  };
}

/**
 * Claims the match's INVITATION action (so the daily job can't also send it)
 * and starts the coordinator to send the emails - that takes about a second
 * per player, longer than this request may stay open.
 */
async function sendInvitationsNow(docClient: DocClient, config: Config, file: ScheduleFile | undefined, key: string, requestedBy: string): Promise<string> {
  const stored = file?.matches.find((match) => matchKey(match) === key);
  if (!file || !stored) throw new ScheduleError('That match is no longer in the schedule - someone may have changed it. Reload the schedule and try again.', 409);
  if (!isScheduled(stored)) throw new ScheduleError(`That match is marked "${stored.status}", so no invitations go out for it.`, 409);

  const plan = planManualInvitation({ matchDate: stored.date, time: stored.time }, config);
  if (!plan.sendable) {
    const message = {
      past: 'That match has already been played.',
      automatic: `It's too early - invitations go out automatically on ${plan.automaticDate ?? 'the usual day'}.`,
      'too-late': "It's too close to the start for players to answer in time.",
    }[plan.reason];
    throw new ScheduleError(message, 409);
  }

  const match = toInvitationMatch(file, stored);
  const closesAt = plan.customClosing ? plan.closesAt.toISO() : null;
  const claimed = await claimManualInvitation(docClient, config.scheduledActionsTable, { match, closesAt, requestedBy });
  if (!claimed) throw new ScheduleError('Invitations for this match have already been sent (or are being sent now).', 409);

  const coordinator = process.env.COORDINATOR_FUNCTION;
  try {
    if (!coordinator) throw new Error('COORDINATOR_FUNCTION is not set');
    const event: ManualInvitationEvent = { mode: 'manual-invitation', match, closesAt };
    await startAsyncInvoke(coordinator, event);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    await markActionFailed(docClient, config.scheduledActionsTable, 'INVITATION', match.matchId, `could not start sending: ${reason}`);
    logger.error('schedule: could not start invitations', { matchId: match.matchId, errorCategory: reason });
    throw new ScheduleError("Couldn't start sending the invitations. Please try again.", 502);
  }

  logger.info('invitations sent by hand', { matchId: match.matchId, recipient: requestedBy, result: closesAt ? `closes ${closesAt}` : 'normal deadline' });
  return `Sending availability invitations for ${describe({ ...stored, opponent: match.opponent })}`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const config = loadConfig();
    const docClient = createDocumentClient();
    const session = await resolveAdminSession(docClient, config.adminSessionsTable, event.headers.authorization ?? event.headers.Authorization);
    if (!session) return jsonResponse(401, { success: false, message: 'Sign in required' });
    if (!canPublishPlayerOfTheWeek(config, session.email)) {
      return jsonResponse(403, { success: false, message: 'Only the captain, vice-captain or site owner can change the schedule' });
    }

    const method = event.requestContext?.http?.method ?? 'GET';
    let request: ScheduleRequest | undefined;
    if (method !== 'GET') {
      const body = parseBody(event);
      if (!body.ok) return jsonResponse(400, { success: false, message: 'Invalid JSON body' });
      const parsed = RequestSchema.safeParse(body.value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return jsonResponse(400, { success: false, message: `Invalid request: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'unknown field'}` });
      }
      request = parsed.data;
    }

    const publishConfig = loadPublishConfig();
    const token = await getGithubToken(publishConfig.githubTokenParameter);
    const github = createGithubClient({ token, repo: publishConfig.githubRepo });
    const branch = publishConfig.publishBranch;
    if (request && request.action !== 'invite') await github.ensureBranch(branch, publishConfig.baseBranch);

    const schedules = await loadSchedules(github, branch);
    const seasons = await listSeasons(github, branch, schedules);
    if (!request) return jsonResponse(200, { success: true, ...(await scheduleOverview(docClient, config, seasons, schedules)) });

    if (!seasons.includes(request.season)) return jsonResponse(400, { success: false, message: `Unknown season ${request.season}` });
    if (request.action === 'invite') {
      const summary = await sendInvitationsNow(docClient, config, schedules.get(request.season)?.file, request.key, session.email);
      return jsonResponse(200, { success: true, summary, ...(await scheduleOverview(docClient, config, seasons, schedules)) });
    }
    const current = schedules.get(request.season) ?? { path: `${SCHEDULE_FOLDER}/${request.season}__SCHEDULE__${seasonYear(request.season)}.json`, file: emptyScheduleFile(request.season) };
    const { file, summary } = applyChange(current.file, request);

    const commit = await github.commitFiles({
      branch,
      message: `${summary}\n\nSeason ${request.season}. Changed from the admin panel.`,
      files: [{ path: current.path, contentBase64: Buffer.from(`${JSON.stringify(file, null, 2)}\n`, 'utf8').toString('base64') }],
    });
    schedules.set(request.season, { path: current.path, file });

    logger.info('schedule updated', { branch, recipient: session.email, commitSha: commit.commitSha, result: summary });
    return jsonResponse(200, { success: true, commitUrl: commit.commitUrl, summary, ...(await scheduleOverview(docClient, config, seasons, schedules)) });
  } catch (error) {
    if (error instanceof ScheduleError) return jsonResponse(error.status, { success: false, message: error.message });
    if (error instanceof GithubApiError) {
      if (error.status === 401) resetGithubTokenCache();
      logger.error('schedule: GitHub error', { route: event.rawPath, errorCategory: error.message });
      const hint = error.status === 401 ? ' The GitHub token may have expired.' : '';
      return jsonResponse(502, { success: false, message: `Couldn't save to GitHub.${hint} Please try again or contact the site owner.` });
    }
    logger.error('schedule failed', { route: event.rawPath, errorCategory: error instanceof Error ? error.message : 'unknown error' });
    return jsonResponse(500, { success: false, message: 'Unexpected server error' });
  }
};

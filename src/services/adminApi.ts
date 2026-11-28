// Client for the independent availability backend's admin endpoints (see
// ceylon-sharks-admin-panel-idea.md). Only this service and the admin page/
// component tree ever call it - mirrors the hard isolation availabilityApi.ts
// already establishes for the player respond flow. Never import this from
// availabilityApi.ts or vice versa.

export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'MAYBE' | 'NOT_SUBMITTED';

export interface MatchListItem {
  matchId: string;
  opponent: string;
  competition: string;
  matchDate: string;
  /** Absent on invitations created before these fields were added. */
  time?: string;
  ground?: string;
  totalInvited: number;
  counts: Record<AvailabilityStatus, number>;
}

export interface MatchPlayerStatus {
  playerEmail: string;
  playerName: string;
  availability: AvailabilityStatus;
  comments?: string;
  submittedAt?: string;
  updatedAt?: string;
  selected: boolean;
}

export interface MatchDetail extends MatchListItem {
  players: MatchPlayerStatus[];
  canSelectTeam: boolean;
}

export interface SelectionResult {
  selectedCount: number;
  notifiedCount: number;
  failedNotifications: string[];
}

export interface AdminApiError {
  status: number;
  message: string;
}

// PUBLIC_AVAILABILITY_API_BASE_URL is not a secret - see src/env.d.ts. Same backend
// the player respond flow calls; the admin routes just live under a different path.
const DEFAULT_API_BASE_URL = 'https://1hybk78wc9.execute-api.ap-southeast-1.amazonaws.com';
const API_BASE_URL = (import.meta.env.PUBLIC_AVAILABILITY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

function unreachableError(): AdminApiError {
  return { status: 0, message: 'Unable to reach the availability service. Please check your connection and try again.' };
}

async function errorMessageFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
  } catch {
    // fall through to the generic message below
  }
  return 'Something went wrong. Please try again.';
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw { status: response.status, message: await errorMessageFrom(response) } satisfies AdminApiError;
  }
  return (await response.json()) as T;
}

export async function requestLoginCode(email: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/login/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw unreachableError();
  }
  const result = await readJsonOrThrow<{ success: true; message: string }>(response);
  return result.message;
}

export async function verifyLoginCode(email: string, code: string): Promise<{ sessionToken: string; email: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/login/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
  } catch {
    throw unreachableError();
  }
  const result = await readJsonOrThrow<{ success: true; sessionToken: string; email: string }>(response);
  return { sessionToken: result.sessionToken, email: result.email };
}

export async function fetchMatches(sessionToken: string): Promise<{ matches: MatchListItem[]; canPublishPlayerOfTheWeek: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/matches`, { headers: { authorization: `Bearer ${sessionToken}` } });
  } catch {
    throw unreachableError();
  }
  const result = await readJsonOrThrow<{ success: true; matches: MatchListItem[]; canPublishPlayerOfTheWeek?: boolean }>(response);
  return { matches: result.matches, canPublishPlayerOfTheWeek: result.canPublishPlayerOfTheWeek === true };
}

export async function fetchMatchDetail(sessionToken: string, matchId: string): Promise<MatchDetail> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/matches/${encodeURIComponent(matchId)}`, { headers: { authorization: `Bearer ${sessionToken}` } });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true } & MatchDetail>(response);
}

export async function saveTeamSelection(sessionToken: string, matchId: string, selectedPlayerEmails: string[]): Promise<SelectionResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/matches/${encodeURIComponent(matchId)}/selection`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ selectedPlayerEmails }),
    });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true } & SelectionResult>(response);
}

export interface PlayerOfTheWeekRequest {
  season: string;
  date: string;
  playerId: number;
  details: {
    playerName: string;
    opponent: string;
    competition?: string;
    batting?: string;
    bowling?: string;
    fielding?: string;
    wicketKeeping?: string;
    caption?: string;
  };
  /** JPEG or PNG bytes, base64 (no data: prefix). */
  imageBase64: string;
  replaceExisting: boolean;
  /** Email the winner a congratulations message once the page is live. */
  notifyPlayer: boolean;
}

export interface PlayerOfTheWeekResult {
  branch: string;
  commitUrl: string;
  pagePath: string;
  replaced: boolean;
  /** Whether the "page is live" emails were set up to go out. */
  notifications?: 'scheduled' | 'not-scheduled';
}

export async function publishPlayerOfTheWeek(sessionToken: string, request: PlayerOfTheWeekRequest): Promise<PlayerOfTheWeekResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/player-of-the-week`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        season: request.season,
        date: request.date,
        playerId: request.playerId,
        details: request.details,
        image: { dataBase64: request.imageBase64 },
        replaceExisting: request.replaceExisting,
        notifyPlayer: request.notifyPlayer,
      }),
    });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true } & PlayerOfTheWeekResult>(response);
}

// ---------------------------------------------------------------------------
// Site photos (banner, Our Story, player photos)
// ---------------------------------------------------------------------------

export interface SitePhoto {
  name: string;
  /** Git blob SHA - matches the build-time thumbnail map. */
  sha: string;
  /** Full-size file on GitHub; used when a photo is newer than this page's build. */
  url: string | null;
}

export interface SitePhotoLists {
  banner: SitePhoto[];
  history: SitePhoto[];
  players: (SitePhoto & { playerId: number })[];
}

export type PhotoExtension = 'jpg' | 'png';
export type PhotoOrderItem = { existing: string } | { upload: { blobSha: string; extension: PhotoExtension } };
export type PlayerPhotoChange =
  | { action: 'upload'; playerId: number; season: string; blobSha: string; extension: PhotoExtension }
  | { action: 'remove'; playerId: number; season: string };

export interface SitePhotosPublishRequest {
  banner?: { order: PhotoOrderItem[] };
  history?: { order: PhotoOrderItem[] };
  players?: PlayerPhotoChange[];
}

export interface SitePhotosPublishResult {
  commitUrl: string;
  summary: string[];
  notifications?: 'scheduled' | 'not-scheduled';
}

export async function fetchSitePhotos(sessionToken: string): Promise<SitePhotoLists> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/site-photos`, { headers: { authorization: `Bearer ${sessionToken}` } });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true } & SitePhotoLists>(response);
}

/** Uploads one photo (JPEG/PNG, base64) and returns the id to reference when publishing. */
export async function uploadSitePhoto(sessionToken: string, imageBase64: string): Promise<{ blobSha: string; extension: PhotoExtension }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/site-photos/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ image: { dataBase64: imageBase64 } }),
    });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true; blobSha: string; extension: PhotoExtension }>(response);
}

export async function publishSitePhotos(sessionToken: string, request: SitePhotosPublishRequest): Promise<SitePhotosPublishResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/site-photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(request),
    });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true } & SitePhotosPublishResult>(response);
}

// ---------------------------------------------------------------------------
// Match schedule (add knockout matches, fix dates/grounds)
// ---------------------------------------------------------------------------

export interface ScheduleItem {
  /** Identifies the fixture when changing or removing it. */
  key: string;
  format: string;
  opponent: string;
  /** YYYY-MM-DD */
  date: string;
  /** e.g. "9:45 AM" */
  time: string;
  ground: string;
  status: string;
  /** Availability invitations; only on fixtures that haven't been played. */
  invitations?: ScheduleInvitations;
}

/**
 * Where a fixture's availability invitations stand. When `sendable`, a captain
 * may send them now (the match was added too late for the daily job).
 */
export interface ScheduleInvitations {
  status: 'not-sent' | 'sending' | 'sent' | 'failed';
  sendable: boolean;
  /** ISO instant availability closes (or would close, if sent now). */
  closesAt?: string;
  /** YYYY-MM-DD the daily job will send them, when it's too early. */
  automaticDate?: string;
  tooLate?: boolean;
}

export interface ScheduleOverview {
  seasons: { season: string; matches: ScheduleItem[] }[];
  /** Teams from every season's schedule, A-Z. */
  opponents: string[];
  formats: string[];
  grounds: string[];
}

export interface ScheduleMatchInput {
  format: string;
  opponent: string;
  date: string;
  time: string;
  ground: string;
}

export type ScheduleChange =
  | { action: 'add'; season: string; match: ScheduleMatchInput }
  | { action: 'update'; season: string; key: string; match: ScheduleMatchInput }
  | { action: 'delete'; season: string; key: string }
  | { action: 'invite'; season: string; key: string };

export async function fetchSchedule(sessionToken: string): Promise<ScheduleOverview> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/schedule`, { headers: { authorization: `Bearer ${sessionToken}` } });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true } & ScheduleOverview>(response);
}

/** `commitUrl` is absent for "invite", which sends emails and changes no file. */
export async function changeSchedule(sessionToken: string, change: ScheduleChange): Promise<ScheduleOverview & { commitUrl?: string; summary: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/schedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(change),
    });
  } catch {
    throw unreachableError();
  }
  return readJsonOrThrow<{ success: true; commitUrl?: string; summary: string } & ScheduleOverview>(response);
}

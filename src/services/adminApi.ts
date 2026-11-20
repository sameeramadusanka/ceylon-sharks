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

export async function fetchMatches(sessionToken: string): Promise<MatchListItem[]> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/matches`, { headers: { authorization: `Bearer ${sessionToken}` } });
  } catch {
    throw unreachableError();
  }
  const result = await readJsonOrThrow<{ success: true; matches: MatchListItem[] }>(response);
  return result.matches;
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

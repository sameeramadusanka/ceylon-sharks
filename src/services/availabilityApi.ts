// Client for the independent availability backend (ceylon-sharks-availability-mvp.md).
// Only this service and the /availability/respond page ever call it - no other page
// or component should import from here (see the plan doc's independence requirement).

export type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'MAYBE';
export type CurrentAvailability = Availability | 'NOT_SUBMITTED';

export interface MatchSummary {
  matchId: string;
  opponent: string;
  competition: string;
  matchDate: string;
}

export interface ValidateResult {
  valid: true;
  playerName: string;
  match: MatchSummary;
  currentAvailability: CurrentAvailability;
  deadline: string;
}

export interface SubmitResult {
  success: true;
  message: string;
  availability: Availability;
  updatedAt: string;
}

export interface AvailabilityApiError {
  status: number;
  message: string;
}

// PUBLIC_AVAILABILITY_API_BASE_URL is not a secret - see src/env.d.ts. The fallback is
// the deployed ceylon-sharks-availability stack's own API Gateway URL.
const DEFAULT_API_BASE_URL = 'https://1hybk78wc9.execute-api.ap-southeast-1.amazonaws.com';
const API_BASE_URL = (import.meta.env.PUBLIC_AVAILABILITY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');

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
    throw { status: response.status, message: await errorMessageFrom(response) } satisfies AvailabilityApiError;
  }
  return (await response.json()) as T;
}

export async function validateToken(token: string): Promise<ValidateResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/availability/validate?token=${encodeURIComponent(token)}`);
  } catch {
    throw { status: 0, message: 'Unable to reach the availability service. Please check your connection and try again.' } satisfies AvailabilityApiError;
  }
  return readJsonOrThrow<ValidateResult>(response);
}

export async function submitAvailability(token: string, availability: Availability, comments: string): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/availability/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, availability, comments: comments || undefined }),
    });
  } catch {
    throw { status: 0, message: 'Unable to reach the availability service. Please check your connection and try again.' } satisfies AvailabilityApiError;
  }
  return readJsonOrThrow<SubmitResult>(response);
}

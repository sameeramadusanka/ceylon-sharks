export interface AvailabilityConfig {
  teamMembersTable: string;
  matchAvailabilityTable: string;
  scheduledActionsTable: string;
  adminAllowlistTable: string;
  adminLoginCodesTable: string;
  adminSessionsTable: string;
  githubMatchDataBaseUrl: string;
  availabilityFrontendUrl: string;
  sesFromEmail: string;
  captainEmail: string;
  viceCaptainEmail: string;
  timeZone: string;
  invitationDaysBefore: number;
  reminderDaysBefore: number;
  closureDaysBefore: number;
  closureLocalTime: string;
  /** Email allowed to select the match-day squad. Empty until a real captain is configured - the feature stays off until then. */
  teamSelectionCaptainEmail: string;
  /** When set, squad-selection emails go here instead of the real player - for testing before real captains are onboarded. */
  teamSelectionTestRecipientEmail: string;
}

const REQUIRED_ENV_KEYS = [
  'TEAM_MEMBERS_TABLE',
  'MATCH_AVAILABILITY_TABLE',
  'SCHEDULED_ACTIONS_TABLE',
  'ADMIN_ALLOWLIST_TABLE',
  'ADMIN_LOGIN_CODES_TABLE',
  'ADMIN_SESSIONS_TABLE',
  'GITHUB_MATCH_DATA_BASE_URL',
  'AVAILABILITY_FRONTEND_URL',
  'SES_FROM_EMAIL',
  'CAPTAIN_EMAIL',
  'VICE_CAPTAIN_EMAIL',
  'TIME_ZONE',
  'INVITATION_DAYS_BEFORE',
  'REMINDER_DAYS_BEFORE',
  'CLOSURE_DAYS_BEFORE',
  'CLOSURE_LOCAL_TIME',
] as const;

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function requireIntEnv(env: NodeJS.ProcessEnv, key: string): number {
  const raw = requireEnv(env, key);
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  return value;
}

/**
 * The deploy workflow always passes an explicit value for these two
 * optional parameters (never omits them) so CloudFormation can't silently
 * keep a stale stack value on an update - "none" is its non-empty
 * placeholder for "not configured", normalized back to '' here.
 */
function optionalEmailEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key] ?? '';
  return value === 'none' ? '' : value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AvailabilityConfig {
  return {
    teamMembersTable: requireEnv(env, 'TEAM_MEMBERS_TABLE'),
    matchAvailabilityTable: requireEnv(env, 'MATCH_AVAILABILITY_TABLE'),
    scheduledActionsTable: requireEnv(env, 'SCHEDULED_ACTIONS_TABLE'),
    adminAllowlistTable: requireEnv(env, 'ADMIN_ALLOWLIST_TABLE'),
    adminLoginCodesTable: requireEnv(env, 'ADMIN_LOGIN_CODES_TABLE'),
    adminSessionsTable: requireEnv(env, 'ADMIN_SESSIONS_TABLE'),
    githubMatchDataBaseUrl: requireEnv(env, 'GITHUB_MATCH_DATA_BASE_URL'),
    availabilityFrontendUrl: requireEnv(env, 'AVAILABILITY_FRONTEND_URL'),
    sesFromEmail: requireEnv(env, 'SES_FROM_EMAIL'),
    captainEmail: requireEnv(env, 'CAPTAIN_EMAIL'),
    viceCaptainEmail: requireEnv(env, 'VICE_CAPTAIN_EMAIL'),
    timeZone: requireEnv(env, 'TIME_ZONE'),
    invitationDaysBefore: requireIntEnv(env, 'INVITATION_DAYS_BEFORE'),
    reminderDaysBefore: requireIntEnv(env, 'REMINDER_DAYS_BEFORE'),
    closureDaysBefore: requireIntEnv(env, 'CLOSURE_DAYS_BEFORE'),
    closureLocalTime: requireEnv(env, 'CLOSURE_LOCAL_TIME'),
    teamSelectionCaptainEmail: optionalEmailEnv(env, 'TEAM_SELECTION_CAPTAIN_EMAIL'),
    teamSelectionTestRecipientEmail: optionalEmailEnv(env, 'TEAM_SELECTION_TEST_RECIPIENT_EMAIL'),
  };
}

export function configPresence(env: NodeJS.ProcessEnv = process.env): Record<string, boolean> {
  return Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, Boolean(env[key])]));
}

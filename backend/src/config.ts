export interface AvailabilityConfig {
  teamMembersTable: string;
  matchAvailabilityTable: string;
  scheduledActionsTable: string;
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
}

const REQUIRED_ENV_KEYS = [
  'TEAM_MEMBERS_TABLE',
  'MATCH_AVAILABILITY_TABLE',
  'SCHEDULED_ACTIONS_TABLE',
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AvailabilityConfig {
  return {
    teamMembersTable: requireEnv(env, 'TEAM_MEMBERS_TABLE'),
    matchAvailabilityTable: requireEnv(env, 'MATCH_AVAILABILITY_TABLE'),
    scheduledActionsTable: requireEnv(env, 'SCHEDULED_ACTIONS_TABLE'),
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
  };
}

export function configPresence(env: NodeJS.ProcessEnv = process.env): Record<string, boolean> {
  return Object.fromEntries(REQUIRED_ENV_KEYS.map((key) => [key, Boolean(env[key])]));
}

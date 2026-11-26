import { describe, expect, it } from 'vitest';
import { canPublishPlayerOfTheWeek, configPresence, loadConfig, loadPublishConfig } from '../src/config.js';

const VALID_ENV: NodeJS.ProcessEnv = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  ADMIN_ALLOWLIST_TABLE: 'AdminAllowlist',
  ADMIN_LOGIN_CODES_TABLE: 'AdminLoginCodes',
  ADMIN_SESSIONS_TABLE: 'AdminSessions',
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/example/repo/main',
  AVAILABILITY_FRONTEND_URL: 'https://ceylonsharks.com',
  SES_FROM_EMAIL: 'noreply@ceylonsharks.com',
  CAPTAIN_EMAIL: 'captain@example.com',
  VICE_CAPTAIN_EMAIL: 'vice@example.com',
  TIME_ZONE: 'Asia/Singapore',
  INVITATION_DAYS_BEFORE: '5',
  REMINDER_DAYS_BEFORE: '3',
  CLOSURE_DAYS_BEFORE: '2',
  CLOSURE_LOCAL_TIME: '23:59',
};

describe('loadConfig', () => {
  it('parses a fully populated environment', () => {
    const config = loadConfig(VALID_ENV);
    expect(config.teamMembersTable).toBe('TeamMembers');
    expect(config.adminAllowlistTable).toBe('AdminAllowlist');
    expect(config.invitationDaysBefore).toBe(5);
    expect(config.reminderDaysBefore).toBe(3);
    expect(config.closureDaysBefore).toBe(2);
  });

  it('throws when a required variable is missing', () => {
    const { CAPTAIN_EMAIL: _CAPTAIN_EMAIL, ...incomplete } = VALID_ENV;
    expect(() => loadConfig(incomplete)).toThrow(/CAPTAIN_EMAIL/);
  });

  it('throws when a numeric variable is not an integer', () => {
    expect(() => loadConfig({ ...VALID_ENV, INVITATION_DAYS_BEFORE: 'five' })).toThrow(/INVITATION_DAYS_BEFORE/);
  });

  it('normalizes the "none" placeholder for the optional squad-selection emails to empty', () => {
    const config = loadConfig({ ...VALID_ENV, TEAM_SELECTION_CAPTAIN_EMAIL: 'none', TEAM_SELECTION_TEST_RECIPIENT_EMAIL: 'none' });
    expect(config.teamSelectionCaptainEmail).toBe('');
    expect(config.teamSelectionTestRecipientEmail).toBe('');
  });

  it('passes through a real squad-selection email unchanged', () => {
    const config = loadConfig({ ...VALID_ENV, TEAM_SELECTION_CAPTAIN_EMAIL: 'captain@example.com' });
    expect(config.teamSelectionCaptainEmail).toBe('captain@example.com');
  });
});

describe('configPresence', () => {
  it('reports which required keys are set without exposing values', () => {
    const presence = configPresence({ ...VALID_ENV, CAPTAIN_EMAIL: '' });
    expect(presence.TEAM_MEMBERS_TABLE).toBe(true);
    expect(presence.CAPTAIN_EMAIL).toBe(false);
    expect(Object.values(presence).every((value) => typeof value === 'boolean')).toBe(true);
  });
});

describe('Player of the Week publishing access', () => {
  it('allows only the captain, vice-captain and site owner, ignoring case', () => {
    const config = loadConfig({ ...VALID_ENV, POTW_OWNER_EMAIL: 'Owner@Example.com' });
    expect(canPublishPlayerOfTheWeek(config, VALID_ENV.CAPTAIN_EMAIL!)).toBe(true);
    expect(canPublishPlayerOfTheWeek(config, VALID_ENV.VICE_CAPTAIN_EMAIL!.toUpperCase())).toBe(true);
    expect(canPublishPlayerOfTheWeek(config, 'owner@example.com')).toBe(true);
    expect(canPublishPlayerOfTheWeek(config, 'someone@example.com')).toBe(false);
  });

  it('treats an unset owner ("none") as nobody', () => {
    const config = loadConfig({ ...VALID_ENV, POTW_OWNER_EMAIL: 'none' });
    expect(config.playerOfTheWeekOwnerEmail).toBe('');
    expect(canPublishPlayerOfTheWeek(config, '')).toBe(false);
  });

  it('loads the publish settings and requires the token parameter', () => {
    const env = { GITHUB_REPO: 'example/repo', POTW_PUBLISH_BRANCH: 'potw-test', GITHUB_TOKEN_PARAMETER: '/x/token' };
    expect(loadPublishConfig(env)).toEqual({ githubRepo: 'example/repo', publishBranch: 'potw-test', baseBranch: 'main', githubTokenParameter: '/x/token' });
    expect(() => loadPublishConfig({ ...env, GITHUB_TOKEN_PARAMETER: '' })).toThrow(/GITHUB_TOKEN_PARAMETER/);
  });
});

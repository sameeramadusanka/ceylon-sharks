import { describe, expect, it } from 'vitest';
import { configPresence, loadConfig } from '../src/config.js';

const VALID_ENV: NodeJS.ProcessEnv = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/example/repo/main',
  AVAILABILITY_FRONTEND_URL: 'https://www.ceylonsharks.com',
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
});

describe('configPresence', () => {
  it('reports which required keys are set without exposing values', () => {
    const presence = configPresence({ ...VALID_ENV, CAPTAIN_EMAIL: '' });
    expect(presence.TEAM_MEMBERS_TABLE).toBe(true);
    expect(presence.CAPTAIN_EMAIL).toBe(false);
    expect(Object.values(presence).every((value) => typeof value === 'boolean')).toBe(true);
  });
});

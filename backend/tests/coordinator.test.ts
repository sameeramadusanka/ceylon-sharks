import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchUpcomingMatchesMock = vi.fn();
vi.mock('../src/providers/githubMatchProvider.js', () => ({
  fetchUpcomingMatches: fetchUpcomingMatchesMock,
}));

const calendarDaysUntilMock = vi.fn();
const localHourMock = vi.fn();
vi.mock('../src/time.js', () => ({
  calendarDaysUntil: calendarDaysUntilMock,
  localHour: localHourMock,
}));

const sendInvitationsMock = vi.fn();
const sendRemindersMock = vi.fn();
const closeAndSendSummaryMock = vi.fn();
vi.mock('../src/notifications.js', () => ({
  sendInvitations: sendInvitationsMock,
  sendReminders: sendRemindersMock,
  closeAndSendSummary: closeAndSendSummaryMock,
}));

const { handler } = await import('../src/handlers/coordinator.js');

const ENV = {
  TEAM_MEMBERS_TABLE: 'TeamMembers',
  MATCH_AVAILABILITY_TABLE: 'MatchAvailability',
  SCHEDULED_ACTIONS_TABLE: 'ScheduledActions',
  ADMIN_ALLOWLIST_TABLE: 'AdminAllowlist',
  ADMIN_LOGIN_CODES_TABLE: 'AdminLoginCodes',
  ADMIN_SESSIONS_TABLE: 'AdminSessions',
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main',
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

const MATCH = {
  matchId: 'match-1',
  seasonId: 'S',
  matchDate: '2026-11-28',
  time: '9:45 AM',
  opponent: 'Cool Stars',
  competition: 'League',
  ground: 'SCL5',
  status: 'UPCOMING' as const,
};

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  fetchUpcomingMatchesMock.mockReset().mockResolvedValue([MATCH]);
  calendarDaysUntilMock.mockReset().mockReturnValue(5);
  localHourMock.mockReset().mockReturnValue(8);
  sendInvitationsMock.mockReset().mockResolvedValue(undefined);
  sendRemindersMock.mockReset().mockResolvedValue(undefined);
  closeAndSendSummaryMock.mockReset().mockResolvedValue(undefined);
  Object.assign(process.env, ENV);
});

afterEach(() => {
  ddbMock.reset();
});

function invoke(event: Parameters<typeof handler>[0] = {}) {
  return handler(event);
}

const SNAPSHOT = { matchId: 'match-1', seasonId: 'S', matchDate: '2026-11-28', time: '9:45 AM', opponent: 'Cool Stars', competition: 'Final', ground: 'SCL5' };
const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

describe('coordinator handler', () => {
  it('claims and completes the invitation action when due and unclaimed', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    await invoke();

    expect(sendInvitationsMock).toHaveBeenCalledTimes(1);
    expect(sendRemindersMock).not.toHaveBeenCalled();
    expect(closeAndSendSummaryMock).not.toHaveBeenCalled();

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(2); // claim, then complete
    expect(updateCalls[1].args[0].input.ExpressionAttributeValues?.[':completed']).toBe('COMPLETED');
  });

  it('does not re-send when the invitation is already completed', async () => {
    ddbMock.on(GetCommand).callsFake((input: { Key: { actionId: string } }) =>
      input.Key.actionId === 'INVITATION#match-1' ? { Item: { status: 'COMPLETED' } } : {},
    );

    await invoke();

    expect(sendInvitationsMock).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('marks the action FAILED when the send throws, instead of COMPLETED', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
    sendInvitationsMock.mockRejectedValue(new Error('SES unavailable'));

    await invoke();

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(2); // claim, then fail
    expect(updateCalls[1].args[0].input.ExpressionAttributeValues?.[':failed']).toBe('FAILED');
    expect(updateCalls[1].args[0].input.ExpressionAttributeValues?.[':err']).toBe('SES unavailable');
  });

  it('skips matches that are not due yet', async () => {
    calendarDaysUntilMock.mockReturnValue(10);
    ddbMock.on(GetCommand).resolves({});

    await invoke();

    expect(sendInvitationsMock).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('routes a due REMINDER action to sendReminders once already invited', async () => {
    calendarDaysUntilMock.mockReturnValue(3);
    ddbMock.on(GetCommand).callsFake((input: { Key: { actionId: string } }) =>
      input.Key.actionId === 'INVITATION#match-1' ? { Item: { status: 'COMPLETED' } } : {},
    );
    ddbMock.on(UpdateCommand).resolves({});

    await invoke();

    expect(sendRemindersMock).toHaveBeenCalledTimes(1);
    expect(sendInvitationsMock).not.toHaveBeenCalled();
    expect(closeAndSendSummaryMock).not.toHaveBeenCalled();
  });

  it('routes a due CLOSURE action to closeAndSendSummary once already invited', async () => {
    calendarDaysUntilMock.mockReturnValue(2);
    ddbMock.on(GetCommand).callsFake((input: { Key: { actionId: string } }) =>
      input.Key.actionId === 'INVITATION#match-1' ? { Item: { status: 'COMPLETED' } } : {},
    );
    ddbMock.on(UpdateCommand).resolves({});

    await invoke();

    expect(closeAndSendSummaryMock).toHaveBeenCalledTimes(1);
    expect(sendRemindersMock).not.toHaveBeenCalled();
  });

  it('holds the closing of a hand-sent invitation until its own closing time', async () => {
    calendarDaysUntilMock.mockReturnValue(1);
    ddbMock.on(GetCommand).callsFake((input: { Key: { actionId: string } }) =>
      input.Key.actionId === 'INVITATION#match-1' ? { Item: { status: 'COMPLETED', closesAt: FUTURE } } : {},
    );
    await invoke();
    expect(closeAndSendSummaryMock).not.toHaveBeenCalled();

    ddbMock.on(GetCommand).callsFake((input: { Key: { actionId: string } }) =>
      input.Key.actionId === 'INVITATION#match-1' ? { Item: { status: 'COMPLETED', closesAt: PAST } } : {},
    );
    ddbMock.on(UpdateCommand).resolves({});
    await invoke();
    expect(closeAndSendSummaryMock).toHaveBeenCalledTimes(1);
  });
});

describe('coordinator: invitations sent by hand', () => {
  it('sends the claimed invitations with their own closing time and records success', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await invoke({ mode: 'manual-invitation', match: SNAPSHOT, closesAt: '2026-11-27T23:59:00.000+08:00' });

    expect(fetchUpcomingMatchesMock).not.toHaveBeenCalled();
    expect(sendInvitationsMock).toHaveBeenCalledTimes(1);
    const [match, closing] = sendInvitationsMock.mock.calls[0];
    expect(match).toMatchObject({ matchId: 'match-1', opponent: 'Cool Stars', status: 'UPCOMING' });
    expect(closing.toISO()).toBe('2026-11-27T23:59:00.000+08:00');
    // Already claimed by the admin function: only the COMPLETED write here.
    const updates = ddbMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0].input.ExpressionAttributeValues?.[':completed']).toBe('COMPLETED');
  });

  it('uses the normal deadline when none is given, and records a failure', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    sendInvitationsMock.mockRejectedValue(new Error('SES unavailable'));
    await invoke({ mode: 'manual-invitation', match: SNAPSHOT, closesAt: null });
    expect(sendInvitationsMock.mock.calls[0][1]).toBeUndefined();
    expect(ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues?.[':failed']).toBe('FAILED');
  });

  it('hourly: closes only hand-sent invitations whose closing time has passed', async () => {
    calendarDaysUntilMock.mockReturnValue(0);
    ddbMock.on(ScanCommand).resolves({
      Items: [
        { status: 'COMPLETED', closesAt: PAST, match: SNAPSHOT },
        { status: 'COMPLETED', closesAt: FUTURE, match: { ...SNAPSHOT, matchId: 'match-2' } },
        { status: 'FAILED', closesAt: PAST, match: { ...SNAPSHOT, matchId: 'match-3' } },
      ],
    });
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    localHourMock.mockReturnValue(0);
    await invoke({ mode: 'scheduled' });

    expect(fetchUpcomingMatchesMock).not.toHaveBeenCalled();
    expect(closeAndSendSummaryMock).toHaveBeenCalledTimes(1);
    expect(closeAndSendSummaryMock.mock.calls[0][0]).toMatchObject({ matchId: 'match-1' });
    expect(sendInvitationsMock).not.toHaveBeenCalled();
  });

  it('the 08:00 scheduled run does the full daily run', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
    await invoke({ mode: 'scheduled' });
    expect(fetchUpcomingMatchesMock).toHaveBeenCalledTimes(1);
    expect(sendInvitationsMock).toHaveBeenCalledTimes(1);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  it('hourly: does not close twice', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ status: 'COMPLETED', closesAt: PAST, match: SNAPSHOT }] });
    ddbMock.on(GetCommand).resolves({ Item: { status: 'COMPLETED' } });
    calendarDaysUntilMock.mockReturnValue(0);
    localHourMock.mockReturnValue(14);
    await invoke({ mode: 'scheduled' });
    expect(closeAndSendSummaryMock).not.toHaveBeenCalled();
  });
});

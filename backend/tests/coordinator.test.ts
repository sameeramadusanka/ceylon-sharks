import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchUpcomingMatchesMock = vi.fn();
vi.mock('../src/providers/githubMatchProvider.js', () => ({
  fetchUpcomingMatches: fetchUpcomingMatchesMock,
}));

const calendarDaysUntilMock = vi.fn();
vi.mock('../src/time.js', () => ({
  calendarDaysUntil: calendarDaysUntilMock,
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
  GITHUB_MATCH_DATA_BASE_URL: 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main',
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
  sendInvitationsMock.mockReset().mockResolvedValue(undefined);
  sendRemindersMock.mockReset().mockResolvedValue(undefined);
  closeAndSendSummaryMock.mockReset().mockResolvedValue(undefined);
  Object.assign(process.env, ENV);
});

afterEach(() => {
  ddbMock.reset();
});

function invoke() {
  return handler({} as never, {} as never, () => undefined) as Promise<void>;
}

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
});

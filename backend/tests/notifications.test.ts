import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadConfigMock = vi.fn();
vi.mock('../src/config.js', () => ({ loadConfig: loadConfigMock }));

const createDocumentClientMock = vi.fn();
vi.mock('../src/repositories/scheduledActionsRepository.js', () => ({ createDocumentClient: createDocumentClientMock }));

const listActiveMembersMock = vi.fn();
vi.mock('../src/repositories/teamMembersRepository.js', () => ({ listActiveMembers: listActiveMembersMock }));

const getInvitationMock = vi.fn();
const createInvitationMock = vi.fn();
const listByMatchMock = vi.fn();
const markReminderSentMock = vi.fn();
vi.mock('../src/repositories/matchAvailabilityRepository.js', () => ({
  getInvitation: getInvitationMock,
  createInvitation: createInvitationMock,
  listByMatch: listByMatchMock,
  markReminderSent: markReminderSentMock,
}));

const createSesClientMock = vi.fn();
const sendEmailMock = vi.fn();
vi.mock('../src/email/sesClient.js', () => ({ createSesClient: createSesClientMock, sendEmail: sendEmailMock }));

const { sendInvitations, sendReminders, closeAndSendSummary } = await import('../src/notifications.js');

const CONFIG = {
  teamMembersTable: 'TeamMembers',
  matchAvailabilityTable: 'MatchAvailability',
  scheduledActionsTable: 'ScheduledActions',
  githubMatchDataBaseUrl: 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main',
  availabilityFrontendUrl: 'https://ceylonsharks.com',
  sesFromEmail: 'noreply@ceylonsharks.com',
  captainEmail: 'captain@example.com',
  viceCaptainEmail: 'vice@example.com',
  timeZone: 'Asia/Singapore',
  invitationDaysBefore: 5,
  reminderDaysBefore: 3,
  closureDaysBefore: 2,
  closureLocalTime: '23:59',
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

beforeEach(() => {
  vi.useFakeTimers();
  loadConfigMock.mockReset().mockReturnValue(CONFIG);
  createDocumentClientMock.mockReset().mockReturnValue({});
  createSesClientMock.mockReset().mockReturnValue({});
  sendEmailMock.mockReset().mockResolvedValue(undefined);
  getInvitationMock.mockReset().mockResolvedValue(null);
  createInvitationMock.mockReset().mockResolvedValue(undefined);
  listByMatchMock.mockReset().mockResolvedValue([]);
  markReminderSentMock.mockReset().mockResolvedValue(undefined);
  listActiveMembersMock.mockReset().mockResolvedValue([
    { email: 'a@example.com', name: 'Player A', role: 'PLAYER', isActive: true },
    { email: 'b@example.com', name: 'Player B', role: 'PLAYER', isActive: true },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

async function invoke(fn: (match: typeof MATCH) => Promise<void> = sendInvitations) {
  const promise = fn(MATCH);
  promise.catch(() => undefined); // attach a handler immediately so advancing fake timers below never reports this as unhandled
  await vi.runAllTimersAsync();
  return promise;
}

function record(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    matchId: MATCH.matchId,
    playerEmail: 'a@example.com',
    playerName: 'Player A',
    availability: 'NOT_SUBMITTED',
    tokenHash: 'old-hash',
    tokenExpiry: Math.floor(Date.now() / 1000) + 10_000,
    invitationSentAt: '2026-11-19T00:00:00.000Z',
    createdAt: '2026-11-19T00:00:00.000Z',
    opponent: MATCH.opponent,
    competition: MATCH.competition,
    matchDate: MATCH.matchDate,
    ...overrides,
  };
}

describe('sendInvitations', () => {
  it('sends to every active member and records the invitation after a successful send', async () => {
    await invoke();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(createInvitationMock).toHaveBeenCalledTimes(2);
  });

  it('carries the match time and ground through into the stored invitation record', async () => {
    await invoke();
    const storedRecord = createInvitationMock.mock.calls[0][2];
    expect(storedRecord.time).toBe(MATCH.time);
    expect(storedRecord.ground).toBe(MATCH.ground);
  });

  it('skips a member who already has an invitation record for this match', async () => {
    getInvitationMock.mockImplementation(async (_doc: unknown, _table: unknown, _matchId: unknown, email: string) =>
      email === 'a@example.com' ? { matchId: 'match-1' } : null,
    );
    await invoke();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1].to).toEqual(['b@example.com']);
  });

  it('does not write a DB record when the send fails, and throws an aggregate error naming the failure count', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('SES throttled')).mockResolvedValueOnce(undefined);
    await expect(invoke()).rejects.toThrow(/1\/2/);
    expect(createInvitationMock).toHaveBeenCalledTimes(1);
  });
});

describe('sendReminders', () => {
  it('reminds only players who are still NOT_SUBMITTED and not yet reminded', async () => {
    listByMatchMock.mockResolvedValue([
      record({ playerEmail: 'a@example.com', availability: 'NOT_SUBMITTED' }),
      record({ playerEmail: 'b@example.com', availability: 'AVAILABLE' }),
      record({ playerEmail: 'c@example.com', availability: 'NOT_SUBMITTED', reminderSentAt: '2026-11-19T00:00:00.000Z' }),
    ]);

    await invoke(sendReminders);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1].to).toEqual(['a@example.com']);
  });

  it('mints a fresh token and overwrites the stored hash rather than reusing the old one', async () => {
    listByMatchMock.mockResolvedValue([record({ tokenHash: 'old-hash' })]);
    await invoke(sendReminders);

    expect(markReminderSentMock).toHaveBeenCalledTimes(1);
    const newTokenHash = markReminderSentMock.mock.calls[0][3];
    expect(newTokenHash).not.toBe('old-hash');
    const sentLink = sendEmailMock.mock.calls[0][1].html as string;
    expect(sentLink).not.toContain('old-hash');
  });

  it('does not mark reminderSentAt when the send fails, and throws an aggregate error', async () => {
    listByMatchMock.mockResolvedValue([record({ playerEmail: 'a@example.com' }), record({ playerEmail: 'b@example.com' })]);
    sendEmailMock.mockRejectedValueOnce(new Error('SES throttled')).mockResolvedValueOnce(undefined);

    await expect(invoke(sendReminders)).rejects.toThrow(/1\/2/);
    expect(markReminderSentMock).toHaveBeenCalledTimes(1);
  });

  it('a duplicate invocation after a partial success does not re-remind the player who already got one', async () => {
    // First run: two pending, one succeeds (gets reminderSentAt), one fails.
    listByMatchMock.mockResolvedValueOnce([record({ playerEmail: 'a@example.com' }), record({ playerEmail: 'b@example.com' })]);
    sendEmailMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SES throttled'));
    await expect(invoke(sendReminders)).rejects.toThrow();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    // Retry: the repository now reflects that "a" has reminderSentAt set, "b" still doesn't.
    sendEmailMock.mockReset().mockResolvedValue(undefined);
    listByMatchMock.mockResolvedValueOnce([
      record({ playerEmail: 'a@example.com', reminderSentAt: '2026-11-19T00:00:00.000Z' }),
      record({ playerEmail: 'b@example.com' }),
    ]);
    await invoke(sendReminders);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][1].to).toEqual(['b@example.com']);
  });
});

describe('closeAndSendSummary', () => {
  it('groups players by availability and sends one summary to captain and vice-captain', async () => {
    listByMatchMock.mockResolvedValue([
      record({ playerEmail: 'a@example.com', playerName: 'Player A', availability: 'AVAILABLE' }),
      record({ playerEmail: 'b@example.com', playerName: 'Player B', availability: 'UNAVAILABLE' }),
      record({ playerEmail: 'c@example.com', playerName: 'Player C', availability: 'MAYBE' }),
      record({ playerEmail: 'd@example.com', playerName: 'Player D', availability: 'NOT_SUBMITTED' }),
    ]);

    await invoke(closeAndSendSummary);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][1];
    expect(call.to).toEqual([CONFIG.captainEmail, CONFIG.viceCaptainEmail]);
    expect(call.text).toContain('Available (1): Player A');
    expect(call.text).toContain('No response (1): Player D');
  });

  it('generates the summary fresh from the repository every call, including a retry', async () => {
    listByMatchMock.mockResolvedValueOnce([record({ availability: 'AVAILABLE' })]);
    await invoke(closeAndSendSummary);
    listByMatchMock.mockResolvedValueOnce([record({ availability: 'AVAILABLE' }), record({ playerEmail: 'b@example.com', availability: 'MAYBE' })]);
    await invoke(closeAndSendSummary);

    expect(listByMatchMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock.mock.calls[1][1].text).toContain('Total invited: 2');
  });
});

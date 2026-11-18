import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadConfigMock = vi.fn();
vi.mock('../src/config.js', () => ({ loadConfig: loadConfigMock }));

const createDocumentClientMock = vi.fn();
vi.mock('../src/repositories/scheduledActionsRepository.js', () => ({ createDocumentClient: createDocumentClientMock }));

const listActiveMembersMock = vi.fn();
vi.mock('../src/repositories/teamMembersRepository.js', () => ({ listActiveMembers: listActiveMembersMock }));

const getInvitationMock = vi.fn();
const createInvitationMock = vi.fn();
vi.mock('../src/repositories/matchAvailabilityRepository.js', () => ({
  getInvitation: getInvitationMock,
  createInvitation: createInvitationMock,
}));

const createSesClientMock = vi.fn();
const sendEmailMock = vi.fn();
vi.mock('../src/email/sesClient.js', () => ({ createSesClient: createSesClientMock, sendEmail: sendEmailMock }));

const { sendInvitations } = await import('../src/notifications.js');

const CONFIG = {
  teamMembersTable: 'TeamMembers',
  matchAvailabilityTable: 'MatchAvailability',
  scheduledActionsTable: 'ScheduledActions',
  githubMatchDataBaseUrl: 'https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main',
  availabilityFrontendUrl: 'https://www.ceylonsharks.com',
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
  listActiveMembersMock.mockReset().mockResolvedValue([
    { email: 'a@example.com', name: 'Player A', role: 'PLAYER', isActive: true },
    { email: 'b@example.com', name: 'Player B', role: 'PLAYER', isActive: true },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

async function invoke() {
  const promise = sendInvitations(MATCH);
  promise.catch(() => undefined); // attach a handler immediately so advancing fake timers below never reports this as unhandled
  await vi.runAllTimersAsync();
  return promise;
}

describe('sendInvitations', () => {
  it('sends to every active member and records the invitation after a successful send', async () => {
    await invoke();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(createInvitationMock).toHaveBeenCalledTimes(2);
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

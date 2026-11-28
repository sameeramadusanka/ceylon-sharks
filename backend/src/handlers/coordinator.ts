import { DateTime } from 'luxon';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { fetchUpcomingMatches, type Match } from '../providers/githubMatchProvider.js';
import { calendarDaysUntil, localHour } from '../time.js';
import { determineDueActions } from '../dueActions.js';
import {
  claimAction,
  createDocumentClient,
  getAction,
  getActionStatus,
  listCustomClosings,
  markActionCompleted,
  markActionFailed,
  type ActionType,
  type ManualInvitationMatch,
} from '../repositories/scheduledActionsRepository.js';
import { sendInvitations, sendReminders, closeAndSendSummary } from '../notifications.js';

const ACTION_HANDLERS: Record<ActionType, (match: Match) => Promise<void>> = {
  INVITATION: (match) => sendInvitations(match),
  REMINDER: sendReminders,
  CLOSURE: closeAndSendSummary,
};

/** The local hour (in TIME_ZONE) of the scheduled run that does the daily work. */
export const DAILY_RUN_HOUR = 8;

/**
 * What started this run:
 *  - "scheduled" (the hourly schedule): the daily run at 08:00, and in the
 *    other hours only closings of hand-sent invitations whose own closing time has passed;
 *  - nothing (e.g. `aws lambda invoke` by hand): the daily run, now;
 *  - "manual-invitation" (the admin Schedule tab): send one match's invitations now. The admin
 *    function has already claimed the INVITATION action, so this only sends and records the outcome.
 */
export interface ManualInvitationEvent {
  mode: 'manual-invitation';
  match: ManualInvitationMatch;
  /** ISO instant availability closes when the normal deadline had already gone; null = the normal deadline. */
  closesAt: string | null;
}
export type CoordinatorEvent = ManualInvitationEvent | { mode: 'scheduled' } | { mode?: undefined };

/** PROCESSING/COMPLETED block a re-claim; FAILED is retryable (see claimAction). */
function isClaimed(status: string | null | undefined): boolean {
  return status === 'PROCESSING' || status === 'COMPLETED';
}

function toMatch(snapshot: ManualInvitationMatch): Match {
  return { ...snapshot, status: 'UPCOMING' };
}

type Config = ReturnType<typeof loadConfig>;
type DocClient = ReturnType<typeof createDocumentClient>;

/** Runs an action this run has already claimed, and records whether it worked. */
async function runClaimed(docClient: DocClient, config: Config, actionType: ActionType, matchId: string, send: () => Promise<void>, note: string): Promise<void> {
  try {
    await send();
    await markActionCompleted(docClient, config.scheduledActionsTable, actionType, matchId);
    logger.info('action completed', { matchId, actionType, result: note });
  } catch (error) {
    const summary = error instanceof Error ? error.message : 'unknown error';
    await markActionFailed(docClient, config.scheduledActionsTable, actionType, matchId, summary);
    logger.error('action failed', { matchId, actionType, errorCategory: summary });
  }
}

async function claimAndRun(docClient: DocClient, config: Config, actionType: ActionType, match: Match, note: string): Promise<void> {
  const claimed = await claimAction(docClient, config.scheduledActionsTable, { actionType, matchId: match.matchId, scheduledFor: new Date().toISOString() });
  if (!claimed) {
    logger.info('action already claimed, skipping', { matchId: match.matchId, actionType });
    return;
  }
  await runClaimed(docClient, config, actionType, match.matchId, () => ACTION_HANDLERS[actionType](match), note);
}

async function dailyRun(docClient: DocClient, config: Config): Promise<void> {
  const matches = await fetchUpcomingMatches(config.githubMatchDataBaseUrl);
  logger.info('fetched upcoming matches', { result: `${matches.length} upcoming` });

  for (const match of matches) {
    const daysUntilMatch = calendarDaysUntil(match.matchDate, config.timeZone);

    const [invitation, reminderStatus, closureStatus] = await Promise.all([
      getAction(docClient, config.scheduledActionsTable, 'INVITATION', match.matchId),
      getActionStatus(docClient, config.scheduledActionsTable, 'REMINDER', match.matchId),
      getActionStatus(docClient, config.scheduledActionsTable, 'CLOSURE', match.matchId),
    ]);

    const dueActions = determineDueActions({
      daysUntilMatch,
      invitationClaimed: isClaimed(invitation?.status),
      reminderClaimed: isClaimed(reminderStatus),
      closureClaimed: isClaimed(closureStatus),
      invitationDaysBefore: config.invitationDaysBefore,
      reminderDaysBefore: config.reminderDaysBefore,
      closureDaysBefore: config.closureDaysBefore,
      customClosing: invitation?.closesAt ? { passed: Date.now() >= Date.parse(invitation.closesAt) } : undefined,
    });

    for (const due of dueActions) {
      await claimAndRun(docClient, config, due.actionType, match, due.late ? 'late' : 'on-time');
    }
  }
}

/** Hourly: closes hand-sent invitations at their own closing time, so the summary isn't held until the next 8 AM run. */
async function closingCheck(docClient: DocClient, config: Config): Promise<void> {
  const closings = await listCustomClosings(docClient, config.scheduledActionsTable);
  for (const invitation of closings) {
    if (!isClaimed(invitation.status) || Date.now() < Date.parse(invitation.closesAt)) continue;
    if (calendarDaysUntil(invitation.match.matchDate, config.timeZone) < 0) continue;
    const closureStatus = await getActionStatus(docClient, config.scheduledActionsTable, 'CLOSURE', invitation.match.matchId);
    if (isClaimed(closureStatus)) continue;
    await claimAndRun(docClient, config, 'CLOSURE', toMatch(invitation.match), 'own closing time');
  }
}

export const handler = async (event?: CoordinatorEvent): Promise<void> => {
  const config = loadConfig();
  const docClient = createDocumentClient();

  if (event?.mode === 'manual-invitation') {
    const match = toMatch(event.match);
    const closing = event.closesAt ? DateTime.fromISO(event.closesAt, { zone: config.timeZone }) : undefined;
    await runClaimed(docClient, config, 'INVITATION', match.matchId, () => sendInvitations(match, closing), 'sent by hand');
    return;
  }
  if (event?.mode === 'scheduled' && localHour(config.timeZone) !== DAILY_RUN_HOUR) {
    await closingCheck(docClient, config);
    return;
  }
  await dailyRun(docClient, config);
};

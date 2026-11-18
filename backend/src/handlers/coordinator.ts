import type { ScheduledHandler } from 'aws-lambda';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { fetchUpcomingMatches, type Match } from '../providers/githubMatchProvider.js';
import { calendarDaysUntil } from '../time.js';
import { determineDueActions } from '../dueActions.js';
import {
  claimAction,
  createDocumentClient,
  getActionStatus,
  markActionCompleted,
  markActionFailed,
  type ActionType,
} from '../repositories/scheduledActionsRepository.js';
import { sendInvitations, sendReminders, closeAndSendSummary } from '../notifications.js';

const ACTION_HANDLERS: Record<ActionType, (match: Match) => Promise<void>> = {
  INVITATION: sendInvitations,
  REMINDER: sendReminders,
  CLOSURE: closeAndSendSummary,
};

/** PROCESSING/COMPLETED block a re-claim; FAILED is retryable (see claimAction). */
function isClaimed(status: string | null): boolean {
  return status === 'PROCESSING' || status === 'COMPLETED';
}

export const handler: ScheduledHandler = async () => {
  const config = loadConfig();
  const docClient = createDocumentClient();

  const matches = await fetchUpcomingMatches(config.githubMatchDataBaseUrl);
  logger.info('fetched upcoming matches', { result: `${matches.length} upcoming` });

  for (const match of matches) {
    const daysUntilMatch = calendarDaysUntil(match.matchDate, config.timeZone);

    const [invitationStatus, reminderStatus, closureStatus] = await Promise.all([
      getActionStatus(docClient, config.scheduledActionsTable, 'INVITATION', match.matchId),
      getActionStatus(docClient, config.scheduledActionsTable, 'REMINDER', match.matchId),
      getActionStatus(docClient, config.scheduledActionsTable, 'CLOSURE', match.matchId),
    ]);

    const dueActions = determineDueActions({
      daysUntilMatch,
      invitationClaimed: isClaimed(invitationStatus),
      reminderClaimed: isClaimed(reminderStatus),
      closureClaimed: isClaimed(closureStatus),
      invitationDaysBefore: config.invitationDaysBefore,
      reminderDaysBefore: config.reminderDaysBefore,
      closureDaysBefore: config.closureDaysBefore,
    });

    for (const due of dueActions) {
      const claimed = await claimAction(docClient, config.scheduledActionsTable, {
        actionType: due.actionType,
        matchId: match.matchId,
        scheduledFor: new Date().toISOString(),
      });
      if (!claimed) {
        logger.info('action already claimed, skipping', { matchId: match.matchId, actionType: due.actionType });
        continue;
      }

      try {
        await ACTION_HANDLERS[due.actionType](match);
        await markActionCompleted(docClient, config.scheduledActionsTable, due.actionType, match.matchId);
        logger.info('action completed', { matchId: match.matchId, actionType: due.actionType, result: due.late ? 'late' : 'on-time' });
      } catch (error) {
        const summary = error instanceof Error ? error.message : 'unknown error';
        await markActionFailed(docClient, config.scheduledActionsTable, due.actionType, match.matchId, summary);
        logger.error('action failed', { matchId: match.matchId, actionType: due.actionType, errorCategory: summary });
      }
    }
  }
};

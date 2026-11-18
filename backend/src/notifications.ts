import type { Match } from './providers/githubMatchProvider.js';
import { logger } from './logger.js';

/**
 * Phase 2 scaffold only. These exist so the coordinator can claim and
 * complete actions end-to-end for testing without sending real emails.
 * Phase 3 replaces sendInvitations/submit-triggered notifications, and
 * Phase 4 replaces sendReminders/closeAndSendSummary, with real SES
 * sends and DynamoDB writes to TeamMembers/MatchAvailability.
 */

export async function sendInvitations(match: Match): Promise<void> {
  logger.info('would send invitations (not yet implemented)', { matchId: match.matchId, actionType: 'INVITATION' });
}

export async function sendReminders(match: Match): Promise<void> {
  logger.info('would send reminders (not yet implemented)', { matchId: match.matchId, actionType: 'REMINDER' });
}

export async function closeAndSendSummary(match: Match): Promise<void> {
  logger.info('would close availability and send summary (not yet implemented)', { matchId: match.matchId, actionType: 'CLOSURE' });
}

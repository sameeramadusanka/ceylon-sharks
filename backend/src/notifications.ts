import type { Match } from './providers/githubMatchProvider.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { closureDeadline } from './time.js';
import { generateToken } from './token.js';
import { createDocumentClient } from './repositories/scheduledActionsRepository.js';
import { createInvitation, getInvitation } from './repositories/matchAvailabilityRepository.js';
import { listActiveMembers } from './repositories/teamMembersRepository.js';
import { createSesClient, sendEmail } from './email/sesClient.js';
import { invitationEmail } from './email/templates.js';

/**
 * Phase 3 scaffold for Phase 4: sendReminders and closeAndSendSummary
 * remain log-only stubs. Their real logic (reminder recipient selection,
 * per-recipient delivery tracking, final summary) is explicitly Phase 4
 * scope in the plan doc.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// SES sandbox in this account confirmed MaxSendRate: 1 request/second (ap-southeast-1).
const SES_SEND_PACING_MS = 1100;

export async function sendInvitations(match: Match): Promise<void> {
  const config = loadConfig();
  const docClient = createDocumentClient();
  const sesClient = createSesClient();

  const members = await listActiveMembers(docClient, config.teamMembersTable);
  const deadline = closureDeadline(match.matchDate, config.timeZone, config.closureDaysBefore, config.closureLocalTime);
  const tokenExpiry = Math.floor(deadline.toSeconds());
  const deadlineLabel = deadline.toFormat('dd LLL yyyy HH:mm');

  const failures: string[] = [];

  for (const member of members) {
    try {
      // A MatchAvailability record is only written after a successful send
      // (see below), so its presence means this player was already
      // invited - skip them on a retry rather than sending a second email
      // with a second, different token.
      const existing = await getInvitation(docClient, config.matchAvailabilityTable, match.matchId, member.email);
      if (existing) continue;

      const { rawToken, tokenHash } = generateToken();
      const magicLink = `${config.availabilityFrontendUrl}/availability/respond?token=${rawToken}`;
      const { subject, text, html } = invitationEmail({
        playerName: member.name,
        opponent: match.opponent,
        matchDate: match.matchDate,
        competition: match.competition,
        deadline: deadlineLabel,
        magicLink,
      });

      await sendEmail(sesClient, { from: config.sesFromEmail, to: [member.email], subject, html, text });

      const now = new Date().toISOString();
      await createInvitation(docClient, config.matchAvailabilityTable, {
        matchId: match.matchId,
        playerEmail: member.email,
        playerName: member.name,
        availability: 'NOT_SUBMITTED',
        tokenHash,
        tokenExpiry,
        invitationSentAt: now,
        createdAt: now,
        opponent: match.opponent,
        competition: match.competition,
        matchDate: match.matchDate,
      });

      logger.info('invitation sent', { matchId: match.matchId, actionType: 'INVITATION', recipient: member.email });
    } catch (error) {
      logger.error('failed to send invitation to a player', {
        matchId: match.matchId,
        actionType: 'INVITATION',
        recipient: member.email,
        errorCategory: error instanceof Error ? error.message : 'unknown error',
      });
      failures.push(member.email);
    }

    await sleep(SES_SEND_PACING_MS);
  }

  if (failures.length > 0) {
    throw new Error(`Failed to send invitations to ${failures.length}/${members.length} player(s)`);
  }
}

export async function sendReminders(match: Match): Promise<void> {
  logger.info('would send reminders (not yet implemented)', { matchId: match.matchId, actionType: 'REMINDER' });
}

export async function closeAndSendSummary(match: Match): Promise<void> {
  logger.info('would close availability and send summary (not yet implemented)', { matchId: match.matchId, actionType: 'CLOSURE' });
}

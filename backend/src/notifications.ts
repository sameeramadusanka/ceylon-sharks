import type { Match } from './providers/githubMatchProvider.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { closureDeadline } from './time.js';
import { generateToken } from './token.js';
import { createDocumentClient } from './repositories/scheduledActionsRepository.js';
import { createInvitation, getInvitation, listByMatch, markReminderSent } from './repositories/matchAvailabilityRepository.js';
import { listActiveMembers } from './repositories/teamMembersRepository.js';
import { createSesClient, sendEmail } from './email/sesClient.js';
import { finalSummaryEmail, invitationEmail, reminderEmail } from './email/templates.js';

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
  const config = loadConfig();
  const docClient = createDocumentClient();
  const sesClient = createSesClient();

  const records = await listByMatch(docClient, config.matchAvailabilityTable, match.matchId);
  // reminderSentAt is the per-recipient delivery marker here, mirroring how
  // sendInvitations uses "does an invitation record exist" - a retry after a
  // partial failure only re-sends to players who are still both NOT_SUBMITTED
  // and not yet reminded.
  const pending = records.filter((record) => record.availability === 'NOT_SUBMITTED' && !record.reminderSentAt);

  const deadline = closureDeadline(match.matchDate, config.timeZone, config.closureDaysBefore, config.closureLocalTime);
  const deadlineLabel = deadline.toFormat('dd LLL yyyy HH:mm');

  const failures: string[] = [];

  for (const record of pending) {
    try {
      // Only the token hash was ever persisted, so the reminder cannot reuse
      // the original link - it mints a fresh token and invalidates the old
      // hash, which the plan doc explicitly allows (section 9.2).
      const { rawToken, tokenHash } = generateToken();
      const magicLink = `${config.availabilityFrontendUrl}/availability/respond?token=${rawToken}`;
      const { subject, text, html } = reminderEmail({
        playerName: record.playerName,
        opponent: record.opponent,
        matchDate: record.matchDate,
        competition: record.competition,
        deadline: deadlineLabel,
        magicLink,
      });

      await sendEmail(sesClient, { from: config.sesFromEmail, to: [record.playerEmail], subject, html, text });

      const now = new Date().toISOString();
      await markReminderSent(docClient, config.matchAvailabilityTable, match.matchId, record.playerEmail, tokenHash, now);

      logger.info('reminder sent', { matchId: match.matchId, actionType: 'REMINDER', recipient: record.playerEmail });
    } catch (error) {
      logger.error('failed to send reminder to a player', {
        matchId: match.matchId,
        actionType: 'REMINDER',
        recipient: record.playerEmail,
        errorCategory: error instanceof Error ? error.message : 'unknown error',
      });
      failures.push(record.playerEmail);
    }

    await sleep(SES_SEND_PACING_MS);
  }

  if (failures.length > 0) {
    throw new Error(`Failed to send reminders to ${failures.length}/${pending.length} player(s)`);
  }
}

export async function closeAndSendSummary(match: Match): Promise<void> {
  const config = loadConfig();
  const docClient = createDocumentClient();
  const sesClient = createSesClient();

  // Generated fresh from DynamoDB on every run (including a retry after a
  // prior failure), never cached - the plan doc requires the summary to
  // reflect the database, not client-side state.
  const records = await listByMatch(docClient, config.matchAvailabilityTable, match.matchId);

  const byAvailability = (status: (typeof records)[number]['availability']) =>
    records.filter((record) => record.availability === status).map((record) => record.playerName);

  const { subject, text, html } = finalSummaryEmail({
    opponent: match.opponent,
    matchDate: match.matchDate,
    totalInvited: records.length,
    available: byAvailability('AVAILABLE'),
    unavailable: byAvailability('UNAVAILABLE'),
    maybe: byAvailability('MAYBE'),
    noResponse: byAvailability('NOT_SUBMITTED'),
  });

  await sendEmail(sesClient, { from: config.sesFromEmail, to: [config.captainEmail, config.viceCaptainEmail], subject, html, text });

  logger.info('final summary sent', { matchId: match.matchId, actionType: 'CLOSURE', result: `${records.length} invited` });
}

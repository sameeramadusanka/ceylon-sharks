import { loadConfig, type AvailabilityConfig } from '../config.js';
import { createSesClient, sendEmail, type EmailContent } from '../email/sesClient.js';
import {
  logoUrlFor,
  playerOfTheWeekCongratsEmail,
  playerOfTheWeekLiveAdminEmail,
  playerOfTheWeekNotLiveAdminEmail,
  type PlayerEmailOutcome,
  type PlayerOfTheWeekEmailParams,
} from '../email/templates.js';
import { logger } from '../logger.js';
import { createDocumentClient } from '../repositories/scheduledActionsRepository.js';
import { listActiveMembers, type TeamMember } from '../repositories/teamMembersRepository.js';

// Invoked asynchronously by publishPlayerOfTheWeek after its commit lands.
// The site takes a few minutes to rebuild, so this waits until the new share
// page is actually live before emailing - a link that 404s would be a poor
// congratulations. If it never goes live, the publishers get a warning instead
// and the player isn't emailed.

export interface NotifyPlayerOfTheWeekEvent {
  season: string;
  date: string;
  playerId: number;
  details: {
    playerName: string;
    opponent: string;
    competition?: string;
    batting?: string;
    bowling?: string;
    fielding?: string;
    wicketKeeping?: string;
    caption?: string;
  };
  /** False when "Email the player" was unticked. */
  notifyPlayer: boolean;
  replaced: boolean;
  publishedBy: string;
  commitUrl: string;
}

export interface NotifyDeps {
  config: Pick<AvailabilityConfig, 'availabilityFrontendUrl' | 'sesFromEmail' | 'captainEmail' | 'viceCaptainEmail' | 'playerOfTheWeekOwnerEmail' | 'teamMembersTable'>;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  send: (content: EmailContent) => Promise<void>;
  listMembers: () => Promise<TeamMember[]>;
  /** Milliseconds; injectable so tests don't wait. */
  timing?: { firstCheckAfter: number; interval: number; giveUpAfter: number };
}

// The Pages deploy usually takes ~3 minutes; give it up to 12 before warning.
const DEFAULT_TIMING = { firstCheckAfter: 60_000, interval: 30_000, giveUpAfter: 12 * 60_000 };
// SES sandbox in this account allows 1 send/second - see notifications.ts.
const SES_SEND_PACING_MS = 1100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function displayDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const escapeForHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

/** True once the share page is served and shows this winner (a replaced date's old page also returns 200). */
export async function isPageLive(fetchImpl: typeof fetch, pageUrl: string, playerName: string): Promise<boolean> {
  try {
    // A unique query string skips the CDN's cached copy of the old page.
    const response = await fetchImpl(`${pageUrl}?check=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (response.status !== 200) return false;
    const html = await response.text();
    return html.includes(playerName) || html.includes(escapeForHtml(playerName));
  } catch {
    return false;
  }
}

export async function waitForPage(deps: NotifyDeps, pageUrl: string, playerName: string): Promise<boolean> {
  const timing = deps.timing ?? DEFAULT_TIMING;
  await deps.sleep(timing.firstCheckAfter);
  for (let waited = timing.firstCheckAfter; ; waited += timing.interval) {
    if (await isPageLive(deps.fetchImpl, pageUrl, playerName)) return true;
    if (waited + timing.interval > timing.giveUpAfter) return false;
    await deps.sleep(timing.interval);
  }
}

/** The winner's row in the team list: by player ID first, then by exact name. */
export function findWinner(members: TeamMember[], playerId: number, playerName: string): TeamMember | undefined {
  const byId = members.find((member) => member.playerId !== undefined && String(member.playerId).trim() === String(playerId));
  if (byId) return byId;
  const name = playerName.trim().toLowerCase();
  return members.find((member) => member.name.trim().toLowerCase() === name);
}

export function publisherEmails(config: Pick<AvailabilityConfig, 'captainEmail' | 'viceCaptainEmail' | 'playerOfTheWeekOwnerEmail'>): string[] {
  const emails = [config.captainEmail, config.viceCaptainEmail, config.playerOfTheWeekOwnerEmail].map((email) => email.trim().toLowerCase()).filter((email) => email && email !== 'none');
  return Array.from(new Set(emails));
}

export async function notifyPlayerOfTheWeek(event: NotifyPlayerOfTheWeekEvent, deps: NotifyDeps): Promise<{ live: boolean; playerEmail: PlayerEmailOutcome | null }> {
  const { config } = deps;
  const siteUrl = config.availabilityFrontendUrl.replace(/\/+$/, '');
  const pageUrl = `${siteUrl}/player-of-the-week/${event.date}/`;
  const { details } = event;

  const card: PlayerOfTheWeekEmailParams = {
    playerName: details.playerName,
    opponent: details.opponent,
    displayDate: displayDate(event.date),
    competition: details.competition,
    figures: [
      { label: 'Batting', value: details.batting ?? '' },
      { label: 'Bowling', value: details.bowling ?? '' },
      { label: 'Fielding', value: details.fielding ?? '' },
      { label: 'Wicket keeping', value: details.wicketKeeping ?? '' },
    ].filter((figure) => figure.value.trim() !== ''),
    caption: details.caption,
    pageUrl,
    logoUrl: logoUrlFor(siteUrl),
  };
  const admins = publisherEmails(config);
  const adminBase = { ...card, publishedBy: event.publishedBy, replaced: event.replaced, commitUrl: event.commitUrl };

  const live = await waitForPage(deps, pageUrl, details.playerName);
  if (!live) {
    logger.warn('player of the week page not live in time', { date: event.date, playerId: event.playerId, result: 'not-live' });
    if (admins.length) {
      const email = playerOfTheWeekNotLiveAdminEmail(adminBase);
      await deps.send({ from: config.sesFromEmail, to: admins, ...email });
    }
    return { live: false, playerEmail: null };
  }

  let playerEmail: PlayerEmailOutcome = 'skipped';
  if (event.notifyPlayer) {
    const winner = findWinner(await deps.listMembers(), event.playerId, details.playerName);
    if (!winner) {
      playerEmail = 'no-email';
    } else {
      try {
        await deps.send({ from: config.sesFromEmail, to: [winner.email], ...playerOfTheWeekCongratsEmail(card) });
        playerEmail = 'sent';
      } catch (error) {
        playerEmail = 'failed';
        logger.error('player of the week congratulations email failed', { recipient: winner.email, errorCategory: error instanceof Error ? error.message : 'unknown error' });
      }
      await deps.sleep(SES_SEND_PACING_MS);
    }
  }

  if (admins.length) {
    await deps.send({ from: config.sesFromEmail, to: admins, ...playerOfTheWeekLiveAdminEmail({ ...adminBase, playerEmail }) });
  }
  logger.info('player of the week notifications sent', { date: event.date, playerId: event.playerId, result: playerEmail });
  return { live: true, playerEmail };
}

export const handler = async (event: NotifyPlayerOfTheWeekEvent): Promise<void> => {
  const config = loadConfig();
  const docClient = createDocumentClient();
  const sesClient = createSesClient();
  await notifyPlayerOfTheWeek(event, {
    config,
    fetchImpl: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    send: (content) => sendEmail(sesClient, content),
    listMembers: () => listActiveMembers(docClient, config.teamMembersTable),
  });
};

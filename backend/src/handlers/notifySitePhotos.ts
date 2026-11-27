import { loadConfig, loadPublishConfig, type AvailabilityConfig } from '../config.js';
import { createSesClient, sendEmail, type EmailContent } from '../email/sesClient.js';
import { logoUrlFor, sitePhotosLiveEmail, sitePhotosNotLiveEmail } from '../email/templates.js';
import { createGithubClient } from '../github/githubClient.js';
import { getGithubToken } from '../github/githubToken.js';
import { logger } from '../logger.js';
import { publisherEmails } from './notifyPlayerOfTheWeek.js';

// Invoked asynchronously by the site-photos publish once its commit lands.
// Waits until the live site was built from that commit (or a later one), then
// emails the captain, vice-captain and site owner. The site writes the commit
// it was built from to /build-info.json (src/pages/build-info.json.ts).

export interface NotifySitePhotosEvent {
  commitSha: string;
  commitUrl: string;
  publishedBy: string;
  summary: string[];
}

export interface NotifySitePhotosDeps {
  config: Pick<AvailabilityConfig, 'availabilityFrontendUrl' | 'sesFromEmail' | 'captainEmail' | 'viceCaptainEmail' | 'playerOfTheWeekOwnerEmail'>;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  send: (content: EmailContent) => Promise<void>;
  /** True if the deployed commit includes ours (same commit or a later one). */
  containsCommit: (ours: string, deployed: string) => Promise<boolean>;
  timing?: { firstCheckAfter: number; interval: number; giveUpAfter: number };
}

// The Pages deploy usually takes ~3 minutes; give it up to 12 before warning.
const DEFAULT_TIMING = { firstCheckAfter: 60_000, interval: 30_000, giveUpAfter: 12 * 60_000 };

/** The commit the live site was built from, or null if it can't be read. */
export async function deployedCommit(fetchImpl: typeof fetch, siteUrl: string): Promise<string | null> {
  try {
    // A unique query string skips the CDN's cached copy.
    const response = await fetchImpl(`${siteUrl}/build-info.json?check=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (response.status !== 200) return null;
    const body = (await response.json()) as { commit?: unknown };
    return typeof body.commit === 'string' && body.commit ? body.commit : null;
  } catch {
    return null;
  }
}

async function isLive(deps: NotifySitePhotosDeps, siteUrl: string, commitSha: string): Promise<boolean> {
  const deployed = await deployedCommit(deps.fetchImpl, siteUrl);
  if (!deployed) return false;
  try {
    return await deps.containsCommit(commitSha, deployed);
  } catch {
    return false;
  }
}

export async function notifySitePhotos(event: NotifySitePhotosEvent, deps: NotifySitePhotosDeps): Promise<{ live: boolean }> {
  const { config } = deps;
  const siteUrl = config.availabilityFrontendUrl.replace(/\/+$/, '');
  const timing = deps.timing ?? DEFAULT_TIMING;
  const admins = publisherEmails(config);
  const params = { publishedBy: event.publishedBy, summary: event.summary, siteUrl: `${siteUrl}/`, commitUrl: event.commitUrl, logoUrl: logoUrlFor(siteUrl) };

  await deps.sleep(timing.firstCheckAfter);
  let live = false;
  for (let waited = timing.firstCheckAfter; ; waited += timing.interval) {
    if (await isLive(deps, siteUrl, event.commitSha)) {
      live = true;
      break;
    }
    if (waited + timing.interval > timing.giveUpAfter) break;
    await deps.sleep(timing.interval);
  }

  if (admins.length) {
    const email = live ? sitePhotosLiveEmail(params) : sitePhotosNotLiveEmail(params);
    await deps.send({ from: config.sesFromEmail, to: admins, ...email });
  }
  if (live) logger.info('site photos live', { commitSha: event.commitSha, result: 'live' });
  else logger.warn('site photos not live in time', { commitSha: event.commitSha, result: 'not-live' });
  return { live };
}

export const handler = async (event: NotifySitePhotosEvent): Promise<void> => {
  const config = loadConfig();
  const publishConfig = loadPublishConfig();
  const sesClient = createSesClient();
  const github = createGithubClient({ token: await getGithubToken(publishConfig.githubTokenParameter), repo: publishConfig.githubRepo });
  await notifySitePhotos(event, {
    config,
    fetchImpl: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    send: (content) => sendEmail(sesClient, content),
    containsCommit: (ours, deployed) => github.containsCommit(ours, deployed),
  });
};

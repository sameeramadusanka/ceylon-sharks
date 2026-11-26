// Build-time loader for the Player of the Week feature. Only import this from
// .astro frontmatter: it uses astro:assets and node:fs, which don't exist in
// the browser.
//
// Each week is a pair of files in a season folder, named exactly like the season's
// other data folders (e.g. src/assets/player_of_the_week/2026_SEPTEMBER_SUPREME_DIVISION/):
//   {YYYY-MM-DD}__{playerId}.jpg            the designed poster (9:16)
//   {YYYY-MM-DD}__{playerId}.json           details shown as text next to it
//   {YYYY-MM-DD}__{playerId}__share.jpg     optional wide (1200x630) link-preview image
// The homepage only shows winners from the season selected in the dashboard.
// Posters live under src/ (not public/) so Astro can resize and compress them.

import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type PlayerOfTheWeekDetails = {
  playerName: string;
  opponent: string;
  competition?: string;
  batting?: string;
  bowling?: string;
  fielding?: string;
  wicketKeeping?: string;
  caption?: string;
};

export type PlayerOfTheWeekEntry = PlayerOfTheWeekDetails & {
  /** Season folder name, e.g. 2026_SEPTEMBER_SUPREME_DIVISION. */
  season: string;
  date: string;
  displayDate: string;
  playerId: number;
  pagePath: string;
  poster: { src: string; width: number; height: number };
  thumbnail: string;
  shareImage: { src: string; width: number; height: number; type: string };
  hasScoreCard: boolean;
};

const imageModules = import.meta.glob<{ default: ImageMetadata }>('../assets/player_of_the_week/**/*.{jpg,jpeg,png,webp}', { eager: true });
const detailModules = import.meta.glob<{ default: PlayerOfTheWeekDetails }>('../assets/player_of_the_week/**/*.json', { eager: true });

const fileNamePattern = /^(\d{4}-\d{2}-\d{2})__(\d+)(__share)?\.(?:jpe?g|png|webp)$/i;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fileNameOf = (path: string) => path.split('/').pop() ?? path;
/** The season folder a file sits in; throws for files outside exactly one season folder. */
function seasonOf(path: string): string {
  const relative = path.split('/player_of_the_week/')[1] ?? '';
  const parts = relative.split('/');
  if (parts.length !== 2) throw new Error(`Player of the Week: "${relative}" must sit directly inside a season folder, e.g. 2026_SEPTEMBER_SUPREME_DIVISION/${parts.at(-1)}.`);
  return parts[0];
}

export function formatPlayerOfTheWeekDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${monthNames[month - 1]} ${year}`;
}

function scoreCardDates(): Set<string> {
  const directory = join(process.cwd(), 'public', 'score_cards');
  if (!existsSync(directory)) return new Set();
  const dates = new Set<string>();
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name));
      const match = entry.name.match(/__MATCH-\d+__(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) dates.add(match[1]);
    }
  };
  walk(directory);
  return dates;
}

let cachedEntries: Promise<PlayerOfTheWeekEntry[]> | null = null;

/** All Player of the Week entries, newest first. Throws (failing the build) on a poster with missing or incomplete details. */
export function loadPlayerOfTheWeek(): Promise<PlayerOfTheWeekEntry[]> {
  cachedEntries ??= buildEntries();
  return cachedEntries;
}

async function buildEntries(): Promise<PlayerOfTheWeekEntry[]> {
  const posters = new Map<string, { image: ImageMetadata; season: string }>();
  const shareImages = new Map<string, ImageMetadata>();

  for (const [path, module] of Object.entries(imageModules)) {
    const fileName = fileNameOf(path);
    const season = seasonOf(path);
    const match = fileName.match(fileNamePattern);
    if (!match) throw new Error(`Player of the Week: "${season}/${fileName}" must be named YYYY-MM-DD__playerId.jpg (or __share.jpg for the link-preview image).`);
    const key = `${season}/${match[1]}__${match[2]}`;
    if (match[3]) shareImages.set(key, module.default);
    else posters.set(key, { image: module.default, season });
  }

  const details = new Map(Object.entries(detailModules).map(([path, module]) => [`${seasonOf(path)}/${fileNameOf(path).replace(/\.json$/, '')}`, module.default]));
  const scoreCards = scoreCardDates();
  const seenDates = new Set<string>();

  const entries = await Promise.all([...posters.entries()].map(async ([key, { image: posterImage, season }]) => {
    const [date, playerIdText] = fileNameOf(key).split('__');
    const info = details.get(key);
    if (!info) throw new Error(`Player of the Week: poster "${key}" has no matching "${key}.json" details file.`);
    if (!info.playerName || !info.opponent) throw new Error(`Player of the Week: "${key}.json" needs at least "playerName" and "opponent".`);
    if (seenDates.has(date)) throw new Error(`Player of the Week: more than one poster for ${date}. Each date can have one winner.`);
    seenDates.add(date);

    const poster = await getImage({ src: posterImage, width: Math.min(posterImage.width, 900), format: 'webp' });
    const thumbnail = await getImage({ src: posterImage, width: Math.min(posterImage.width, 320), format: 'webp' });
    // Link previews use JPEG: some platforms still ignore WebP preview images.
    const shareSource = shareImages.get(key);
    const share = shareSource
      ? await getImage({ src: shareSource, width: Math.min(shareSource.width, 1200), format: 'jpg' })
      : await getImage({ src: posterImage, width: Math.min(posterImage.width, 900), format: 'jpg' });

    return {
      ...info,
      season,
      date,
      displayDate: formatPlayerOfTheWeekDate(date),
      playerId: Number(playerIdText),
      pagePath: `player-of-the-week/${date}/`,
      poster: { src: poster.src, width: Number(poster.attributes.width), height: Number(poster.attributes.height) },
      thumbnail: thumbnail.src,
      shareImage: { src: share.src, width: Number(share.attributes.width), height: Number(share.attributes.height), type: 'image/jpeg' },
      hasScoreCard: scoreCards.has(date),
    } satisfies PlayerOfTheWeekEntry;
  }));

  return entries.sort((first, second) => second.date.localeCompare(first.date));
}

/** "36 (19) & 3/12 (3) vs Lightning Hawks" style summary for link previews. */
export function summarizePerformance(entry: PlayerOfTheWeekEntry): string {
  const figures = [entry.batting, entry.bowling, entry.fielding, entry.wicketKeeping].filter(Boolean).join(' & ');
  return figures ? `${figures} vs ${entry.opponent}` : `vs ${entry.opponent}`;
}

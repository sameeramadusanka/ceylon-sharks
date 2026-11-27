// Build-time data for the admin panel's Site photos tab. Only import this from
// .astro frontmatter (it uses node:fs and astro:assets).
//
// Thumbnails are keyed by git blob SHA (the hash GitHub reports for each file),
// not by file name, so a photo keeps its thumbnail after the admin panel
// renames it to change its order.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

type ImageModules = Record<string, { default: ImageMetadata }>;

const modules: ImageModules = {
  ...import.meta.glob('../assets/banner_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true }),
  ...import.meta.glob('../assets/history_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true }),
  ...import.meta.glob('../assets/player_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true }),
};

export interface AdminSquadPlayer {
  id: number;
  name: string;
  role: 'captain' | 'vice-captain' | 'player';
}

export interface AdminPhotoSquad {
  season: string;
  players: AdminSquadPlayer[];
}

export interface AdminSitePhotosData {
  /** Git blob SHA -> small WebP thumbnail URL, for every photo in the three folders at build time. */
  thumbnails: Record<string, string>;
  /** Every season with a squad file, newest first; captain, vice-captain, then A-Z like the site. */
  squads: AdminPhotoSquad[];
}

/** The SHA git (and GitHub's contents API) gives a file: sha1("blob <size>\0" + bytes). */
export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

type SquadFile = { season?: { captainId?: number; viceCaptainId?: number; players?: { id: number; name: string; role?: string }[] } };
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function seasonOrder(season: string): number {
  const [year, month] = season.split('_');
  return Number(year) * 100 + Math.max(0, MONTHS.indexOf(month ?? ''));
}

function roleOf(player: { id: number; role?: string }, squad: SquadFile['season']): AdminSquadPlayer['role'] {
  const role = (player.role ?? '').toLowerCase();
  if (squad?.captainId === player.id || role === 'captain') return 'captain';
  if (squad?.viceCaptainId === player.id || role.replace(/[-_]/g, ' ') === 'vice captain') return 'vice-captain';
  return 'player';
}

const ROLE_ORDER: Record<AdminSquadPlayer['role'], number> = { captain: 0, 'vice-captain': 1, player: 2 };

function loadSquads(root: string): AdminPhotoSquad[] {
  const playersRoot = join(root, 'public', 'players');
  if (!existsSync(playersRoot)) return [];
  const squads: AdminPhotoSquad[] = [];
  for (const season of readdirSync(playersRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    const file = readdirSync(join(playersRoot, season)).find((name) => /__PLAYERS__\d{4}\.json$/.test(name));
    if (!file) continue;
    const squad = (JSON.parse(readFileSync(join(playersRoot, season, file), 'utf8')) as SquadFile).season;
    const players = (squad?.players ?? []).map((player) => ({ id: player.id, name: player.name, role: roleOf(player, squad) }));
    players.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
    squads.push({ season, players });
  }
  return squads.sort((a, b) => seasonOrder(b.season) - seasonOrder(a.season));
}

export async function loadSitePhotosAdminData(root = process.cwd()): Promise<AdminSitePhotosData> {
  const entries = await Promise.all(
    Object.entries(modules).map(async ([path, module]) => {
      const bytes = readFileSync(join(root, 'src', path.replace(/^\.\.\//, '')));
      const thumbnail = await getImage({ src: module.default, width: Math.min(module.default.width, 360), format: 'webp', quality: 70 });
      return [gitBlobSha(bytes), thumbnail.src] as const;
    }),
  );
  return { thumbnails: Object.fromEntries(entries), squads: loadSquads(root) };
}

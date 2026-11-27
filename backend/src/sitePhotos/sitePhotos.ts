// Site photos (homepage banner, Our Story carousel, player photos) managed from
// the admin panel. The site reads these folders at build time and shows the
// photos in file-name order (src/lib/siteImages.ts), so:
//   - order is a 3-digit prefix: 010__name.jpg, 020__name.jpg, ...
//   - player photos are always {playerId}.{ext}
// This module only works out which files to write, rename and delete; the
// handler turns that into one commit.

import type { DirectoryEntry, FileToCommit } from '../github/githubClient.js';

export const PHOTO_FOLDERS = {
  banner: 'src/assets/banner_images',
  history: 'src/assets/history_images',
  players: 'src/assets/player_images',
} as const;

export type OrderedSection = 'banner' | 'history';
export type PhotoSection = keyof typeof PHOTO_FOLDERS;
export type PhotoExtension = 'jpg' | 'png';

/** Same image types the site's build picks up. */
const IMAGE_FILE = /\.(avif|gif|jpe?g|png|webp)$/i;
const ORDER_PREFIX = /^\d{3}__/;
const PLAYER_FILE = /^(\d+)\.[a-z]+$/i;

export interface SitePhoto {
  name: string;
  sha: string;
  url: string | null;
}

export interface PlayerPhoto extends SitePhoto {
  playerId: number;
}

/** Plain code-unit order - the order the site shows them in. */
export function siteOrder<T extends { name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function imageEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return siteOrder(entries.filter((entry) => entry.type === 'file' && IMAGE_FILE.test(entry.name)));
}

export function toSitePhoto(entry: DirectoryEntry): SitePhoto {
  return { name: entry.name, sha: entry.sha, url: entry.download_url ?? null };
}

export function toPlayerPhotos(entries: DirectoryEntry[]): PlayerPhoto[] {
  return imageEntries(entries)
    .map((entry) => ({ entry, match: entry.name.match(PLAYER_FILE) }))
    .filter((item): item is { entry: DirectoryEntry; match: RegExpMatchArray } => item.match !== null)
    .map(({ entry, match }) => ({ ...toSitePhoto(entry), playerId: Number(match[1]) }));
}

/** One slot in a banner/Our Story list, in the order the admin wants it shown. */
export type OrderItem = { existing: string } | { upload: { blobSha: string; extension: PhotoExtension } };

export interface SectionPlan {
  files: FileToCommit[];
  deletePaths: string[];
  added: number;
  removed: number;
  /** True when the photos kept from before are in a different order. */
  reordered: boolean;
}

export class PhotoPlanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PhotoPlanError';
  }
}

const pad = (position: number) => String(position * 10).padStart(3, '0');
const baseName = (name: string) => name.replace(ORDER_PREFIX, '');

/**
 * Plans a banner or Our Story change: every photo in `order` is (re)named
 * NNN__name so the site shows them in that order, and photos left out are
 * deleted. Files already under the right name are left alone; renames reuse
 * the existing blob, so nothing is re-uploaded.
 */
export function planOrderedSection(folder: string, current: DirectoryEntry[], order: OrderItem[], uploadStamp: string): SectionPlan {
  const byName = new Map(current.map((entry) => [entry.name, entry]));
  const seen = new Set<string>();
  for (const item of order) {
    if (!('existing' in item)) continue;
    if (!byName.has(item.existing)) throw new PhotoPlanError(`"${item.existing}" is no longer on the site. Someone else may have changed the photos - reload and try again.`, 409);
    if (seen.has(item.existing)) throw new PhotoPlanError(`"${item.existing}" is listed twice`, 400);
    seen.add(item.existing);
  }

  const targets = new Map<string, string>(); // path -> blob sha
  let uploadCount = 0;
  order.forEach((item, index) => {
    if ('existing' in item) {
      const entry = byName.get(item.existing)!;
      targets.set(`${folder}/${pad(index + 1)}__${baseName(entry.name)}`, entry.sha);
    } else {
      uploadCount += 1;
      targets.set(`${folder}/${pad(index + 1)}__photo-${uploadStamp}-${uploadCount}.${item.upload.extension}`, item.upload.blobSha);
    }
  });

  const currentByPath = new Map(current.map((entry) => [entry.path, entry.sha]));
  const files: FileToCommit[] = [...targets]
    .filter(([path, sha]) => currentByPath.get(path) !== sha)
    .map(([path, blobSha]) => ({ path, blobSha }));
  const deletePaths = current.map((entry) => entry.path).filter((path) => !targets.has(path));

  const keptBefore = siteOrder(current).map((entry) => entry.name).filter((name) => seen.has(name));
  const keptAfter = order.flatMap((item) => ('existing' in item ? [item.existing] : []));
  return {
    files,
    deletePaths,
    added: uploadCount,
    removed: current.length - seen.size,
    reordered: keptBefore.join('/') !== keptAfter.join('/'),
  };
}

export type PlayerChange = { playerId: number; action: 'upload'; blobSha: string; extension: PhotoExtension } | { playerId: number; action: 'remove' };

/** Player photos are always {playerId}.{ext}; any other file for that player (e.g. an old .PNG) is removed so there's never two. */
export function planPlayerPhotos(folder: string, current: DirectoryEntry[], changes: PlayerChange[]): { files: FileToCommit[]; deletePaths: string[] } {
  const files: FileToCommit[] = [];
  const deletePaths: string[] = [];
  for (const change of changes) {
    const existing = current.filter((entry) => entry.name.match(PLAYER_FILE)?.[1] === String(change.playerId));
    if (change.action === 'upload') {
      const path = `${folder}/${change.playerId}.${change.extension}`;
      files.push({ path, blobSha: change.blobSha });
      deletePaths.push(...existing.map((entry) => entry.path).filter((existingPath) => existingPath !== path));
    } else {
      deletePaths.push(...existing.map((entry) => entry.path));
    }
  }
  return { files, deletePaths };
}

export function describeSection(label: string, plan: SectionPlan): string | null {
  const parts = [plan.added ? `${plan.added} added` : '', plan.removed ? `${plan.removed} removed` : '', plan.reordered ? 'reordered' : ''].filter(Boolean);
  return parts.length ? `${label}: ${parts.join(', ')}` : null;
}

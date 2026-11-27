// Build-time loader for the homepage's image folders. Only import this from .astro
// frontmatter: it uses astro:assets, which doesn't exist in the browser.
//
// The folders live under src/assets/ (not public/) so Astro resizes and compresses
// every image at build time. Drop full-size originals in; only the compressed copies
// are published. Files are used in alphabetical order, with no manifest. The admin
// panel's Site photos tab sets the banner/Our Story order by naming files 010__..., 020__...
//   src/assets/banner_images/    hero banner rotation
//   src/assets/history_images/   Our Story carousel
//   src/assets/ground_images/    fallback Our Story image (first file only)
//   src/assets/player_images/    player photos, named {playerId}.png/.jpg

import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

type ImageModules = Record<string, { default: ImageMetadata }>;

const bannerModules: ImageModules = import.meta.glob('../assets/banner_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true });
const historyModules: ImageModules = import.meta.glob('../assets/history_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true });
const groundModules: ImageModules = import.meta.glob('../assets/ground_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true });
const playerModules: ImageModules = import.meta.glob('../assets/player_images/*.{avif,gif,jpg,jpeg,png,webp,JPG,JPEG,PNG}', { eager: true });

const fileNameOf = (path: string) => path.split('/').pop() ?? path;

/** Compressed WebP URLs for every image in a folder, sorted by file name. Never upscales. */
async function compressAll(modules: ImageModules, maxWidth: number, quality = 80): Promise<Array<{ fileName: string; src: string }>> {
  // Plain code-unit order, matching the old readdirSync().sort() so images keep their order.
  const entries = Object.entries(modules).sort(([first], [second]) => (fileNameOf(first) < fileNameOf(second) ? -1 : fileNameOf(first) > fileNameOf(second) ? 1 : 0));
  return Promise.all(entries.map(async ([path, module]) => {
    const image = await getImage({ src: module.default, width: Math.min(module.default.width, maxWidth), format: 'webp', quality });
    return { fileName: fileNameOf(path), src: image.src };
  }));
}

// Widths are about 2x the size each image is shown at, so they stay sharp on high-density screens.
// The hero banner sits under a dark gradient overlay, so it tolerates stronger compression.
export async function loadSiteImages() {
  const [banners, history, ground, players] = await Promise.all([
    compressAll(bannerModules, 1920, 65),
    compressAll(historyModules, 1200, 75),
    compressAll(groundModules, 1200, 75),
    compressAll(playerModules, 800),
  ]);

  return {
    bannerImages: banners.map((image) => image.src),
    historyImages: history.map((image) => image.src),
    groundImage: ground[0]?.src ?? '',
    playerImages: Object.fromEntries(
      players
        .filter((image) => /^\d+\.[a-z]+$/i.test(image.fileName))
        .map((image) => [image.fileName.replace(/\.[^.]+$/, ''), image.src]),
    ) as Record<string, string>,
  };
}

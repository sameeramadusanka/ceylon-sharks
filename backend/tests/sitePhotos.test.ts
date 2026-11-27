import { describe, expect, it } from 'vitest';
import type { DirectoryEntry } from '../src/github/githubClient.js';
import { describeSection, imageEntries, PhotoPlanError, planOrderedSection, planPlayerPhotos, toPlayerPhotos } from '../src/sitePhotos/sitePhotos.js';

const FOLDER = 'src/assets/banner_images';
const entry = (name: string, sha = `sha-${name}`, folder = FOLDER): DirectoryEntry => ({ name, path: `${folder}/${name}`, type: 'file', sha });

describe('site photo listing', () => {
  it('keeps image files only, in the order the site shows them', () => {
    const list = imageEntries([entry('b.jpg'), entry('README.md'), entry('020__z.png'), entry('A.JPG'), { ...entry('dir'), type: 'dir' }]);
    expect(list.map((item) => item.name)).toEqual(['020__z.png', 'A.JPG', 'b.jpg']);
  });

  it('reads player IDs from {playerId}.{ext} and ignores anything else', () => {
    const photos = toPlayerPhotos([entry('2699280.PNG', 's1', 'p'), entry('123.jpg', 's2', 'p'), entry('team.jpg', 's3', 'p')]);
    expect(photos.map((photo) => [photo.playerId, photo.name])).toEqual([[123, '123.jpg'], [2699280, '2699280.PNG']]);
  });
});

describe('planOrderedSection', () => {
  const current = [entry('a.jpg'), entry('b.jpg'), entry('c.jpg')];

  it('renames to NNN__ prefixes in the chosen order, reusing blobs, and deletes dropped photos', () => {
    const plan = planOrderedSection(FOLDER, current, [{ existing: 'c.jpg' }, { upload: { blobSha: 'n'.repeat(40), extension: 'jpg' } }, { existing: 'a.jpg' }], '20261127-091500');
    expect(plan.files).toEqual([
      { path: `${FOLDER}/010__c.jpg`, blobSha: 'sha-c.jpg' },
      { path: `${FOLDER}/020__photo-20261127-091500-1.jpg`, blobSha: 'n'.repeat(40) },
      { path: `${FOLDER}/030__a.jpg`, blobSha: 'sha-a.jpg' },
    ]);
    expect(plan.deletePaths).toEqual([`${FOLDER}/a.jpg`, `${FOLDER}/b.jpg`, `${FOLDER}/c.jpg`]);
    expect(plan).toMatchObject({ added: 1, removed: 1, reordered: true });
    expect(describeSection('Banner', plan)).toBe('Banner: 1 added, 1 removed, reordered');
  });

  it('leaves files already under the right name alone and strips old prefixes', () => {
    const prefixed = [entry('010__a.jpg'), entry('020__b.jpg')];
    const plan = planOrderedSection(FOLDER, prefixed, [{ existing: '020__b.jpg' }, { existing: '010__a.jpg' }], 's');
    expect(plan.files).toEqual([
      { path: `${FOLDER}/010__b.jpg`, blobSha: 'sha-020__b.jpg' },
      { path: `${FOLDER}/020__a.jpg`, blobSha: 'sha-010__a.jpg' },
    ]);
    expect(plan.deletePaths).toEqual([`${FOLDER}/010__a.jpg`, `${FOLDER}/020__b.jpg`]);

    const unchanged = planOrderedSection(FOLDER, prefixed, [{ existing: '010__a.jpg' }, { existing: '020__b.jpg' }], 's');
    expect(unchanged.files).toEqual([]);
    expect(unchanged.deletePaths).toEqual([]);
    expect(describeSection('Banner', unchanged)).toBeNull();
  });

  it('reports a removal without calling it a reorder', () => {
    const plan = planOrderedSection(FOLDER, current, [{ existing: 'a.jpg' }, { existing: 'c.jpg' }], 's');
    expect(plan).toMatchObject({ added: 0, removed: 1, reordered: false });
  });

  it('rejects photos that are no longer there, or listed twice', () => {
    expect(() => planOrderedSection(FOLDER, current, [{ existing: 'gone.jpg' }], 's')).toThrow(PhotoPlanError);
    expect(() => planOrderedSection(FOLDER, current, [{ existing: 'gone.jpg' }], 's')).toThrow(/reload/);
    expect(() => planOrderedSection(FOLDER, current, [{ existing: 'a.jpg' }, { existing: 'a.jpg' }], 's')).toThrow(/twice/);
  });
});

describe('planPlayerPhotos', () => {
  const folder = 'src/assets/player_images';
  const current = [entry('2699280.PNG', 's1', folder), entry('111.jpg', 's2', folder), entry('1111.jpg', 's3', folder)];

  it('saves uploads as {playerId}.{ext} and removes the player\'s other files', () => {
    const plan = planPlayerPhotos(folder, current, [
      { playerId: 2699280, action: 'upload', blobSha: 'x'.repeat(40), extension: 'jpg' },
      { playerId: 111, action: 'upload', blobSha: 'y'.repeat(40), extension: 'jpg' },
    ]);
    expect(plan.files).toEqual([
      { path: `${folder}/2699280.jpg`, blobSha: 'x'.repeat(40) },
      { path: `${folder}/111.jpg`, blobSha: 'y'.repeat(40) },
    ]);
    expect(plan.deletePaths).toEqual([`${folder}/2699280.PNG`]);
  });

  it('removes only that player\'s photo', () => {
    expect(planPlayerPhotos(folder, current, [{ playerId: 111, action: 'remove' }])).toEqual({ files: [], deletePaths: [`${folder}/111.jpg`] });
  });
});

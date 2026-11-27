import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  fetchSitePhotos,
  publishSitePhotos,
  uploadSitePhoto,
  type AdminApiError,
  type PhotoExtension,
  type PhotoOrderItem,
  type PlayerPhotoChange,
  type SitePhoto,
  type SitePhotoLists,
  type SitePhotosPublishRequest,
  type SitePhotosPublishResult,
} from '../../services/adminApi';
import type { AdminSitePhotosData } from '../../lib/sitePhotosAdminData';

// Admin "Site photos" tab: the homepage banner, the Our Story carousel and
// player photos. Photos upload as soon as they're picked; nothing changes on
// the site until "Publish changes", which sends everything as one commit.

type OrderedSection = 'banner' | 'history';

type NewPhoto = { status: 'uploading' } | { status: 'ready'; blobSha: string; extension: PhotoExtension } | { status: 'failed'; error: string };

type Item = ({ kind: 'existing'; photo: SitePhoto } | ({ kind: 'new' } & NewPhoto)) & { key: string; previewUrl: string | null };

type PlayerPending = { action: 'remove'; season: string } | ({ action: 'upload'; season: string; previewUrl: string } & NewPhoto);

interface Props {
  data: AdminSitePhotosData;
  sessionToken: string;
  onSessionExpired: () => void;
}

const SECTIONS: { id: OrderedSection; title: string; hint: string; maxEdge: number; shape: string }[] = [
  {
    id: 'banner',
    title: 'Banner',
    hint: 'The big photos behind the headline at the top of the homepage, shown in this order. Landscape photos work best: they are cropped to fill the screen behind the text.',
    maxEdge: 2560,
    shape: 'ad-photo-tile--wide',
  },
  {
    id: 'history',
    title: 'Our Story',
    hint: 'The photo carousel in the Our Story section, shown in this order.',
    maxEdge: 2000,
    shape: 'ad-photo-tile--story',
  },
];

const PLAYER_MAX_EDGE = 1200;
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const ROLE_LABELS = { captain: 'Captain', 'vice-captain': 'Vice-captain', player: '' } as const;

let keyCounter = 0;
const nextKey = () => `photo-${++keyCounter}`;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Scales a photo so its longest side is at most `maxEdge` and re-encodes it as JPEG, small enough to upload. */
async function preparePhoto(file: File, maxEdge: number): Promise<{ base64: string; previewUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not supported');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) break;
    if (blob.size <= MAX_UPLOAD_BYTES || quality === 0.6) return { base64: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob) };
  }
  throw new Error('Could not read that photo');
}

const itemsFrom = (photos: SitePhoto[]): Item[] => photos.map((photo) => ({ kind: 'existing', photo, key: `existing-${photo.sha}-${photo.name}`, previewUrl: null }));

function seasonLabel(season: string): string {
  const [year, month, ...rest] = season.split('_');
  const words = [month, ...rest].filter(Boolean).map((word) => word.charAt(0) + word.slice(1).toLowerCase());
  return `${year} ${words.join(' ')}`.trim();
}

export default function SitePhotosManager({ data, sessionToken, onSessionExpired }: Props) {
  const [server, setServer] = useState<SitePhotoLists | null>(null);
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState<Record<OrderedSection, Item[]>>({ banner: [], history: [] });
  const [playerChanges, setPlayerChanges] = useState<Record<number, PlayerPending>>({});
  const [season, setSeason] = useState(data.squads[0]?.season ?? '');
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<SitePhotosPublishResult | null>(null);
  const [error, setError] = useState('');

  const handleError = (caught: unknown, fallback: string): string => {
    const apiError = caught as AdminApiError;
    if (apiError?.status === 401) {
      onSessionExpired();
      return '';
    }
    return apiError?.message || fallback;
  };

  async function load() {
    setLoadError('');
    try {
      const lists = await fetchSitePhotos(sessionToken);
      setServer(lists);
      setItems({ banner: itemsFrom(lists.banner), history: itemsFrom(lists.history) });
      setPlayerChanges({});
    } catch (caught) {
      setLoadError(handleError(caught, "Couldn't load the photos."));
    }
  }

  useEffect(() => {
    load();
  }, [sessionToken]);

  const thumbnail = (photo: SitePhoto) => data.thumbnails[photo.sha] ?? photo.url ?? '';
  const playerPhotos = useMemo(() => new Map((server?.players ?? []).map((photo) => [photo.playerId, photo])), [server]);
  const squad = data.squads.find((entry) => entry.season === season);

  async function uploadInto(file: File, maxEdge: number, onReady: (update: NewPhoto, previewUrl: string | null) => void) {
    let previewUrl: string | null = null;
    try {
      const prepared = await preparePhoto(file, maxEdge);
      previewUrl = prepared.previewUrl;
      onReady({ status: 'uploading' }, previewUrl);
      const uploaded = await uploadSitePhoto(sessionToken, prepared.base64);
      onReady({ status: 'ready', blobSha: uploaded.blobSha, extension: uploaded.extension }, previewUrl);
    } catch (caught) {
      const message = handleError(caught, "Couldn't upload that photo.");
      onReady({ status: 'failed', error: message || 'Sign in again to upload.' }, previewUrl);
    }
  }

  function addPhotos(section: OrderedSection, maxEdge: number, event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setResult(null);
    for (const file of files) {
      const key = nextKey();
      setItems((current) => ({ ...current, [section]: [...current[section], { kind: 'new', status: 'uploading', key, previewUrl: null }] }));
      uploadInto(file, maxEdge, (update, previewUrl) =>
        setItems((current) => ({ ...current, [section]: current[section].map((item) => (item.key === key ? { kind: 'new', ...update, key, previewUrl } : item)) })),
      );
    }
  }

  function move(section: OrderedSection, index: number, by: -1 | 1) {
    setItems((current) => {
      const list = [...current[section]];
      const target = index + by;
      if (target < 0 || target >= list.length) return current;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...current, [section]: list };
    });
  }

  function removeItem(section: OrderedSection, key: string) {
    setItems((current) => ({ ...current, [section]: current[section].filter((item) => item.key !== key) }));
  }

  function resetSection(section: OrderedSection) {
    if (server) setItems((current) => ({ ...current, [section]: itemsFrom(server[section]) }));
  }

  function choosePlayerPhoto(playerId: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setResult(null);
    const pickedSeason = season;
    setPlayerChanges((current) => ({ ...current, [playerId]: { action: 'upload', season: pickedSeason, previewUrl: '', status: 'uploading' } }));
    uploadInto(file, PLAYER_MAX_EDGE, (update, previewUrl) =>
      setPlayerChanges((current) => ({ ...current, [playerId]: { action: 'upload', season: pickedSeason, previewUrl: previewUrl ?? '', ...update } })),
    );
  }

  function removePlayerPhoto(playerId: number) {
    setResult(null);
    setPlayerChanges((current) => ({ ...current, [playerId]: { action: 'remove', season } }));
  }

  function undoPlayer(playerId: number) {
    setPlayerChanges((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  const sectionChanged = (section: OrderedSection) => {
    if (!server) return false;
    const list = items[section];
    return list.some((item) => item.kind === 'new') || list.map((item) => (item.kind === 'existing' ? item.photo.name : '')).join('/') !== server[section].map((photo) => photo.name).join('/');
  };

  const allNew = [...items.banner, ...items.history].filter((item) => item.kind === 'new') as (Item & { kind: 'new' })[];
  const pendingPlayers = Object.values(playerChanges);
  const busy = allNew.some((item) => item.status === 'uploading') || pendingPlayers.some((change) => change.action === 'upload' && change.status === 'uploading');
  const failed = allNew.some((item) => item.status === 'failed') || pendingPlayers.some((change) => change.action === 'upload' && change.status === 'failed');
  const changeCount = (sectionChanged('banner') ? 1 : 0) + (sectionChanged('history') ? 1 : 0) + pendingPlayers.length;
  const bannerEmpty = items.banner.length === 0;
  const canPublish = Boolean(server) && changeCount > 0 && !busy && !failed && !bannerEmpty && !publishing;

  async function publish() {
    if (!canPublish) return;
    const request: SitePhotosPublishRequest = {};
    for (const section of ['banner', 'history'] as const) {
      if (!sectionChanged(section)) continue;
      request[section] = {
        order: items[section].map((item): PhotoOrderItem => (item.kind === 'existing' ? { existing: item.photo.name } : { upload: { blobSha: (item as { blobSha: string }).blobSha, extension: (item as { extension: PhotoExtension }).extension } })),
      };
    }
    const players: PlayerPhotoChange[] = Object.entries(playerChanges).map(([id, change]) =>
      change.action === 'remove'
        ? { action: 'remove', playerId: Number(id), season: change.season }
        : { action: 'upload', playerId: Number(id), season: change.season, blobSha: (change as { blobSha: string }).blobSha, extension: (change as { extension: PhotoExtension }).extension },
    );
    if (players.length) request.players = players;

    setPublishing(true);
    setError('');
    try {
      const published = await publishSitePhotos(sessionToken, request);
      setResult(published);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await load();
    } catch (caught) {
      setError(handleError(caught, "Couldn't publish the changes."));
    } finally {
      setPublishing(false);
    }
  }

  if (loadError) {
    return (
      <div>
        <p className="ad-error" role="alert">{loadError}</p>
        <button type="button" className="ad-link-button" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!server) return <p className="ad-status" role="status">Loading photos…</p>;

  const newBadge = (item: Item) =>
    item.kind === 'new' ? (
      <span className={`ad-photo-badge${item.status === 'failed' ? ' ad-photo-badge--error' : ''}`}>{item.status === 'uploading' ? 'Uploading…' : item.status === 'failed' ? 'Failed' : 'New'}</span>
    ) : null;

  return (
    <div className="ad-photos">
      {result && (
        <div className="ad-success ad-potw-message--top" role="status">
          <strong>Published.</strong> The website updates in about 3–5 minutes{result.notifications === 'scheduled' ? ", and you'll get an email when it's live" : ''}.
          <ul className="ad-photo-summary">
            {result.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <a href={result.commitUrl} target="_blank" rel="noreferrer">See the change on GitHub</a>
        </div>
      )}

      <h1 className="ad-title">Site photos</h1>
      <p className="ad-hint ad-photos-intro">Add, remove and reorder photos, then press <strong>Publish changes</strong> at the bottom. Nothing changes on the website until you publish.</p>

      {SECTIONS.map(({ id, title, hint, maxEdge, shape }) => (
        <section className="ad-photo-section" key={id} aria-labelledby={`ad-photos-${id}`}>
          <div className="ad-photo-section__head">
            <h2 id={`ad-photos-${id}`}>{title}</h2>
            {sectionChanged(id) && (
              <button type="button" className="ad-link-button ad-photo-reset" onClick={() => resetSection(id)}>
                Undo changes
              </button>
            )}
          </div>
          <p className="ad-hint">{hint}</p>
          <ol className="ad-photo-grid">
            {items[id].map((item, index) => {
              const src = item.previewUrl ?? (item.kind === 'existing' ? thumbnail(item.photo) : '');
              return (
                <li className={`ad-photo-tile ${shape}`} key={item.key}>
                  <div className="ad-photo-tile__image">
                    {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="ad-photo-tile__placeholder">…</span>}
                    <span className="ad-photo-position">{index + 1}</span>
                    {newBadge(item)}
                  </div>
                  {item.kind === 'new' && item.status === 'failed' && <p className="ad-photo-error">{item.error}</p>}
                  <div className="ad-photo-actions">
                    <button type="button" aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0} onClick={() => move(id, index, -1)}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Move photo ${index + 1} later`} disabled={index === items[id].length - 1} onClick={() => move(id, index, 1)}>
                      ↓
                    </button>
                    <button type="button" className="ad-photo-remove" aria-label={`Remove photo ${index + 1}`} onClick={() => removeItem(id, item.key)}>
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {id === 'banner' && bannerEmpty && <p className="ad-error ad-photo-inline-error">The banner needs at least one photo.</p>}
          <label className="ad-photo-add">
            <input type="file" accept="image/*" multiple onChange={(event) => addPhotos(id, maxEdge, event)} />
            <span>+ Add photos</span>
          </label>
        </section>
      ))}

      <section className="ad-photo-section" aria-labelledby="ad-photos-players">
        <div className="ad-photo-section__head">
          <h2 id="ad-photos-players">Player photos</h2>
        </div>
        <p className="ad-hint">Pick a season to see its squad. Each player has one photo, used in every season they play. Uploads are saved under the player's ID automatically.</p>
        <div className="ad-field">
          <label htmlFor="ad-photos-season">Season</label>
          <select id="ad-photos-season" value={season} onChange={(event) => setSeason(event.target.value)}>
            {data.squads.map((entry) => (
              <option key={entry.season} value={entry.season}>
                {seasonLabel(entry.season)}
              </option>
            ))}
          </select>
        </div>
        <ul className="ad-player-photos">
          {(squad?.players ?? []).map((player) => {
            const current = playerPhotos.get(player.id);
            const pending = playerChanges[player.id];
            const src = pending?.action === 'upload' ? pending.previewUrl : pending?.action === 'remove' ? '' : current ? thumbnail(current) : '';
            const status =
              pending?.action === 'remove'
                ? 'Will be removed'
                : pending?.action === 'upload'
                  ? pending.status === 'uploading'
                    ? 'Uploading…'
                    : pending.status === 'failed'
                      ? pending.error
                      : current
                        ? 'New photo, not published yet'
                        : 'Photo added, not published yet'
                  : current
                    ? ''
                    : 'No photo';
            return (
              <li className="ad-player-photo" key={player.id}>
                <div className="ad-player-photo__image">{src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span>{player.name.charAt(0)}</span>}</div>
                <div className="ad-player-photo__info">
                  <strong>{player.name}</strong>
                  {ROLE_LABELS[player.role] && <small>{ROLE_LABELS[player.role]}</small>}
                  {status && <em className={pending && pending.action === 'upload' && pending.status === 'failed' ? 'ad-photo-error' : undefined}>{status}</em>}
                </div>
                <div className="ad-player-photo__actions">
                  {pending ? (
                    <button type="button" className="ad-link-button" onClick={() => undoPlayer(player.id)}>
                      Undo
                    </button>
                  ) : (
                    <>
                      <label className="ad-link-button ad-photo-upload-link">
                        <input type="file" accept="image/*" onChange={(event) => choosePlayerPhoto(player.id, event)} />
                        {current ? 'Replace' : 'Upload'}
                      </label>
                      {current && (
                        <button type="button" className="ad-link-button" onClick={() => removePlayerPhoto(player.id)}>
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="ad-photo-publish">
        {error && (
          <p className="ad-error ad-potw-message--top" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="ad-button" disabled={!canPublish} onClick={publish}>
          {publishing ? 'Publishing…' : busy ? 'Waiting for uploads…' : changeCount ? 'Publish changes' : 'No changes yet'}
        </button>
        {failed && <p className="ad-hint ad-photo-publish-hint">Remove or undo the photos that failed to upload before publishing.</p>}
      </div>
    </div>
  );
}

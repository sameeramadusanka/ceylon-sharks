import { useEffect, useMemo, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { publishPlayerOfTheWeek, type AdminApiError, type PlayerOfTheWeekResult } from '../../services/adminApi';
import type { AdminPotwData } from '../../lib/playerOfTheWeekAdminData';
import { emptyStats, FIGURE_FORMATTERS, type PotwStatGroup, type PotwStats } from '../../lib/playerOfTheWeekFigures';

// Posters are designed at 9:16; this keeps them sharp on the site (which shows
// at most 900px wide) while keeping the upload well under the backend's limit.
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

type Source = 'scorecard' | 'manual';
type Figures = Record<PotwStatGroup, string>;
type NumberKey = Exclude<keyof PotwStats, 'notOut'>;

const GROUP_OF: Record<keyof PotwStats, PotwStatGroup> = {
  runs: 'batting',
  balls: 'batting',
  fours: 'batting',
  sixes: 'batting',
  notOut: 'batting',
  overs: 'bowling',
  maidens: 'bowling',
  runsConceded: 'bowling',
  wickets: 'bowling',
  catches: 'fielding',
  runOuts: 'fielding',
  keeperCatches: 'wicketKeeping',
  stumpings: 'wicketKeeping',
};

const GROUPS: { group: PotwStatGroup; title: string; fields: { key: NumberKey; label: string; decimal?: boolean }[]; placeholder: string }[] = [
  {
    group: 'batting',
    title: 'Batting',
    fields: [
      { key: 'runs', label: 'Runs' },
      { key: 'balls', label: 'Balls' },
      { key: 'fours', label: '4s' },
      { key: 'sixes', label: '6s' },
    ],
    placeholder: '45* (32, 4×4, 2×6)',
  },
  {
    group: 'bowling',
    title: 'Bowling',
    fields: [
      { key: 'overs', label: 'Overs', decimal: true },
      { key: 'maidens', label: 'Maidens' },
      { key: 'runsConceded', label: 'Runs' },
      { key: 'wickets', label: 'Wickets' },
    ],
    placeholder: '3/12 (3)',
  },
  {
    group: 'fielding',
    title: 'Fielding',
    fields: [
      { key: 'catches', label: 'Catches' },
      { key: 'runOuts', label: 'Run outs' },
    ],
    placeholder: '1 catch, 1 run out',
  },
  {
    group: 'wicketKeeping',
    title: 'Wicket keeping',
    fields: [
      { key: 'keeperCatches', label: 'Catches' },
      { key: 'stumpings', label: 'Stumpings' },
    ],
    placeholder: '2 catches, 1 stumping',
  },
];

function figuresFor(stats: PotwStats): Figures {
  return {
    batting: FIGURE_FORMATTERS.batting(stats),
    bowling: FIGURE_FORMATTERS.bowling(stats),
    fielding: FIGURE_FORMATTERS.fielding(stats),
    wicketKeeping: FIGURE_FORMATTERS.wicketKeeping(stats),
  };
}

interface Props {
  data: AdminPotwData;
  sessionToken: string;
  onSessionExpired: () => void;
}

interface Poster {
  base64: string;
  previewUrl: string;
  sizeKb: number;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Scales the poster down to fit 1080x1920 and re-encodes it as JPEG. */
async function preparePoster(file: File): Promise<Poster> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not supported');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode image');
    if (blob.size <= MAX_UPLOAD_BYTES || quality === 0.7) {
      return { base64: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob), sizeKb: Math.round(blob.size / 1024) };
    }
  }
  throw new Error('Could not encode image');
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const seasonLabel = (season: string) =>
  season
    .split('_')
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()))
    .join(' ');

export default function PlayerOfTheWeekPublisher({ data, sessionToken, onSessionExpired }: Props) {
  const [source, setSource] = useState<Source>(data.matches.length > 0 ? 'scorecard' : 'manual');
  const [matchKey, setMatchKey] = useState('');
  const [manualSeason, setManualSeason] = useState(data.squads[0]?.season ?? '');
  const [manualDate, setManualDate] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [opponent, setOpponent] = useState('');
  const [competition, setCompetition] = useState(data.defaultCompetition);
  const [stats, setStats] = useState<PotwStats>(emptyStats);
  const [figures, setFigures] = useState<Figures>(() => figuresFor(emptyStats()));
  const [caption, setCaption] = useState('');
  const [poster, setPoster] = useState<Poster | null>(null);
  const [posterError, setPosterError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlayerOfTheWeekResult | null>(null);
  // Dates published in this visit: the build-time `existing` list only refreshes after the next deploy.
  const [publishedKeys, setPublishedKeys] = useState<string[]>([]);
  // Changing the key remounts the file input, which is the only way to empty it.
  const [posterInputKey, setPosterInputKey] = useState(0);

  const match = useMemo(() => (source === 'scorecard' ? data.matches.find((entry) => `${entry.season}/${entry.date}` === matchKey) ?? null : null), [data.matches, matchKey, source]);
  const season = source === 'scorecard' ? match?.season ?? '' : manualSeason;
  const date = source === 'scorecard' ? match?.date ?? '' : manualDate;
  const players = source === 'scorecard' ? match?.players ?? [] : data.squads.find((squad) => squad.season === manualSeason)?.players ?? [];
  const player = players.find((entry) => String(entry.id) === playerId) ?? null;
  const scorecardStats = source === 'scorecard' ? match?.players.find((entry) => String(entry.id) === playerId)?.stats ?? null : null;
  const alreadyExists = Boolean(season && date && (data.existing.includes(`${season}/${date}`) || publishedKeys.includes(`${season}/${date}`)));
  const targetChosen = Boolean(season && date);

  useEffect(
    () => () => {
      if (poster) URL.revokeObjectURL(poster.previewUrl);
    },
    [poster],
  );

  function applyStats(next: PotwStats) {
    setStats(next);
    setFigures(figuresFor(next));
  }

  /** Empties both the scorecard and manual forms after a publish, keeping the chosen mode and season. */
  function clearForm() {
    setMatchKey('');
    setManualDate('');
    setPlayerId('');
    setOpponent('');
    setCompetition(data.defaultCompetition);
    applyStats(emptyStats());
    setCaption('');
    setPoster(null);
    setPosterError('');
    setPosterInputKey((key) => key + 1);
    setReplaceExisting(false);
    setError('');
  }

  function resetPlayer() {
    setPlayerId('');
    applyStats(emptyStats());
    setReplaceExisting(false);
    setResult(null);
  }

  function chooseSource(next: Source) {
    setSource(next);
    setMatchKey('');
    setOpponent('');
    resetPlayer();
  }

  function chooseMatch(key: string) {
    setMatchKey(key);
    resetPlayer();
    setOpponent(data.matches.find((entry) => `${entry.season}/${entry.date}` === key)?.opponent ?? '');
  }

  function choosePlayer(id: string) {
    setPlayerId(id);
    setResult(null);
    // From a scorecard, fill in that player's figures; manual entry keeps whatever was typed.
    if (source === 'scorecard') applyStats(match?.players.find((entry) => String(entry.id) === id)?.stats ?? emptyStats());
  }

  function updateStat<K extends keyof PotwStats>(key: K, value: PotwStats[K]) {
    const next = { ...stats, [key]: value };
    const group = GROUP_OF[key];
    setStats(next);
    // Changing a number rewrites that group's "shown as" text; edits to the text itself stick until then.
    setFigures((current) => ({ ...current, [group]: FIGURE_FORMATTERS[group](next) }));
  }

  async function choosePoster(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPosterError('');
    setResult(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPosterError('Please choose an image file.');
      return;
    }
    setPreparing(true);
    try {
      setPoster(await preparePoster(file));
    } catch {
      setPoster(null);
      setPosterError("Couldn't read that image. Try a JPEG or PNG.");
    } finally {
      setPreparing(false);
    }
  }

  async function publish(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetChosen || !player || !poster) return;
    setPublishing(true);
    setError('');
    setResult(null);
    try {
      const published = await publishPlayerOfTheWeek(sessionToken, {
        season,
        date,
        playerId: player.id,
        details: {
          playerName: player.name,
          opponent: opponent.trim(),
          competition,
          batting: figures.batting,
          bowling: figures.bowling,
          fielding: figures.fielding,
          wicketKeeping: figures.wicketKeeping,
          caption,
        },
        imageBase64: poster.base64,
        replaceExisting,
      });
      setPublishedKeys((keys) => [...keys, `${season}/${date}`]);
      clearForm();
      setResult(published);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      const apiError = caught as AdminApiError;
      if (apiError.status === 401) {
        onSessionExpired();
        return;
      }
      setError(apiError.message);
    } finally {
      setPublishing(false);
    }
  }

  const canPublish = Boolean(targetChosen && player && poster && opponent.trim() && !preparing && !publishing && (!alreadyExists || replaceExisting));
  const isLive = result?.branch === 'main';

  return (
    <>
      <h1 className="ad-title">Player of the Week</h1>
      <p className="ad-subtitle">Fill the figures from a scorecard or type them in yourself, add the poster and publish. The site updates about 3 minutes later.</p>

      <form onSubmit={publish} className="ad-potw-form">
        {result && (
          <div className="ad-success ad-potw-message ad-potw-message--top" role="status">
            {isLive ? (
              <>
                Published! The site will update in about 3 minutes:{' '}
                <a href={result.pagePath} target="_blank" rel="noreferrer">
                  view the share page
                </a>
                .
              </>
            ) : (
              <>Saved to the test branch "{result.branch}" - not live yet. </>
            )}{' '}
            <a href={result.commitUrl} target="_blank" rel="noreferrer">
              See the commit
            </a>
            .
          </div>
        )}
        <div className="ad-segmented" role="radiogroup" aria-label="Where the figures come from">
          <button type="button" role="radio" aria-checked={source === 'scorecard'} className={source === 'scorecard' ? 'is-active' : ''} onClick={() => chooseSource('scorecard')} disabled={data.matches.length === 0}>
            From scorecard
          </button>
          <button type="button" role="radio" aria-checked={source === 'manual'} className={source === 'manual' ? 'is-active' : ''} onClick={() => chooseSource('manual')}>
            Enter manually
          </button>
        </div>
        <p className="ad-hint">
          {source === 'scorecard'
            ? 'Figures are filled in from the scorecard. You can correct any of them below.'
            : 'For a match without a scorecard yet, or when the scorecard is wrong. Type in every figure yourself.'}
        </p>

        {source === 'scorecard' ? (
          <div className="ad-field">
            <label htmlFor="ad-potw-match">Match</label>
            <select id="ad-potw-match" required value={matchKey} onChange={(event) => chooseMatch(event.target.value)}>
              <option value="">Choose a match…</option>
              {data.matches.map((entry) => (
                <option key={`${entry.season}/${entry.date}`} value={`${entry.season}/${entry.date}`}>
                  {formatDate(entry.date)} · vs {entry.opponent}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="ad-field-row">
            <div className="ad-field">
              <label htmlFor="ad-potw-season">Season</label>
              <select
                id="ad-potw-season"
                required
                value={manualSeason}
                onChange={(event) => {
                  setManualSeason(event.target.value);
                  resetPlayer();
                }}
              >
                {data.squads.map((squad) => (
                  <option key={squad.season} value={squad.season}>
                    {seasonLabel(squad.season)}
                  </option>
                ))}
              </select>
            </div>
            <div className="ad-field">
              <label htmlFor="ad-potw-date">Match date</label>
              <input
                id="ad-potw-date"
                type="date"
                required
                value={manualDate}
                onChange={(event) => {
                  setManualDate(event.target.value);
                  setReplaceExisting(false);
                  setResult(null);
                }}
              />
            </div>
          </div>
        )}

        {(source === 'manual' || match) && (
          <>
            <div className="ad-field">
              <label htmlFor="ad-potw-player">Player</label>
              <select id="ad-potw-player" required value={playerId} onChange={(event) => choosePlayer(event.target.value)}>
                <option value="">Choose a player…</option>
                {players.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="ad-field-row">
              <div className="ad-field">
                <label htmlFor="ad-potw-opponent">Opponent</label>
                <input id="ad-potw-opponent" required maxLength={80} value={opponent} onChange={(event) => setOpponent(event.target.value)} placeholder="Cool Blue" />
              </div>
              <div className="ad-field">
                <label htmlFor="ad-potw-competition">Competition</label>
                <input id="ad-potw-competition" maxLength={80} value={competition} onChange={(event) => setCompetition(event.target.value)} placeholder="SCL - Supreme Division" />
              </div>
            </div>

            {GROUPS.map(({ group, title, fields, placeholder }) => (
              <fieldset className="ad-stat-group" key={group}>
                <legend>{title}</legend>
                <div className={`ad-stat-inputs ad-stat-inputs--${fields.length}`}>
                  {fields.map(({ key, label, decimal }) => (
                    <div className="ad-field" key={key}>
                      <label htmlFor={`ad-potw-${key}`}>{label}</label>
                      <input
                        id={`ad-potw-${key}`}
                        inputMode={decimal ? 'decimal' : 'numeric'}
                        pattern={decimal ? '[0-9]+(\\.[0-5])?' : '[0-9]*'}
                        maxLength={5}
                        value={stats[key]}
                        onChange={(event) => updateStat(key, event.target.value.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ''))}
                      />
                    </div>
                  ))}
                </div>
                {group === 'batting' && (
                  <label className="ad-checkbox ad-checkbox--inline">
                    <input type="checkbox" checked={stats.notOut} onChange={(event) => updateStat('notOut', event.target.checked)} />
                    <span>Not out</span>
                  </label>
                )}
                <div className="ad-field ad-field--shown-as">
                  <label htmlFor={`ad-potw-${group}-text`}>Shown on the site as</label>
                  <input
                    id={`ad-potw-${group}-text`}
                    maxLength={60}
                    value={figures[group]}
                    onChange={(event) => setFigures((current) => ({ ...current, [group]: event.target.value }))}
                    placeholder={`Hidden when empty, e.g. ${placeholder}`}
                  />
                </div>
              </fieldset>
            ))}

            {scorecardStats && (
              <button type="button" className="ad-link-button ad-reset" onClick={() => applyStats(scorecardStats)}>
                Reset figures to the scorecard
              </button>
            )}

            <div className="ad-field">
              <label htmlFor="ad-potw-caption">Caption (optional)</label>
              <textarea id="ad-potw-caption" maxLength={400} rows={3} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="A match-winning knock of 45 off 32 balls…" />
            </div>

            <div className="ad-field">
              <label htmlFor="ad-potw-poster">Poster (9:16 image)</label>
              <input key={posterInputKey} id="ad-potw-poster" type="file" accept="image/*" required onChange={choosePoster} />
            </div>
            {preparing && (
              <p className="ad-status" role="status">
                Preparing poster…
              </p>
            )}
            {posterError && (
              <p className="ad-error" role="alert">
                {posterError}
              </p>
            )}
            {poster && (
              <div className="ad-potw-preview">
                <img src={poster.previewUrl} alt="Poster preview" />
                <span className="ad-hint">{poster.sizeKb} KB, ready to upload</span>
              </div>
            )}

            {alreadyExists && (
              <label className="ad-checkbox">
                <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
                <span>{formatDate(date)} already has a Player of the Week. Replace it?</span>
              </label>
            )}

            <button type="submit" className="ad-button" disabled={!canPublish}>
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </>
        )}

        {error && (
          <p className="ad-error ad-potw-message" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  );
}

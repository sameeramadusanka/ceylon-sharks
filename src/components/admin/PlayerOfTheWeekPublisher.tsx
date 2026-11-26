import { useEffect, useMemo, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { publishPlayerOfTheWeek, type AdminApiError, type PlayerOfTheWeekResult } from '../../services/adminApi';
import type { AdminPotwData } from '../../lib/playerOfTheWeekAdminData';

// Posters are designed at 9:16; this keeps them sharp on the site (which shows
// at most 900px wide) while keeping the upload well under the backend's limit.
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

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

export default function PlayerOfTheWeekPublisher({ data, sessionToken, onSessionExpired }: Props) {
  const [matchKey, setMatchKey] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [opponent, setOpponent] = useState('');
  const [competition, setCompetition] = useState(data.defaultCompetition);
  const [batting, setBatting] = useState('');
  const [bowling, setBowling] = useState('');
  const [fielding, setFielding] = useState('');
  const [caption, setCaption] = useState('');
  const [poster, setPoster] = useState<Poster | null>(null);
  const [posterError, setPosterError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlayerOfTheWeekResult | null>(null);

  const match = useMemo(() => data.matches.find((entry) => `${entry.season}/${entry.date}` === matchKey) ?? null, [data.matches, matchKey]);
  const player = match?.players.find((entry) => String(entry.id) === playerId) ?? null;
  const alreadyExists = match ? data.existing.includes(`${match.season}/${match.date}`) : false;

  useEffect(() => () => {
    if (poster) URL.revokeObjectURL(poster.previewUrl);
  }, [poster]);

  function chooseMatch(key: string) {
    setMatchKey(key);
    setPlayerId('');
    setBatting('');
    setBowling('');
    setFielding('');
    setReplaceExisting(false);
    setResult(null);
    const chosen = data.matches.find((entry) => `${entry.season}/${entry.date}` === key);
    setOpponent(chosen?.opponent ?? '');
  }

  function choosePlayer(id: string) {
    setPlayerId(id);
    setResult(null);
    const chosen = match?.players.find((entry) => String(entry.id) === id);
    setBatting(chosen?.batting ?? '');
    setBowling(chosen?.bowling ?? '');
    setFielding(chosen?.fielding ?? '');
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
    if (!match || !player || !poster) return;
    setPublishing(true);
    setError('');
    setResult(null);
    try {
      const published = await publishPlayerOfTheWeek(sessionToken, {
        season: match.season,
        date: match.date,
        playerId: player.id,
        details: { playerName: player.name, opponent: opponent.trim(), competition, batting, bowling, fielding, caption },
        imageBase64: poster.base64,
        replaceExisting,
      });
      setResult(published);
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

  const canPublish = Boolean(match && player && poster && opponent.trim() && !preparing && !publishing && (!alreadyExists || replaceExisting));
  const isLive = result?.branch === 'main';

  return (
    <>
      <h1 className="ad-title">Player of the Week</h1>
      <p className="ad-subtitle">Pick the match and player, check the figures, add the poster and publish. The site updates about 3 minutes later.</p>

      {data.matches.length === 0 ? (
        <p className="ad-empty">No scorecards found to publish from.</p>
      ) : (
        <form onSubmit={publish} className="ad-potw-form">
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

          {match && (
            <>
              <div className="ad-field">
                <label htmlFor="ad-potw-player">Player</label>
                <select id="ad-potw-player" required value={playerId} onChange={(event) => choosePlayer(event.target.value)}>
                  <option value="">Choose a player…</option>
                  {match.players.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.batting || entry.bowling ? ` - ${[entry.batting && `${entry.batting} bat`, entry.bowling && `${entry.bowling} bowl`].filter(Boolean).join(', ')}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ad-field-row">
                <div className="ad-field">
                  <label htmlFor="ad-potw-opponent">Opponent</label>
                  <input id="ad-potw-opponent" required maxLength={80} value={opponent} onChange={(event) => setOpponent(event.target.value)} />
                </div>
                <div className="ad-field">
                  <label htmlFor="ad-potw-competition">Competition</label>
                  <input id="ad-potw-competition" maxLength={80} value={competition} onChange={(event) => setCompetition(event.target.value)} placeholder="SCL - Supreme Division" />
                </div>
              </div>

              <div className="ad-field-row ad-field-row--three">
                <div className="ad-field">
                  <label htmlFor="ad-potw-batting">Batting</label>
                  <input id="ad-potw-batting" maxLength={60} value={batting} onChange={(event) => setBatting(event.target.value)} placeholder="45 (32)" />
                </div>
                <div className="ad-field">
                  <label htmlFor="ad-potw-bowling">Bowling</label>
                  <input id="ad-potw-bowling" maxLength={60} value={bowling} onChange={(event) => setBowling(event.target.value)} placeholder="3/12 (3)" />
                </div>
                <div className="ad-field">
                  <label htmlFor="ad-potw-fielding">Fielding</label>
                  <input id="ad-potw-fielding" maxLength={60} value={fielding} onChange={(event) => setFielding(event.target.value)} placeholder="1 catch" />
                </div>
              </div>
              <p className="ad-hint">Figures are filled in from the scorecard - leave a box empty to hide it.</p>

              <div className="ad-field">
                <label htmlFor="ad-potw-caption">Caption (optional)</label>
                <textarea id="ad-potw-caption" maxLength={400} rows={3} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="A match-winning knock of 45 off 32 balls…" />
              </div>

              <div className="ad-field">
                <label htmlFor="ad-potw-poster">Poster (9:16 image)</label>
                <input id="ad-potw-poster" type="file" accept="image/*" required onChange={choosePoster} />
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
                  <span>{formatDate(match.date)} already has a Player of the Week. Replace it?</span>
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
          {result && (
            <div className="ad-success ad-potw-message" role="status">
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
        </form>
      )}
    </>
  );
}

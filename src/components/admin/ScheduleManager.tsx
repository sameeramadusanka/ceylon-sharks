import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { changeSchedule, fetchSchedule, type AdminApiError, type ScheduleChange, type ScheduleItem, type ScheduleMatchInput, type ScheduleOverview } from '../../services/adminApi';

// Admin "Schedule" tab: the league fixtures are published when a season starts;
// this adds the knockout matches (QF, semi final, final) later, and fixes a
// date, time or ground. Each save is one commit to the season's schedule file,
// which the site and the availability emails both read.

/** Start times the league uses; an edited match keeps its own time even if it isn't one of these. */
const TIME_SLOTS = ['7:30 AM', '9:45 AM', '12:00 PM', '2:15 PM', '4:30 PM'];
const OTHER_OPPONENT = '__other__';

interface ScheduleManagerProps {
  /** `${season}/${date}` of every match with a scorecard on the site (build time), so today's played match counts as completed. */
  scorecardDates: string[];
  sessionToken: string;
  onSessionExpired: () => void;
}

type Draft = ScheduleMatchInput & { otherOpponent: string };

const seasonLabel = (season: string) =>
  season
    .split('_')
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()))
    .join(' ');

function displayDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Today's date (YYYY-MM-DD) on this device, to compare with schedule dates. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function emptyDraft(overview: ScheduleOverview): Draft {
  return { format: overview.formats.find((format) => format !== 'League') ?? overview.formats[0] ?? '', opponent: '', otherOpponent: '', date: '', time: TIME_SLOTS[1], ground: overview.grounds[0] ?? '' };
}

export default function ScheduleManager({ scorecardDates, sessionToken, onSessionExpired }: ScheduleManagerProps) {
  const [overview, setOverview] = useState<ScheduleOverview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [season, setSeason] = useState('');
  /** The match being edited, or 'new' for the add form; null when the form is closed. */
  const [editing, setEditing] = useState<ScheduleItem | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<{ summary: string; commitUrl: string } | null>(null);

  function handleError(error: unknown, show: (message: string) => void) {
    const apiError = error as AdminApiError;
    if (apiError.status === 401) onSessionExpired();
    else show(apiError.message);
  }

  async function load() {
    setLoadError('');
    try {
      const data = await fetchSchedule(sessionToken);
      setOverview(data);
      setSeason((current) => (current && data.seasons.some((item) => item.season === current) ? current : (data.seasons[0]?.season ?? '')));
    } catch (error) {
      handleError(error, setLoadError);
    }
  }

  useEffect(() => {
    load();
    // Load once per sign-in.
  }, [sessionToken]);

  const matches = useMemo(() => overview?.seasons.find((item) => item.season === season)?.matches ?? [], [overview, season]);
  const opponentChoices = useMemo(() => {
    const names = new Set(overview?.opponents ?? []);
    if (editing && editing !== 'new') names.add(editing.opponent);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [overview, editing]);
  const timeChoices = draft && !TIME_SLOTS.includes(draft.time) && draft.time ? [...TIME_SLOTS, draft.time] : TIME_SLOTS;

  function openForm(match: ScheduleItem | 'new') {
    if (!overview) return;
    setEditing(match);
    setFormError('');
    setResult(null);
    setDraft(match === 'new' ? emptyDraft(overview) : { format: match.format, opponent: match.opponent, otherOpponent: '', date: match.date, time: match.time, ground: match.ground });
  }

  function closeForm() {
    setEditing(null);
    setDraft(null);
    setFormError('');
  }

  async function submit(change: ScheduleChange) {
    setSaving(true);
    setFormError('');
    try {
      const response = await changeSchedule(sessionToken, change);
      setOverview({ seasons: response.seasons, opponents: response.opponents, formats: response.formats, grounds: response.grounds });
      setResult({ summary: response.summary, commitUrl: response.commitUrl });
      closeForm();
    } catch (error) {
      handleError(error, setFormError);
    } finally {
      setSaving(false);
    }
  }

  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !editing) return;
    const opponent = (draft.opponent === OTHER_OPPONENT ? draft.otherOpponent : draft.opponent).trim();
    if (!opponent) {
      setFormError('Choose the opponent.');
      return;
    }
    const match: ScheduleMatchInput = { format: draft.format, opponent, date: draft.date, time: draft.time, ground: draft.ground };
    submit(editing === 'new' ? { action: 'add', season, match } : { action: 'update', season, key: editing.key, match });
  }

  function remove(match: ScheduleItem) {
    if (!window.confirm(`Remove ${match.format} vs ${match.opponent} on ${displayDate(match.date)} from the schedule?`)) return;
    setResult(null);
    submit({ action: 'delete', season, key: match.key });
  }

  // Completed: before today, or its scorecard is on the site (newest first). Upcoming: the rest (soonest first).
  const today = todayIso();
  const isCompleted = (match: ScheduleItem) => match.date < today || scorecardDates.includes(`${season}/${match.date}`);
  const upcoming = matches.filter((match) => !isCompleted(match));
  const completed = matches.filter(isCompleted).reverse();

  const renderRow = (match: ScheduleItem) => (
    <li key={match.key} className={editing !== 'new' && editing?.key === match.key ? 'ad-schedule-row ad-schedule-row--editing' : 'ad-schedule-row'}>
      <div className="ad-match-row__main">
        <span className="ad-match-row__opponent">
          vs {match.opponent}
          {match.format !== 'League' && <span className="ad-schedule-format">{match.format}</span>}
        </span>
        <span className="ad-match-row__meta">
          {displayDate(match.date)} · {match.time} · {match.ground}
        </span>
      </div>
      <div className="ad-schedule-row__actions">
        <button type="button" className="ad-link-button" onClick={() => openForm(match)} disabled={saving}>
          Edit
        </button>
        <button type="button" className="ad-link-button ad-link-button--danger" onClick={() => remove(match)} disabled={saving}>
          Remove
        </button>
      </div>
    </li>
  );

  const update = (field: keyof Draft, value: string) => setDraft((current) => (current ? { ...current, [field]: value } : current));

  if (loadError) {
    return (
      <>
        <h1 className="ad-title">Schedule</h1>
        <p className="ad-error" role="alert">
          {loadError}
        </p>
        <button type="button" className="ad-link-button" onClick={load}>
          Try again
        </button>
      </>
    );
  }

  if (!overview) {
    return (
      <p className="ad-status" role="status">
        Loading schedule…
      </p>
    );
  }

  return (
    <>
      <h1 className="ad-title">Schedule</h1>
      <p className="ad-subtitle">Add quarter-final, semi-final and final matches, or fix a date, time or ground. The site updates about 3 minutes after you save, and new matches get availability emails like league matches.</p>

      {result && (
        <div className="ad-success ad-potw-message ad-potw-message--top" role="status">
          Saved: {result.summary}. The site will update in about 3 minutes.{' '}
          <a href={result.commitUrl} target="_blank" rel="noreferrer">
            See the commit
          </a>
          .
        </div>
      )}

      <div className="ad-field">
        <label htmlFor="ad-schedule-season">Season</label>
        <select
          id="ad-schedule-season"
          value={season}
          onChange={(event) => {
            setSeason(event.target.value);
            closeForm();
            setResult(null);
          }}
          disabled={saving}
        >
          {overview.seasons.map((item) => (
            <option key={item.season} value={item.season}>
              {seasonLabel(item.season)}
            </option>
          ))}
        </select>
      </div>

      {editing === null && (
        <button type="button" className="ad-button ad-schedule-add" onClick={() => openForm('new')} disabled={!season || saving}>
          Add a match
        </button>
      )}

      {editing !== null && draft && (
        <form className="ad-schedule-form" onSubmit={save}>
          <h2 className="ad-schedule-form__title">{editing === 'new' ? 'New match' : `Change ${editing.format} vs ${editing.opponent}`}</h2>
          <div className="ad-field-row">
            <div className="ad-field">
              <label htmlFor="ad-schedule-format">Format</label>
              <select id="ad-schedule-format" value={draft.format} onChange={(event) => update('format', event.target.value)} required>
                {overview.formats.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </div>
            <div className="ad-field">
              <label htmlFor="ad-schedule-opponent">Opponent</label>
              <select id="ad-schedule-opponent" value={draft.opponent} onChange={(event) => update('opponent', event.target.value)} required>
                <option value="" disabled>
                  Choose a team
                </option>
                {opponentChoices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={OTHER_OPPONENT}>Another team…</option>
              </select>
            </div>
          </div>
          {draft.opponent === OTHER_OPPONENT && (
            <div className="ad-field">
              <label htmlFor="ad-schedule-other">Team name</label>
              <input id="ad-schedule-other" value={draft.otherOpponent} onChange={(event) => update('otherOpponent', event.target.value)} maxLength={60} placeholder="As it appears on the league site" required />
            </div>
          )}
          <div className="ad-field-row ad-field-row--three">
            <div className="ad-field">
              <label htmlFor="ad-schedule-date">Date</label>
              <input id="ad-schedule-date" type="date" value={draft.date} onChange={(event) => update('date', event.target.value)} required />
            </div>
            <div className="ad-field">
              <label htmlFor="ad-schedule-time">Start time</label>
              <select id="ad-schedule-time" value={draft.time} onChange={(event) => update('time', event.target.value)} required>
                {timeChoices.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>
            <div className="ad-field">
              <label htmlFor="ad-schedule-ground">Ground</label>
              <select id="ad-schedule-ground" value={draft.ground} onChange={(event) => update('ground', event.target.value)} required>
                {overview.grounds.map((ground) => (
                  <option key={ground} value={ground}>
                    {ground}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {editing !== 'new' && <p className="ad-hint">If availability emails already went out for this match, changing its date or opponent sends fresh ones for the new fixture.</p>}
          {formError && (
            <p className="ad-error" role="alert">
              {formError}
            </p>
          )}
          <div className="ad-schedule-form__actions">
            <button type="submit" className="ad-button" disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add match' : 'Save changes'}
            </button>
            <button type="button" className="ad-link-button" onClick={closeForm} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {editing === null && formError && (
        <p className="ad-error" role="alert">
          {formError}
        </p>
      )}

      {matches.length === 0 ? (
        <p className="ad-empty">No matches in this season's schedule yet.</p>
      ) : (
        <>
          <section className="ad-schedule-section">
            <h2 className="ad-schedule-section__title">
              Upcoming <span>({upcoming.length})</span>
            </h2>
            {upcoming.length === 0 ? <p className="ad-empty">No upcoming matches. Add the next one above.</p> : <ul className="ad-schedule-list">{upcoming.map(renderRow)}</ul>}
          </section>
          <section className="ad-schedule-section">
            <h2 className="ad-schedule-section__title">
              Completed <span>({completed.length})</span>
            </h2>
            {completed.length === 0 ? <p className="ad-empty">No completed matches yet.</p> : <ul className="ad-schedule-list">{completed.map(renderRow)}</ul>}
          </section>
        </>
      )}
    </>
  );
}

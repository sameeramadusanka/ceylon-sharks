import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  fetchMatchDetail,
  fetchMatches,
  requestLoginCode,
  verifyLoginCode,
  type AdminApiError,
  type AvailabilityStatus,
  type MatchDetail,
  type MatchListItem,
} from '../../services/adminApi';

type Phase = 'email' | 'requesting' | 'code' | 'verifying' | 'loading-matches' | 'matches' | 'loading-detail' | 'detail' | 'error' | 'signed-out';

const REDIRECT_SECONDS = 5;

interface Session {
  token: string;
  email: string;
}

const SESSION_STORAGE_KEY = 'ceylonsharks-admin-session';

const STATUS_LABELS: Record<AvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  UNAVAILABLE: 'Unavailable',
  MAYBE: 'Maybe',
  NOT_SUBMITTED: 'No response',
};

const STATUS_ORDER: AvailabilityStatus[] = ['AVAILABLE', 'UNAVAILABLE', 'MAYBE', 'NOT_SUBMITTED'];

// Player table only: Available, Maybe, Unavailable, No response - distinct from STATUS_ORDER above,
// which drives the count chips and stays in sync with the backend's count object field order.
const PLAYER_SORT_ORDER: Record<AvailabilityStatus, number> = { AVAILABLE: 0, MAYBE: 1, UNAVAILABLE: 2, NOT_SUBMITTED: 3 };

function sortPlayersByStatus(players: MatchDetail['players']): MatchDetail['players'] {
  return [...players].sort((a, b) => PLAYER_SORT_ORDER[a.availability] - PLAYER_SORT_ORDER[b.availability] || a.playerName.localeCompare(b.playerName));
}

function loadStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed.token && parsed.email ? parsed : null;
  } catch {
    return null;
  }
}

function storeSession(session: Session): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export default function AdminPanel() {
  const [phase, setPhase] = useState<Phase>('email');
  const [session, setSession] = useState<Session | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<MatchDetail | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (phase !== 'signed-out') return;
    setRedirectCountdown(REDIRECT_SECONDS);
    const interval = setInterval(() => {
      setRedirectCountdown((seconds) => {
        if (seconds <= 1) {
          window.location.href = import.meta.env.BASE_URL || '/';
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  async function loadMatches(activeSession: Session) {
    setPhase('loading-matches');
    try {
      const result = await fetchMatches(activeSession.token);
      setMatches(result);
      setPhase('matches');
    } catch (error) {
      const apiError = error as AdminApiError;
      if (apiError.status === 401) {
        clearStoredSession();
        setSession(null);
        setErrorMessage('Your session has expired - please sign in again.');
        setPhase('email');
        return;
      }
      setErrorMessage(apiError.message);
      setPhase('error');
    }
  }

  useEffect(() => {
    const stored = loadStoredSession();
    if (!stored) return;
    setSession(stored);
    loadMatches(stored);
  }, []);

  async function submitEmail(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    setPhase('requesting');
    setErrorMessage('');
    try {
      const message = await requestLoginCode(email);
      setInfoMessage(message);
      setPhase('code');
    } catch (error) {
      setErrorMessage((error as AdminApiError).message);
      setPhase('error');
    }
  }

  async function submitCode(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = codeInput.trim();
    if (!code) return;
    setPhase('verifying');
    setErrorMessage('');
    try {
      const result = await verifyLoginCode(emailInput.trim().toLowerCase(), code);
      const newSession: Session = { token: result.sessionToken, email: result.email };
      storeSession(newSession);
      setSession(newSession);
      setCodeInput('');
      await loadMatches(newSession);
    } catch (error) {
      setErrorMessage((error as AdminApiError).message);
      setPhase('code');
    }
  }

  async function openMatch(matchId: string) {
    if (!session) return;
    setPhase('loading-detail');
    setErrorMessage('');
    try {
      const detail = await fetchMatchDetail(session.token, matchId);
      setSelectedMatch(detail);
      setPhase('detail');
    } catch (error) {
      const apiError = error as AdminApiError;
      if (apiError.status === 401) {
        clearStoredSession();
        setSession(null);
        setErrorMessage('Your session has expired - please sign in again.');
        setPhase('email');
        return;
      }
      setErrorMessage(apiError.message);
      setPhase('error');
    }
  }

  function backToMatches() {
    setSelectedMatch(null);
    setPhase('matches');
  }

  function signOut() {
    clearStoredSession();
    setSession(null);
    setEmailInput('');
    setCodeInput('');
    setMatches([]);
    setSelectedMatch(null);
    setInfoMessage('');
    setErrorMessage('');
    setPhase('signed-out');
  }

  const isSignedIn = session !== null;

  return (
    <div className="ad-page">
      <div className={isSignedIn ? 'ad-shell ad-shell--wide' : 'ad-shell'}>
        <div className="ad-header">
          <div className="ad-brand-row">
            <img src="/brand/ceylon-sharks-logo.png" alt="" className="ad-logo" />
            <span className="ad-brand">Ceylon Sharks Admin</span>
          </div>
          {isSignedIn && (
            <button type="button" className="ad-link-button" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>

        {phase === 'signed-out' && (
          <>
            <h1 className="ad-title">Signed out</h1>
            <p className="ad-subtitle">You've been signed out.</p>
            <p className="ad-status" role="status">
              Redirecting to the homepage in {redirectCountdown}s…
            </p>
            <button type="button" className="ad-link-button" onClick={() => setPhase('email')}>
              Sign in again
            </button>
          </>
        )}

        {phase === 'email' && (
          <>
            <h1 className="ad-title">Sign in</h1>
            <p className="ad-subtitle">Enter your email and we'll send you a one-time sign-in code.</p>
            <form onSubmit={submitEmail}>
              <div className="ad-field">
                <label htmlFor="ad-email">Email</label>
                <input id="ad-email" type="email" required value={emailInput} onChange={(event) => setEmailInput(event.target.value)} placeholder="you@example.com" />
              </div>
              <button type="submit" className="ad-button">
                Send code
              </button>
            </form>
          </>
        )}

        {phase === 'requesting' && (
          <p className="ad-status" role="status">
            Sending code…
          </p>
        )}

        {(phase === 'code' || phase === 'verifying') && (
          <>
            <h1 className="ad-title">Enter your code</h1>
            <p className="ad-subtitle">{infoMessage || 'If that email has admin access, a sign-in code was sent.'}</p>
            <form onSubmit={submitCode}>
              <div className="ad-field">
                <label htmlFor="ad-code">6-digit code</label>
                <input
                  id="ad-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  disabled={phase === 'verifying'}
                  placeholder="000000"
                />
              </div>
              <button type="submit" className="ad-button" disabled={phase === 'verifying'}>
                {phase === 'verifying' ? 'Verifying…' : 'Sign in'}
              </button>
            </form>
            <button type="button" className="ad-link-button" onClick={() => setPhase('email')}>
              Use a different email
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1 className="ad-title">Something went wrong</h1>
            <p className="ad-error" role="alert">
              {errorMessage}
            </p>
            <button type="button" className="ad-link-button" onClick={() => (session ? loadMatches(session) : setPhase('email'))}>
              Try again
            </button>
          </>
        )}

        {phase === 'loading-matches' && (
          <p className="ad-status" role="status">
            Loading matches…
          </p>
        )}

        {phase === 'matches' && (
          <>
            <h1 className="ad-title">Matches</h1>
            <p className="ad-subtitle">Signed in as {session?.email}</p>
            {matches.length === 0 ? (
              <p className="ad-empty">No matches yet.</p>
            ) : (
              <ul className="ad-match-list">
                {matches.map((match) => (
                  <li key={match.matchId}>
                    <button type="button" className="ad-match-row" onClick={() => openMatch(match.matchId)}>
                      <div className="ad-match-row__main">
                        <span className="ad-match-row__opponent">vs {match.opponent}</span>
                        <span className="ad-match-row__meta">
                          {match.matchDate}
                          {match.ground ? ` · ${match.ground}` : ''}
                        </span>
                      </div>
                      <div className="ad-chip-row">
                        {STATUS_ORDER.map((status) => (
                          <span key={status} className={`ad-chip ad-chip--${status.toLowerCase()}`}>
                            {match.counts[status]}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {phase === 'loading-detail' && (
          <p className="ad-status" role="status">
            Loading match…
          </p>
        )}

        {phase === 'detail' && selectedMatch && (
          <>
            <button type="button" className="ad-link-button ad-back" onClick={backToMatches}>
              ← All matches
            </button>
            <h1 className="ad-title">vs {selectedMatch.opponent}</h1>
            <p className="ad-subtitle">
              {selectedMatch.competition} · {selectedMatch.matchDate}
              {selectedMatch.time ? ` · ${selectedMatch.time}` : ''}
              {selectedMatch.ground ? ` · ${selectedMatch.ground}` : ''}
            </p>

            <div className="ad-chip-row ad-chip-row--summary">
              {STATUS_ORDER.map((status) => (
                <span key={status} className={`ad-chip ad-chip--${status.toLowerCase()}`}>
                  {STATUS_LABELS[status]} ({selectedMatch.counts[status]})
                </span>
              ))}
            </div>

            <table className="ad-player-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Status</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {sortPlayersByStatus(selectedMatch.players).map((player) => (
                  <tr key={player.playerEmail}>
                    <td>{player.playerName}</td>
                    <td>
                      <span className={`ad-chip ad-chip--${player.availability.toLowerCase()}`}>{STATUS_LABELS[player.availability]}</span>
                    </td>
                    <td className="ad-player-table__comments">{player.comments || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

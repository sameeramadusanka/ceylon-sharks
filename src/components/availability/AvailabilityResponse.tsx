import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  submitAvailability,
  validateToken,
  type Availability,
  type AvailabilityApiError,
  type ValidateResult,
} from '../../services/availabilityApi';

type Phase = 'loading' | 'missing-token' | 'error' | 'form' | 'submitting' | 'confirmed';

const CHOICES: Availability[] = ['AVAILABLE', 'UNAVAILABLE', 'MAYBE'];
const CHOICE_LABELS: Record<Availability, string> = { AVAILABLE: 'Available', UNAVAILABLE: 'Unavailable', MAYBE: 'Maybe' };

function formatDeadline(iso: string): string {
  try {
    // Deadlines are defined and communicated in Asia/Singapore throughout the backend
    // (see the plan doc) - show that, not the viewer's device timezone.
    return `${new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Singapore' }).format(new Date(iso))} SGT`;
  } catch {
    return iso;
  }
}

export default function AvailabilityResponse() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<ValidateResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selected, setSelected] = useState<Availability | null>(null);
  const [comments, setComments] = useState('');
  const [confirmation, setConfirmation] = useState<{ availability: Availability; updatedAt: string } | null>(null);

  function runValidate(tokenValue: string) {
    setPhase('loading');
    validateToken(tokenValue)
      .then((result) => {
        setData(result);
        if (result.currentAvailability !== 'NOT_SUBMITTED') setSelected(result.currentAvailability);
        setPhase('form');
      })
      .catch((error: AvailabilityApiError) => {
        setErrorMessage(error.message);
        setPhase('error');
      });
  }

  useEffect(() => {
    const tokenValue = new URLSearchParams(window.location.search).get('token');
    if (!tokenValue) {
      setPhase('missing-token');
      return;
    }
    // Keep the token in memory for API calls, but never leave it visible in the address bar.
    window.history.replaceState({}, '', window.location.pathname);
    setToken(tokenValue);
    runValidate(tokenValue);
  }, []);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selected) return;
    setPhase('submitting');
    try {
      const result = await submitAvailability(token, selected, comments.trim());
      setConfirmation({ availability: result.availability, updatedAt: result.updatedAt });
      setPhase('confirmed');
    } catch (error) {
      setErrorMessage((error as AvailabilityApiError).message);
      setPhase('error');
    }
  }

  if (phase === 'missing-token') {
    return (
      <div className="av-page">
        <div className="av-card">
          <p className="av-brand">Ceylon Sharks</p>
          <h1 className="av-title">Link incomplete</h1>
          <p className="av-subtitle">This page needs the invitation link from your email - please open it directly rather than typing the address in.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="av-page">
      <div className="av-card">
        <p className="av-brand">Ceylon Sharks</p>

        {phase === 'loading' && (
          <>
            <h1 className="av-title">Loading your invitation…</h1>
            <p className="av-status" role="status">
              Checking your link
            </p>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1 className="av-title">Unable to load this invitation</h1>
            <p className="av-error" role="alert">
              {errorMessage}
            </p>
            {token && (
              <button type="button" className="av-link-button" onClick={() => runValidate(token)}>
                Try again
              </button>
            )}
          </>
        )}

        {(phase === 'form' || phase === 'submitting') && data && (
          <>
            <h1 className="av-title">Hi {data.playerName}</h1>
            <p className="av-subtitle">Let us know if you can make this one.</p>

            <dl className="av-match">
              <dt>Opponent</dt>
              <dd>{data.match.opponent}</dd>
              <dt>Competition</dt>
              <dd>{data.match.competition}</dd>
              <dt>Match date</dt>
              <dd>{data.match.matchDate}</dd>
              <dt>Respond by</dt>
              <dd>{formatDeadline(data.deadline)}</dd>
            </dl>

            <form onSubmit={handleSubmit}>
              <div className="av-group" role="group" aria-label="Your availability">
                {CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="av-choice"
                    aria-pressed={selected === choice}
                    onClick={() => setSelected(choice)}
                    disabled={phase === 'submitting'}
                  >
                    {CHOICE_LABELS[choice]}
                  </button>
                ))}
              </div>

              <div className="av-field">
                <label htmlFor="av-comments">Comment (optional)</label>
                <textarea
                  id="av-comments"
                  rows={3}
                  maxLength={500}
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                  disabled={phase === 'submitting'}
                  placeholder="Anything the captain should know?"
                />
              </div>

              <button type="submit" className="av-button" disabled={!selected || phase === 'submitting'}>
                {phase === 'submitting' ? 'Submitting…' : 'Submit response'}
              </button>
            </form>

            <p className="av-note">You can revisit this link anytime before the deadline to change your response.</p>
          </>
        )}

        {phase === 'confirmed' && confirmation && (
          <>
            <p className="av-confirm-badge">{CHOICE_LABELS[confirmation.availability]}</p>
            <h1 className="av-title">Response recorded</h1>
            <p className="av-subtitle">Thanks - the captain and vice-captain have been notified.</p>
            <button
              type="button"
              className="av-link-button"
              onClick={() => {
                setPhase('form');
              }}
            >
              Change my response
            </button>
          </>
        )}
      </div>
    </div>
  );
}

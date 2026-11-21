import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Share2 } from 'lucide-react';
import team from '../data/team.json';
import site from '../data/site.json';
import type { PlayerOfTheWeekEntry } from '../lib/playerOfTheWeek';

type Props = {
  entries: PlayerOfTheWeekEntry[];
  /** Numbered section label, e.g. "02 / Player of the Week". */
  label: string;
  /** Opens the player's profile modal, when the player is in the currently loaded squad. */
  onViewProfile?: () => void;
  /** Opens the scorecard modal, when that match's scorecard exists. */
  onViewScoreCard?: () => void;
};

const copy = site.playerOfTheWeek;
const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
const sitePath = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;

export function posterAlt(entry: PlayerOfTheWeekEntry) {
  return fill(copy.posterAltTemplate, { player: entry.playerName, team: team.name, opponent: entry.opponent, date: entry.displayDate });
}

export default function PlayerOfTheWeekSection({ entries, label, onViewProfile, onViewScoreCard }: Props) {
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const [current, ...previous] = entries;

  useEffect(() => {
    if (shareState !== 'copied') return undefined;
    const reset = window.setTimeout(() => setShareState('idle'), 2500);
    return () => window.clearTimeout(reset);
  }, [shareState]);

  if (!current) return null;

  const pagePath = sitePath(current.pagePath);
  const stats = [
    { label: copy.batting, value: current.batting },
    { label: copy.bowling, value: current.bowling },
    { label: copy.fielding, value: current.fielding },
  ].filter((stat): stat is { label: string; value: string } => Boolean(stat.value));

  const share = async () => {
    const url = new URL(pagePath, window.location.origin).toString();
    const title = fill(copy.shareTitleTemplate, { player: current.playerName, team: team.name });
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // The user closed the share sheet; nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareState('copied');
    } catch {
      window.prompt(title, url);
    }
  };

  return (
    <section className="potw section-cream" id="player-of-the-week">
      <div className="page-width">
        <div className="section-heading">
          <div>
            <p className="section-label"><span />{label}</p>
            <h2>{site.sections.playerOfTheWeek.titleBefore}<br /><em>{site.sections.playerOfTheWeek.titleEmphasis}</em></h2>
          </div>
        </div>

        <div className="potw-feature">
          <a className="potw-poster" href={pagePath} aria-label={current.playerName}>
            <img src={current.poster.src} width={current.poster.width} height={current.poster.height} alt={posterAlt(current)} loading="lazy" decoding="async" />
          </a>
          <div className="potw-details">
            <p className="potw-kicker">{current.displayDate}{current.competition ? ` · ${current.competition}` : ''}</p>
            <h3 className="potw-name">{current.playerName}</h3>
            <p className="potw-opponent">{copy.versus} <b>{current.opponent}</b></p>
            {stats.length > 0 && (
              <div className="potw-stats">
                {stats.map((stat, index) => (
                  <div className={`stat-block${index === 0 ? ' stat-block--accent' : ''}`} key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>
                ))}
              </div>
            )}
            {current.caption && <p className="potw-caption">{current.caption}</p>}
            <div className="potw-actions">
              {onViewProfile && <button className="button button--primary" type="button" onClick={onViewProfile}>{copy.viewProfile} <ArrowUpRight size={15} /></button>}
              {onViewScoreCard && <button className="button button--outline" type="button" onClick={onViewScoreCard}>{copy.viewScoreCard}</button>}
              <button className="button button--outline" type="button" onClick={share}>
                {shareState === 'copied' ? <><Check size={15} /> {copy.linkCopied}</> : <><Share2 size={15} /> {copy.share}</>}
              </button>
            </div>
          </div>
        </div>

        {previous.length > 0 && (
          <div className="potw-archive">
            <h3>{copy.previousWinners}</h3>
            <div className="potw-archive-list">
              {previous.map((entry) => (
                <a className="potw-archive-item" href={sitePath(entry.pagePath)} key={entry.date}>
                  <img src={entry.thumbnail} alt="" loading="lazy" decoding="async" />
                  <span><b>{entry.playerName}</b><small>{entry.displayDate} · {copy.versus} {entry.opponent}</small></span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

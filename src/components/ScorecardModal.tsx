import { X } from 'lucide-react';
import site from '../data/site.json';

export type ScoreCard = {
  match: {
    id: string;
    competition: string;
    date: string;
    teams: { home: { name: string }; away: { name: string } };
    result: { winner: string; summary: string; margin: { type: string; value: number } };
  };
  innings: Array<{
    inningsNumber: number;
    team: string;
    opponent: string;
    score: { display: string; overs: number; runRate: number };
    batting: Array<{
      player: string;
      dismissal: { type: string; fielder: string | null; bowler: string | null } | null;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      strikeRate: number;
    }>;
    extras: { byes: number; legByes: number; wides: number; noBalls: number; penalty: number; total: number };
    bowling: Array<{
      player: string;
      overs: number;
      maidens: number;
      runs: number;
      wickets: number;
      wides: number;
      noBalls: number;
      hattricks: number;
      dotBalls: number;
      economy: number;
    }>;
    fallOfWickets: Array<{ wicketNumber: number; player: string; score: number; over: number }>;
  }>;
  matchSummary: { winner: string; margin: string };
};

type ScorecardModalProps = { scoreCard: ScoreCard; onClose: () => void };

const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function dismissalText(dismissal: ScoreCard['innings'][number]['batting'][number]['dismissal']) {
  if (!dismissal) return 'not out';
  const detail = dismissal.bowler ? ` b ${dismissal.bowler}` : dismissal.fielder ? ` (${dismissal.fielder})` : '';
  return `${titleCase(dismissal.type)}${detail}`;
}

export default function ScorecardModal({ scoreCard, onClose }: ScorecardModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="scorecard-modal" role="dialog" aria-modal="true" aria-labelledby="scorecard-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label={site.accessibility.closeScorecard}><X size={19} /></button>
        <div className="scorecard-header">
          <span className="modal-number">{scoreCard.match.competition} · {scoreCard.match.date}</span>
          <h2 id="scorecard-title">{site.scorecardLabels.title}</h2>
          <p>{scoreCard.match.teams.home.name.toUpperCase()} <b>VS</b> {scoreCard.match.teams.away.name.toUpperCase()}</p>
          <strong>{scoreCard.matchSummary.winner.toUpperCase()} {site.scorecardLabels.winnerSuffix} {scoreCard.matchSummary.margin.toUpperCase()}</strong>
        </div>
        <div className="scorecard-innings">
          {scoreCard.innings.map((innings) => (
            <details className="scorecard-innings-block" key={innings.team} open>
              <summary className="scorecard-innings-score">
                <span>{innings.team.toUpperCase()}</span>
                <strong>{innings.score.display}</strong>
                <small>{innings.score.overs} OV · {innings.score.runRate} RR</small>
              </summary>
              <div className="scorecard-section">
                <div className="scorecard-section-heading"><h3>{site.scorecardLabels.batting}</h3><span>{site.scorecardLabels.runs}</span></div>
                <div className="scorecard-table scorecard-table--batting">
                  <div className="scorecard-table-row scorecard-table-heading"><span>{site.scorecardLabels.player}</span><span>{site.scorecardLabels.dismissal}</span><span>R</span><span>B</span><span>4s</span><span>6s</span><span>SR</span></div>
                  {innings.batting.map((batter) => <div className="scorecard-table-row" key={batter.player}><span className="scorecard-player-name">{batter.player}</span><span className="scorecard-dismissal">{dismissalText(batter.dismissal)}</span><span>{batter.runs}</span><span>{batter.balls}</span><span>{batter.fours}</span><span>{batter.sixes}</span><span>{batter.strikeRate.toFixed(2)}</span></div>)}
                </div>
                <div className="scorecard-extras"><span>{site.scorecardLabels.extras}</span><b>{innings.extras.total}</b><small> b {innings.extras.byes} · lb {innings.extras.legByes} · w {innings.extras.wides} · nb {innings.extras.noBalls}</small></div>
              </div>
              <div className="scorecard-section">
                <div className="scorecard-section-heading"><h3>{site.scorecardLabels.bowling}</h3><span>{site.scorecardLabels.wickets}</span></div>
                <div className="scorecard-table scorecard-table--bowling">
                  <div className="scorecard-table-row scorecard-table-heading"><span>{site.scorecardLabels.player}</span><span>O</span><span>M</span><span>R</span><span>W</span><span>Wd</span><span>NB</span><span>ECO</span></div>
                  {innings.bowling.map((bowler) => <div className="scorecard-table-row" key={bowler.player}><span className="scorecard-player-name">{bowler.player}</span><span>{bowler.overs}</span><span>{bowler.maidens}</span><span>{bowler.runs}</span><span>{bowler.wickets}</span><span>{bowler.wides}</span><span>{bowler.noBalls}</span><span>{bowler.economy.toFixed(2)}</span></div>)}
                </div>
              </div>
              <div className="scorecard-section scorecard-fall-of-wickets">
                <div className="scorecard-section-heading"><h3>{site.scorecardLabels.fallOfWickets}</h3></div>
                <p>{innings.fallOfWickets.map((wicket) => `${wicket.wicketNumber}-${wicket.score} (${wicket.player}, ${wicket.over})`).join(' · ')}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

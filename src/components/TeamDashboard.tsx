import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, CircleDot, Menu, Play, X } from 'lucide-react';
import team from '../data/team.json';
import fallbackPlayers from '../data/players.json';
import fallbackMatches from '../data/matches.json';
import history from '../data/history.json';
import site from '../data/site.json';
import '../styles/scorecard.css';
import ScorecardModal, { type ScoreCard } from './ScorecardModal';

type Player = {
  id: number;
  name: string;
  number: number;
  role: string;
  shortRole: string;
  image: string;
  runs: number;
  average: string;
  strikeRate: string;
  detail: string;
  battingRuns: number;
  battingAverage: number | null;
  battingStrikeRate: number | null;
  battingHighestScore: number | null;
  battingFours: number | null;
  battingSixes: number | null;
  bowlingWickets: number;
  bowlingEconomy: number | null;
  bowlingAverage: number | null;
  bowlingStrikeRate: number | null;
  bowlingBestWickets: number | null;
  fieldingDismissals: number;
  fieldingCatches: number | null;
  fieldingRunOuts: number | null;
  fieldingStumpings: number | null;
  leadership: 'CAPTAIN' | 'VICE CAPTAIN' | null;
};
type Match = {
  id: number;
  format: string;
  date: string;
  opponent: string;
  opponentShort: string;
  teamScore: string;
  opponentScore: string;
  teamOvers?: string;
  opponentOvers?: string;
  winByRuns: boolean;
  winMarginRuns: number | null;
  result: 'WIN' | 'LOSS' | 'NO RESULT';
  margin: string;
  venue: string;
};
type Metric = (typeof site.metrics)[number]['key'];
type SeasonFile = { fileName: string; season: string; division: string; year: number; content: string };
type SeasonStatisticsSource = { fileName: string; season: string; division: string; statisticsType: string; content: string };
type ScoreCardSource = { fileName: string; season: string; division: string; matchNumber: number; date: string; content: string };
type DashboardProps = { playersBySeason: Record<string, string>; bannerImages: string[]; groundImage: string; playerImages: Record<string, string>; seasonFiles: SeasonFile[]; seasonStatistics: SeasonStatisticsSource[]; scoreCards: ScoreCardSource[] };

const shortName = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 7).toUpperCase();
const displayDate = (date: string) => new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
const assetPath = (path: string) => {
  const value = path.trim();
  if (!value) return '';
  if (value.startsWith('http')) return value;
  return `${import.meta.env.BASE_URL}${value.replace(/^\/+/, '').replace(/^assets\//, '')}`;
};
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const statValue = (value: number | null) => value === null ? '-' : String(value);
const scoreParts = (score: string) => {
  const [runs, wickets] = score.split('/').map(Number);
  return Number.isFinite(runs) && Number.isFinite(wickets) ? { runs, wickets } : null;
};
const oversToDecimal = (overs: string | undefined) => {
  if (!overs) return null;
  const [completedOvers, balls] = overs.split('.').map(Number);
  return Number.isFinite(completedOvers) && Number.isFinite(balls) ? completedOvers + balls / 6 : null;
};

function parsePlayers(json: string, statistics: SeasonStatisticsSource[], playerImages: Record<string, string>): Player[] {
  const data = JSON.parse(json) as { season: { captainId?: number; viceCaptainId?: number; viceCaptainID?: number; players: Array<{ id: number; name: string; number: number; detail: string; image?: string }> } };
  const statsByType = new Map(statistics.map((source) => [source.statisticsType, JSON.parse(source.content) as { season: { players: Array<Record<string, number | string | null>> } }]));
  const batting = statsByType.get('BATTING')?.season.players ?? [];
  const bowling = statsByType.get('BOWLING')?.season.players ?? [];
  const fielding = statsByType.get('FIELDING')?.season.players ?? [];
  return data.season.players.map((player) => ({
    ...(() => {
      const battingStats = batting.find((stat) => stat.player === player.name);
      const bowlingStats = bowling.find((stat) => stat.player === player.name);
      const fieldingStats = fielding.find((stat) => stat.player === player.name);
      const numberValue = (stats: Record<string, number | string | null> | undefined, key: string) => typeof stats?.[key] === 'number' ? stats[key] as number : null;
      const playerLeadership: Player['leadership'] = player.id === data.season.captainId ? 'CAPTAIN' : player.id === (data.season.viceCaptainId ?? data.season.viceCaptainID) ? 'VICE CAPTAIN' : null;
      return {
        battingRuns: numberValue(battingStats, 'runs') ?? 0,
        battingAverage: numberValue(battingStats, 'average'),
        battingStrikeRate: numberValue(battingStats, 'strikeRate'),
        battingHighestScore: numberValue(battingStats, 'highestScore'),
        battingFours: numberValue(battingStats, 'fours'),
        battingSixes: numberValue(battingStats, 'sixes'),
        bowlingWickets: numberValue(bowlingStats, 'wickets') ?? 0,
        bowlingEconomy: numberValue(bowlingStats, 'economy'),
        bowlingAverage: numberValue(bowlingStats, 'average'),
        bowlingStrikeRate: numberValue(bowlingStats, 'strikeRate'),
        bowlingBestWickets: numberValue(bowlingStats, 'bestBowlingWickets'),
        fieldingDismissals: numberValue(fieldingStats, 'totalDismissals') ?? 0,
        fieldingCatches: numberValue(fieldingStats, 'catches'),
        fieldingRunOuts: (numberValue(fieldingStats, 'directRunOuts') ?? 0) + (numberValue(fieldingStats, 'indirectRunOuts') ?? 0),
        fieldingStumpings: numberValue(fieldingStats, 'stumpings'),
        leadership: playerLeadership,
      };
    })(),
    id: player.id,
    name: player.name,
    number: player.number,
    role: 'PLAYER',
    shortRole: 'PLAYER',
    image: assetPath(player.image ?? playerImages[String(player.id)] ?? ''),
    runs: 0,
    average: '-',
    strikeRate: '-',
    detail: player.detail,
  })).sort((firstPlayer, secondPlayer) => {
    const leadershipRank = (player: Player) => player.leadership === 'CAPTAIN' ? 0 : player.leadership === 'VICE CAPTAIN' ? 1 : 2;
    return leadershipRank(firstPlayer) - leadershipRank(secondPlayer);
  });
}

function parseMatches(json: string, teamName: string): Match[] {
  const data = JSON.parse(json) as { season: { matches: Array<{ id: number; format: string; date: string; teamOne: string; teamTwo: string; result: string; scoreSummary: string }> } };
  return data.season.matches.map(({ id, format, date, teamOne, teamTwo, result, scoreSummary }) => {
    const abandoned = result.toLowerCase().includes('abandoned');
    const scoreDetails = abandoned ? [] : [...scoreSummary.matchAll(/([^:]+):\s*([\d-]+\/\d+)\(([\d.]+)\)/g)].map((match) => ({ name: match[1].trim(), score: match[2], overs: match[3] }));
    const scores = scoreDetails.map(({ name, score }) => ({ name, score }));
    const opponent = teamOne === teamName ? teamTwo : teamOne;
    const teamScore = scores.find((score) => score.name === teamName)?.score ?? '-';
    const opponentScore = scores.find((score) => score.name === opponent)?.score ?? '-';
    const won = result.startsWith(teamName);
    const matchResult: Match['result'] = abandoned ? 'NO RESULT' : won ? 'WIN' : 'LOSS';
    const winMarginMatch = result.startsWith(`${teamName} won by `) ? result.match(/won by (\d+)\s+runs?/i) : null;
    return { id, format, date: displayDate(date), opponent, opponentShort: shortName(opponent), teamScore, opponentScore, teamOvers: scoreDetails.find((score) => score.name === teamName)?.overs, opponentOvers: scoreDetails.find((score) => score.name === opponent)?.overs, winByRuns: winMarginMatch !== null, winMarginRuns: winMarginMatch ? Number(winMarginMatch[1]) : null, result: matchResult, margin: abandoned ? 'no result' : result.replace(`${teamName} won by `, '').replace(`${opponent} won by `, '').replace('.', ''), venue: '' };
  }).sort((firstMatch, secondMatch) => new Date(secondMatch.date).getTime() - new Date(firstMatch.date).getTime());
}

function parseScoreCard(source: ScoreCardSource): ScoreCard {
  return JSON.parse(source.content) as ScoreCard;
}

function text(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template);
}

function SectionLabel({ children }: { children: string }) {
  return <p className="section-label"><span />{children}</p>;
}

function StatBlock({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return <div className={`stat-block${accent ? ' stat-block--accent' : ''}`}><strong>{value}</strong><span>{label}</span></div>;
}

export default function TeamDashboard({ playersBySeason, bannerImages, groundImage, playerImages, seasonFiles, seasonStatistics, scoreCards }: DashboardProps) {
  const [bannerImageIndex, setBannerImageIndex] = useState(0);
  const [format, setFormat] = useState(site.filters.all);
  const [metric, setMetric] = useState<Metric>(site.metrics[0].key);
  const [matchFilter, setMatchFilter] = useState(site.filters.all);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedScoreCard, setSelectedScoreCard] = useState<ScoreCard | null>(null);
  const [players, setPlayers] = useState<Player[]>(() => (fallbackPlayers as Player[]).map((player) => ({ ...player, image: '', battingRuns: 0, bowlingWickets: 0, fieldingDismissals: 0, leadership: null })));
  const [matches, setMatches] = useState<Match[]>(() => (fallbackMatches as Match[]).map((match) => ({ ...match, winByRuns: match.result === 'WIN', winMarginRuns: null })));
  const [selectedSeasonFile, setSelectedSeasonFile] = useState(seasonFiles[0]?.fileName ?? '');
  const [datasetMenuOpen, setDatasetMenuOpen] = useState(false);
  const datasetPickerRef = useRef<HTMLDivElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    if (bannerImages.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const rotateBanner = window.setInterval(() => setBannerImageIndex((index) => (index + 1) % bannerImages.length), 6000);
    return () => window.clearInterval(rotateBanner);
  }, [bannerImages]);

  useEffect(() => {
    const selectedFile = seasonFiles.find((file) => file.fileName === selectedSeasonFile) ?? seasonFiles[0];
    const selectedStatistics = seasonStatistics.filter((source) => source.season === selectedFile?.season && source.division === selectedFile?.division);
    const playersJson = playersBySeason[selectedFile?.season ?? ''] ?? Object.values(playersBySeason)[0] ?? '';
    if (playersJson) setPlayers(parsePlayers(playersJson, selectedStatistics, playerImages));
  }, [playersBySeason, playerImages, seasonFiles, seasonStatistics, selectedSeasonFile]);

  useEffect(() => {
    const selectedFile = seasonFiles.find((file) => file.fileName === selectedSeasonFile) ?? seasonFiles[0];
    if (selectedFile) setMatches(parseMatches(selectedFile.content, team.name));
  }, [seasonFiles, selectedSeasonFile]);

  useEffect(() => {
    if (!datasetMenuOpen) return undefined;
    const closeMenu = (event: MouseEvent) => {
      if (!datasetPickerRef.current?.contains(event.target as Node)) setDatasetMenuOpen(false);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [datasetMenuOpen]);

  const filteredMatches = matches.filter((match) => {
    const matchesFormat = format === site.filters.all || match.format === format;
    const matchesResult = matchFilter === site.filters.all || match.result === matchFilter;
    return matchesFormat && matchesResult;
  });
  const selectedMetric = site.metrics.find((item) => item.key === metric) ?? site.metrics[0];
  const performanceMatches = [...matches].reverse();
  let runningWins = 0;
  let runningCompleted = 0;
  const performanceValues: Record<Metric, number[]> = {
    FORM: performanceMatches.map((match) => match.result === 'WIN' ? 100 : match.result === 'LOSS' ? 0 : 50),
    RUNS: performanceMatches.map((match) => scoreParts(match.teamScore)?.runs ?? 0),
    WICKETS: performanceMatches.map((match) => scoreParts(match.opponentScore)?.wickets ?? 0),
    'WIN RATE': performanceMatches.map((match) => {
      if (match.result !== 'NO RESULT') {
        runningCompleted += 1;
        if (match.result === 'WIN') runningWins += 1;
      }
      return runningCompleted ? Math.round((runningWins / runningCompleted) * 100) : 0;
    }),
  };
  const chartValues = performanceValues[metric];
  const chartMax = Math.max(...chartValues);
  const availableFormats = [site.filters.all, ...Array.from(new Set(matches.map((match) => match.format)))];
  const selectedSeason = seasonFiles.find((file) => file.fileName === selectedSeasonFile) ?? seasonFiles[0];
  const seasonScoreCards = scoreCards.filter((scoreCard) => scoreCard.season === selectedSeason?.season && scoreCard.division === selectedSeason?.division);
  const seasonLabel = selectedSeason?.season ?? '26_T3_MAY';
  const seasonYear = selectedSeason?.year ?? team.season;
  const seasonRecord = matches.reduce((record, match) => {
    record[match.result] += 1;
    return record;
  }, { WIN: 0, LOSS: 0, 'NO RESULT': 0 });
  const recentForm = matches.slice(0, 8).reverse().map((match) => match.result === 'WIN' ? 'W' : match.result === 'LOSS' ? 'L' : 'NR');
  const completedMatches = seasonRecord.WIN + seasonRecord.LOSS;
  const scoredMatches = matches.map((match) => scoreParts(match.teamScore)).filter((score): score is { runs: number; wickets: number } => score !== null);
  const averageScore = scoredMatches.length ? Math.round(scoredMatches.reduce((total, score) => total + score.runs, 0) / scoredMatches.length) : 0;
  const totalWickets = matches.reduce((total, match) => total + (scoreParts(match.opponentScore)?.wickets ?? 0), 0);
  const snapshotValues = [String(matches.length), `${completedMatches ? Math.round((seasonRecord.WIN / completedMatches) * 100) : 0}%`, String(averageScore), String(totalWickets)];
  const totalOvers = matches.reduce((total, match) => total + (oversToDecimal(match.teamOvers) ?? 0), 0);
  const highestScore = Math.max(0, ...scoredMatches.map((score) => score.runs));
  const bestWinningStreak = performanceMatches.reduce((streak, match) => {
    const nextStreak = match.result === 'WIN' ? streak.current + 1 : 0;
    return { current: nextStreak, best: Math.max(streak.best, nextStreak) };
  }, { current: 0, best: 0 }).best;
  const performanceStats = site.performanceStats.map((stat, index) => ({
    ...stat,
    value: [String(bestWinningStreak), totalOvers ? (scoredMatches.reduce((total, score) => total + score.runs, 0) / totalOvers).toFixed(1) : '-', String(highestScore), matches.length ? (totalWickets / matches.length).toFixed(1) : '-'][index],
  }));
  const highestScoreMatch = matches.find((match) => scoreParts(match.teamScore)?.runs === highestScore);
  const biggestWin = matches
    .filter((match) => match.result === 'WIN' && match.winByRuns && match.winMarginRuns !== null)
    .map((match) => ({ match, margin: match.winMarginRuns ?? 0 }))
    .reduce<{ match: Match | null; margin: number }>((largest, current) => current.margin > largest.margin ? current : largest, { match: null, margin: 0 });
  const seasonRecords = [
    { label: 'Highest team score', value: highestScore ? String(highestScore) : '-', detail: highestScoreMatch ? `vs. ${highestScoreMatch.opponent}` : 'season' },
    { label: 'Longest winning streak', value: String(bestWinningStreak), detail: 'matches' },
    { label: 'Biggest win by runs', value: biggestWin.margin ? String(biggestWin.margin) : '-', detail: biggestWin.match ? `vs. ${biggestWin.match.opponent}` : 'season' },
    { label: 'Total runs scored', value: String(scoredMatches.reduce((total, score) => total + score.runs, 0)), detail: 'season total' },
  ];

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#home" aria-label={text(site.accessibility.homeLabelTemplate, { team: team.name })}>
          <img className="brand-mark" src={assetPath(site.assets.logoImage)} alt={`${team.name} logo`} />
          <span><b>{team.shortName.toUpperCase()}</b><small>{team.name === team.shortName ? 'CRICKET CLUB' : team.name.toUpperCase()}</small></span>
        </a>
        <button className="mobile-menu" aria-label={site.accessibility.toggleNavigation} onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={mobileNavOpen ? 'main-nav main-nav--open' : 'main-nav'} aria-label="Main navigation">
          {site.navigation.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMobileNavOpen(false)}>{item.label}</a>
          ))}
        </nav>
        <a className="header-cta" href="#matches">{site.actions.seasonPrefix} {seasonLabel} <ArrowUpRight size={15} /></a>
      </header>

        <section className="hero" id="home" style={{ '--hero-image': `url(${bannerImages[bannerImageIndex] ?? assetPath(site.assets.heroImage)})` } as React.CSSProperties}>
        <div className="hero-image" />
        <div className="hero-grid" />
        <div className="hero-content page-width">
          <div className="hero-copy">
            <p className="eyebrow"><CircleDot size={12} /> {team.league} · {seasonLabel}</p>
            <h1>{site.hero.headlineBefore}<br /><em>{site.hero.headlineEmphasis}</em> {site.hero.headlineAfter}</h1>
            <p className="hero-description">{text(site.hero.descriptionTemplate, { nickname: team.nickname })}</p>
            <div className="hero-actions">
              <a className="button button--primary" href="#matches">{site.actions.exploreSeason} <ArrowUpRight size={17} /></a>
              <a className="play-link" href="#history"><span><Play size={13} fill="currentColor" /></span> {site.actions.ourStory}</a>
            </div>
          </div>
          <div className="hero-scoreboard">
            <div className="scoreboard-top"><span>{seasonLabel}</span><span>{site.hero.rankLabel.toUpperCase()} <b>#{String(team.rank).padStart(2, '0')}</b></span></div>
            <div className="scoreboard-record"><strong>{String(seasonRecord.WIN).padStart(2, '0')}</strong><span>{site.hero.recordLabels[0]}</span><i>—</i><strong>{String(seasonRecord.LOSS).padStart(2, '0')}</strong><span>{site.hero.recordLabels[1]}</span><i>—</i><strong>{String(seasonRecord['NO RESULT']).padStart(2, '0')}</strong><span>{site.hero.recordLabels[2]}</span></div>
            <div className="scoreboard-footer"><span>{site.hero.formLabel.toUpperCase()}</span><div className="form-dots">{recentForm.map((item, index) => <b className={item === 'W' ? 'win' : item === 'L' ? 'loss' : 'no-result'} key={`${item}-${index}`}>{item}</b>)}</div></div>
          </div>
        </div>
        <div className="scroll-cue"><span>{site.hero.scrollLabel}</span><i /></div>
      </section>

      <section className="snapshot page-width" aria-label={site.sections.snapshot.label}>
        <div className="snapshot-intro"><SectionLabel>{site.sections.snapshot.label}</SectionLabel><h2>{site.sections.snapshot.titleBefore}<br /><em>{site.sections.snapshot.titleEmphasis}</em></h2></div>
        <div className="snapshot-stats">{site.snapshotStats.map((stat, index) => <StatBlock key={stat.label} value={snapshotValues[index]} label={stat.label} accent={stat.accent} />)}</div>
      </section>

      <section className="performance section-dark" id="statistics">
        <div className="page-width">
          <div className="section-heading"><div><SectionLabel>{site.sections.performance.label}</SectionLabel><h2>{site.sections.performance.titleBefore}<br /><em>{site.sections.performance.titleEmphasis}</em></h2></div></div>
          <div className="chart-panel">
            <div className="chart-toolbar"><div className="metric-tabs">{site.metrics.map((item) => <button className={metric === item.key ? 'is-active' : ''} key={item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div><span className="chart-note">{performanceMatches.length ? `${site.matchLabels.matchPrefix.toUpperCase()} ${performanceMatches[0].id} — ${performanceMatches[performanceMatches.length - 1].id}` : 'NO MATCH DATA'} <ChevronRight size={15} /></span></div>
            <div className="chart-area"><div className="chart-y-axis">{selectedMetric.axis.map((value) => <span key={value}>{value}</span>)}</div><div className="chart-bars">{chartValues.map((value, index) => <div className="chart-column" key={`${value}-${index}`}><div className="bar-tooltip">{value}{selectedMetric.suffix}</div><div className="chart-bar" style={{ height: `${Math.max(12, (value / chartMax) * 100)}%` }} /><span>{site.matchLabels.matchPrefix.charAt(0).toUpperCase()}{performanceMatches[index]?.id ?? index + 1}</span></div>)}</div></div>
          </div>
          <div className="metric-grid">{performanceStats.map((stat) => <StatBlock key={stat.label} value={stat.value} label={stat.label} accent={stat.accent} />)}</div>
        </div>
      </section>

      <section className="matches page-width" id="matches">
        <div className="section-heading"><div><SectionLabel>{site.sections.matches.label}</SectionLabel><h2>{site.sections.matches.titleBefore}<br /><em>{site.sections.matches.titleEmphasis}</em></h2></div><div className="match-filters">{seasonFiles.length > 0 && <div className="filter-group dataset-filter" ref={datasetPickerRef}><span>{site.filters.datasetLabel}</span><div className="dataset-picker"><button className="dataset-picker-trigger" type="button" aria-expanded={datasetMenuOpen} aria-haspopup="listbox" onClick={() => setDatasetMenuOpen(!datasetMenuOpen)}><span>{selectedSeason?.season} · {selectedSeason?.division}</span><ChevronDown size={14} /></button>{datasetMenuOpen && <div className="dataset-menu" role="listbox" aria-label={site.filters.datasetLabel}>{seasonFiles.map((file) => <button className={file.fileName === selectedSeasonFile ? 'is-selected' : ''} type="button" role="option" aria-selected={file.fileName === selectedSeasonFile} key={file.fileName} onClick={() => { setSelectedSeasonFile(file.fileName); setDatasetMenuOpen(false); }}><strong>{file.season}</strong><span>{file.division}</span></button>)}</div>}</div></div>}<div className="filter-group"><span>{site.filters.formatLabel}</span>{availableFormats.map((item) => <button className={format === item ? 'is-active' : ''} onClick={() => setFormat(item)} key={item}>{item}</button>)}</div><div className="filter-group"><span>{site.filters.resultLabel}</span>{[site.filters.all, 'WIN', 'LOSS', 'NO RESULT'].map((item) => <button className={matchFilter === item ? 'is-active' : ''} onClick={() => setMatchFilter(item)} key={item}>{item}</button>)}</div></div></div>
        <div className="fixture-feature"><div><span className="match-kicker">{text(site.nextMatch.labelTemplate, { league: team.league })}</span><p className="fixture-date">{site.nextMatch.date} <small>{site.nextMatch.month}</small> {seasonYear} <b>{site.nextMatch.time}</b></p><div className="fixture-teams"><strong>{team.shortName.toUpperCase()} <small>{site.nextMatch.opponentSuffix}</small></strong><span>{site.nextMatch.versus}</span><strong>{site.nextMatch.opponent.toUpperCase()} <small>{site.nextMatch.opponentSuffix}</small></strong></div><p className="fixture-venue">{team.stadium} · {site.nextMatch.venueSuffix}</p></div><div className="fixture-badge"><span>{site.nextMatch.formLabel}</span><div>{recentForm.slice(-5).map((item, index) => <b className={item === 'W' ? 'win' : item === 'L' ? 'loss' : 'no-result'} key={`${item}-${index}`}>{item}</b>)}</div><small>{site.nextMatch.lastMatchesLabel}</small></div></div>
        <div className="match-list">{filteredMatches.map((match) => { const scoreCardSource = seasonScoreCards.find((scoreCard) => scoreCard.matchNumber === match.id); return <article className={`match-card${scoreCardSource ? ' match-card--interactive' : ''}`} key={match.id} onClick={() => scoreCardSource && setSelectedScoreCard(parseScoreCard(scoreCardSource))} onKeyDown={(event) => { if (scoreCardSource && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedScoreCard(parseScoreCard(scoreCardSource)); } }} role={scoreCardSource ? 'button' : undefined} tabIndex={scoreCardSource ? 0 : undefined}><div className="match-meta"><span>{match.format} · {site.matchLabels.matchPrefix} {match.id}</span><span>{match.date}</span></div><div className="match-score"><span>{team.shortName.toUpperCase()}</span><strong>{match.teamScore}</strong></div><div className="match-score"><span>{match.opponent.toUpperCase()}</span><strong>{match.opponentScore}</strong></div><div className={`match-result ${match.result === 'WIN' ? 'match-result--win' : 'match-result--loss'}`}><b>{match.result === 'WIN' ? site.matchLabels.winShort : site.matchLabels.lossShort}</b> {match.result} {match.result === 'WIN' ? site.matchLabels.winBy : site.matchLabels.lossBy} {match.margin}</div>{scoreCardSource && <span className="scorecard-link">{site.scorecardLabels.view} <ArrowUpRight size={13} /></span>}</article>; })}</div>
      </section>

      <section className="squad section-cream" id="squad">
        <div className="page-width"><div className="section-heading"><div><SectionLabel>{site.sections.squad.label}</SectionLabel><h2>{site.sections.squad.titleBefore}<br /><em>{site.sections.squad.titleEmphasis}</em></h2></div><p className="section-aside">{text(site.sections.squad.description, { team: team.name })}</p></div><div className="player-grid">{players.map((player) => <button className={`player-card${player.leadership ? ` player-card--${player.leadership === 'CAPTAIN' ? 'captain' : 'vice-captain'}` : ''}`} key={player.id} onClick={() => setSelectedPlayer(player)}><div className={`player-photo${player.image ? '' : ' player-photo--empty'}`} style={player.image ? { backgroundImage: `url(${player.image})` } : undefined}>{!player.image && <strong>{initials(player.name)}</strong>}<span>#{String(player.number).padStart(2, '0')}</span><i><ArrowUpRight size={17} /></i></div><div className="player-info"><div><h3>{player.name}</h3><span>{player.role}</span></div><strong className={player.leadership ? `player-leadership player-leadership--${player.leadership === 'CAPTAIN' ? 'captain' : 'vice'}` : undefined}>{player.leadership ?? player.shortRole}</strong></div><div className="player-stat"><span>BAT <b>{player.battingRuns.toLocaleString()}</b></span><span>BOWL <b>{player.bowlingWickets}</b></span><span>FIELD <b>{player.fieldingDismissals}</b></span></div></button>)}</div></div>
      </section>

      <section className="story page-width" id="history"><div className="story-image" style={{ '--ground-image': `url(${groundImage})` } as React.CSSProperties}><div className="story-caption">{team.stadium}<br /><span>EST. {team.founded} · NORTH STAND</span></div></div><div className="story-copy"><SectionLabel>{site.sections.history.label}</SectionLabel><h2>{site.sections.history.titleBefore}<br /><em>{site.sections.history.titleEmphasis}</em></h2><p>{site.sections.history.description}</p><a className="text-link" href="#records">{site.actions.recordBook} <ArrowUpRight size={16} /></a><div className="timeline-mini">{history.slice(0, 3).map((event) => <div key={event.year}><b>{event.year}</b><span>{event.title}</span></div>)}</div></div></section>

      <section className="records section-dark" id="records"><div className="page-width"><SectionLabel>{site.sections.records.label}</SectionLabel><div className="records-layout"><div><h2>{site.sections.records.titleBefore}<br /><em>{site.sections.records.titleEmphasis}</em></h2><p>{site.sections.records.description}</p></div><div className="record-list">{seasonRecords.map((record) => <div key={record.label}><span>{record.label}</span><b>{record.value} <small>{record.detail}</small></b></div>)}</div></div></div></section>

      <footer className="site-footer"><div className="page-width"><div className="footer-brand"><img className="brand-mark" src={site.assets.logoImage} alt={`${team.name} logo`} /><div><strong>{team.name.toUpperCase()}</strong><p>{site.footer.tagline}</p></div></div><div className="footer-bottom"><span>{site.footer.copyrightPrefix} {seasonLabel} {team.name}</span><span>{site.actions.madeForMoments} <ArrowUpRight size={14} /></span></div></div></footer>
  <footer className="site-footer"><div className="page-width"><div className="footer-brand"><img className="brand-mark" src={assetPath(site.assets.logoImage)} alt={`${team.name} logo`} /><div><strong>{team.name.toUpperCase()}</strong><p>{site.footer.tagline}</p></div></div><div className="footer-bottom"><span>{site.footer.copyrightPrefix} {seasonLabel} {team.name}</span><span>{site.actions.madeForMoments} <ArrowUpRight size={14} /></span></div></div></footer>

      {selectedPlayer && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedPlayer(null)}><div className="player-modal" role="dialog" aria-modal="true" aria-labelledby="player-name" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedPlayer(null)} aria-label={site.accessibility.closeProfile}><X size={19} /></button><div className={`modal-photo${selectedPlayer.image ? '' : ' modal-photo--empty'}`} style={selectedPlayer.image ? { backgroundImage: `url(${selectedPlayer.image})` } : undefined}>{!selectedPlayer.image && <strong>{initials(selectedPlayer.name)}</strong>}</div><div className="modal-content"><span className="modal-number">#{String(selectedPlayer.number).padStart(2, '0')}</span><p className="section-label"><span />{site.playerLabels.profile}</p><h2 id="player-name">{selectedPlayer.name}</h2><p className="modal-role">{selectedPlayer.role} · {selectedPlayer.detail}</p><div className="modal-stats"><StatBlock value={selectedPlayer.battingRuns.toLocaleString()} label="Batting runs" accent /><StatBlock value={statValue(selectedPlayer.battingAverage)} label="Batting average" /><StatBlock value={statValue(selectedPlayer.battingStrikeRate)} label="Strike rate" /></div><div className="modal-detail-sections"><section><h3>Batting</h3><div className="modal-detail-grid"><StatBlock value={statValue(selectedPlayer.battingHighestScore)} label="Highest score" /><StatBlock value={statValue(selectedPlayer.battingFours)} label="Fours" /><StatBlock value={statValue(selectedPlayer.battingSixes)} label="Sixes" /></div></section><section><h3>Bowling</h3><div className="modal-detail-grid"><StatBlock value={selectedPlayer.bowlingWickets.toString()} label="Wickets" /><StatBlock value={statValue(selectedPlayer.bowlingEconomy)} label="Economy" /><StatBlock value={statValue(selectedPlayer.bowlingAverage)} label="Average" /><StatBlock value={statValue(selectedPlayer.bowlingStrikeRate)} label="Strike rate" /><StatBlock value={statValue(selectedPlayer.bowlingBestWickets)} label="Best wickets" /></div></section><section><h3>Fielding</h3><div className="modal-detail-grid"><StatBlock value={selectedPlayer.fieldingDismissals.toString()} label="Dismissals" /><StatBlock value={statValue(selectedPlayer.fieldingCatches)} label="Catches" /><StatBlock value={statValue(selectedPlayer.fieldingRunOuts)} label="Run outs" /><StatBlock value={statValue(selectedPlayer.fieldingStumpings)} label="Stumpings" /></div></section></div></div></div></div>}
      {selectedScoreCard && <ScorecardModal scoreCard={selectedScoreCard} onClose={() => setSelectedScoreCard(null)} />}
    </main>
  );
}

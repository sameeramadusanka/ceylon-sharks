// Build-time data for the admin panel's Player of the Week form. Only import
// this from .astro frontmatter (it reads the repo with node:fs). It turns the
// season scorecards + squad files into a small list of matches, each with the
// club's players and their batting/bowling/fielding figures, so the form can
// prefill everything without calling any backend.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import team from '../data/team.json';
import { emptyStats, type PotwStats } from './playerOfTheWeekFigures';

export interface AdminPotwPlayer {
  id: number;
  name: string;
  /** Figures from the scorecard; zeros/empty when the player didn't bat, bowl or field. */
  stats: PotwStats;
}

export interface AdminPotwMatch {
  /** Season folder, e.g. 2026_SEPTEMBER_SUPREME_DIVISION. */
  season: string;
  date: string;
  opponent: string;
  /** Club players who appear in the scorecard first, then the rest of the squad. */
  players: AdminPotwPlayer[];
}

export interface AdminPotwSquad {
  season: string;
  players: { id: number; name: string }[];
}

export interface AdminPotwData {
  matches: AdminPotwMatch[];
  /** Every season with a squad file, newest first - for entering a winner manually (e.g. before the scorecard is added). */
  squads: AdminPotwSquad[];
  /** Dates (per season) that already have a winner: `${season}/${date}`. */
  existing: string[];
  defaultCompetition: string;
}

type Dismissal = { type?: string | null; fielder?: string | null; bowler?: string | null } | null;
type Batter = { player: string; dismissal?: Dismissal; runs?: number; balls?: number };
type Bowler = { player: string; overs?: string | number; maidens?: number; runs?: number; wickets?: number };
type Innings = { team: string; batting?: Batter[]; bowling?: Bowler[] };
type ScoreCard = { match?: { date?: string; teams?: { home?: { name?: string }; away?: { name?: string } } }; innings?: Innings[] };
type SquadFile = { season?: { players?: { id: number; name: string }[] } };

const scoreCardPattern = /__MATCH-\d+__(\d{4}-\d{2}-\d{2})\.json$/;
const squadPattern = /__PLAYERS__\d{4}\.json$/;
const potwDetailsPattern = /^(\d{4}-\d{2}-\d{2})__\d+\.json$/;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const sameName = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** Sort key for season folders like 2026_SEPTEMBER_SUPREME_DIVISION: year, then month. */
function seasonOrder(season: string): number {
  const [year, ...rest] = season.split('_');
  const month = MONTHS.findIndex((name) => rest.includes(name));
  return Number(year) * 100 + (month + 1);
}

function playerStats(ours: Innings[], theirs: Innings[], name: string): PotwStats {
  const stats = emptyStats();

  for (const inn of ours) {
    const batter = inn.batting?.find((entry) => sameName(entry.player, name));
    if (!batter) continue;
    const type = batter.dismissal?.type ?? null;
    const balls = Number(batter.balls ?? 0);
    if ((type !== null && type !== 'NOT_OUT') || balls > 0) {
      stats.runs = text(batter.runs ?? 0);
      stats.balls = text(balls);
      stats.notOut = type === 'NOT_OUT' || type === null;
    }
    break;
  }

  for (const inn of theirs) {
    const bowler = inn.bowling?.find((entry) => sameName(entry.player, name));
    if (bowler && Number.parseFloat(String(bowler.overs ?? 0)) > 0) {
      stats.overs = text(bowler.overs);
      stats.maidens = bowler.maidens ? text(bowler.maidens) : '';
      stats.runsConceded = text(bowler.runs ?? 0);
      stats.wickets = text(bowler.wickets ?? 0);
      break;
    }
  }

  let catches = 0;
  let runOuts = 0;
  let stumpings = 0;
  for (const inn of theirs) {
    for (const batter of inn.batting ?? []) {
      const dismissal = batter.dismissal;
      if (!dismissal) continue;
      if (dismissal.type === 'CAUGHT' && sameName(dismissal.fielder, name)) catches++;
      else if (dismissal.type === 'STUMPED' && sameName(dismissal.fielder, name)) stumpings++;
      // Run-outs sometimes record the fielder in the "bowler" slot.
      else if (dismissal.type === 'RUN_OUT' && (sameName(dismissal.fielder, name) || sameName(dismissal.bowler, name))) runOuts++;
    }
  }
  // Scorecards don't say who kept wicket, so catches all count as fielding; stumpings can only be the keeper's.
  if (catches) stats.catches = text(catches);
  if (runOuts) stats.runOuts = text(runOuts);
  if (stumpings) stats.stumpings = text(stumpings);
  return stats;
}

export function loadPlayerOfTheWeekAdminData(root = process.cwd()): AdminPotwData {
  const scoreCardRoot = join(root, 'public/score_cards');
  const playersRoot = join(root, 'public/players');
  const potwRoot = join(root, 'src/assets/player_of_the_week');
  const clubName = team.name;
  const matches: AdminPotwMatch[] = [];
  const squads: AdminPotwSquad[] = [];

  // Seasons come from the squad folders: the publish backend requires the squad file, and a new season may have no scorecards yet.
  const seasons = existsSync(playersRoot) ? readdirSync(playersRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
  for (const season of seasons) {
    const squadDir = join(playersRoot, season);
    const squadFile = existsSync(squadDir) ? readdirSync(squadDir).find((name) => squadPattern.test(name)) : undefined;
    if (!squadFile) continue;
    const squad = readJson<SquadFile>(join(squadDir, squadFile)).season?.players ?? [];
    squads.push({ season, players: squad.map((player) => ({ id: player.id, name: player.name })) });

    const cardDir = join(scoreCardRoot, season);
    for (const file of existsSync(cardDir) ? readdirSync(cardDir) : []) {
      const dateMatch = scoreCardPattern.exec(file);
      if (!dateMatch) continue;
      const card = readJson<ScoreCard>(join(scoreCardRoot, season, file));
      const innings = card.innings ?? [];
      const ours = innings.filter((inn) => sameName(inn.team, clubName));
      const theirs = innings.filter((inn) => !sameName(inn.team, clubName));
      const teams = [card.match?.teams?.home?.name, card.match?.teams?.away?.name];
      const opponent = teams.find((name) => name && !sameName(name, clubName)) ?? theirs[0]?.team ?? 'Unknown';

      const players = squad.map((player) => ({ id: player.id, name: player.name, stats: playerStats(ours, theirs, player.name) }));
      const playedNames = new Set(
        [...ours.flatMap((inn) => (inn.batting ?? []).map((b) => b.player)), ...theirs.flatMap((inn) => (inn.bowling ?? []).map((b) => b.player))].map((name) => name.trim().toLowerCase()),
      );
      const played = players.filter((player) => playedNames.has(player.name.toLowerCase()));
      const rest = players.filter((player) => !playedNames.has(player.name.toLowerCase()));

      matches.push({ season, date: card.match?.date ?? dateMatch[1], opponent, players: [...played, ...rest] });
    }
  }
  matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const existing: string[] = [];
  let latestCompetition = { date: '', value: '' };
  if (existsSync(potwRoot)) {
    for (const season of readdirSync(potwRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      for (const file of readdirSync(join(potwRoot, season))) {
        const detailMatch = potwDetailsPattern.exec(file);
        if (!detailMatch) continue;
        existing.push(`${season}/${detailMatch[1]}`);
        const details = readJson<{ competition?: string }>(join(potwRoot, season, file));
        if (details.competition && detailMatch[1] > latestCompetition.date) latestCompetition = { date: detailMatch[1], value: details.competition };
      }
    }
  }

  squads.sort((a, b) => seasonOrder(b.season) - seasonOrder(a.season));

  return { matches, squads, existing, defaultCompetition: latestCompetition.value };
}

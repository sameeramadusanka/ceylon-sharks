// Build-time data for the admin panel's Player of the Week form. Only import
// this from .astro frontmatter (it reads the repo with node:fs). It turns the
// season scorecards + squad files into a small list of matches, each with the
// club's players and their batting/bowling/fielding figures, so the form can
// prefill everything without calling any backend.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import team from '../data/team.json';

export interface AdminPotwPlayer {
  id: number;
  name: string;
  batting: string;
  bowling: string;
  fielding: string;
}

export interface AdminPotwMatch {
  /** Season folder, e.g. 2026_SEPTEMBER_SUPREME_DIVISION. */
  season: string;
  date: string;
  opponent: string;
  /** Club players who appear in the scorecard first, then the rest of the squad. */
  players: AdminPotwPlayer[];
}

export interface AdminPotwData {
  matches: AdminPotwMatch[];
  /** Dates (per season) that already have a winner: `${season}/${date}`. */
  existing: string[];
  defaultCompetition: string;
}

type Dismissal = { type?: string | null; fielder?: string | null; bowler?: string | null } | null;
type Batter = { player: string; dismissal?: Dismissal; runs?: number; balls?: number };
type Bowler = { player: string; overs?: string | number; runs?: number; wickets?: number };
type Innings = { team: string; batting?: Batter[]; bowling?: Bowler[] };
type ScoreCard = { match?: { date?: string; teams?: { home?: { name?: string }; away?: { name?: string } } }; innings?: Innings[] };
type SquadFile = { season?: { players?: { id: number; name: string }[] } };

const scoreCardPattern = /__MATCH-\d+__(\d{4}-\d{2}-\d{2})\.json$/;
const squadPattern = /__PLAYERS__\d{4}\.json$/;
const potwDetailsPattern = /^(\d{4}-\d{2}-\d{2})__\d+\.json$/;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const sameName = (a?: string | null, b?: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

function battingFigure(innings: Innings[], name: string): string {
  for (const inn of innings) {
    const batter = inn.batting?.find((entry) => sameName(entry.player, name));
    if (!batter) continue;
    const type = batter.dismissal?.type ?? null;
    const balls = Number(batter.balls ?? 0);
    const batted = (type !== null && type !== 'NOT_OUT') || balls > 0;
    if (!batted) return '';
    return `${batter.runs ?? 0}${type === 'NOT_OUT' || type === null ? '*' : ''} (${balls})`;
  }
  return '';
}

function bowlingFigure(innings: Innings[], name: string): string {
  for (const inn of innings) {
    const bowler = inn.bowling?.find((entry) => sameName(entry.player, name));
    if (bowler && Number.parseFloat(String(bowler.overs ?? 0)) > 0) return `${bowler.wickets ?? 0}/${bowler.runs ?? 0} (${bowler.overs})`;
  }
  return '';
}

function fieldingFigure(opponentInnings: Innings[], name: string): string {
  let catches = 0;
  let stumpings = 0;
  let runOuts = 0;
  for (const inn of opponentInnings) {
    for (const batter of inn.batting ?? []) {
      const dismissal = batter.dismissal;
      if (!dismissal) continue;
      if (dismissal.type === 'CAUGHT' && sameName(dismissal.fielder, name)) catches++;
      else if (dismissal.type === 'STUMPED' && sameName(dismissal.fielder, name)) stumpings++;
      // Run-outs sometimes record the fielder in the "bowler" slot.
      else if (dismissal.type === 'RUN_OUT' && (sameName(dismissal.fielder, name) || sameName(dismissal.bowler, name))) runOuts++;
    }
  }
  const parts = [];
  if (catches) parts.push(`${catches} ${catches === 1 ? 'catch' : 'catches'}`);
  if (stumpings) parts.push(`${stumpings} ${stumpings === 1 ? 'stumping' : 'stumpings'}`);
  if (runOuts) parts.push(`${runOuts} ${runOuts === 1 ? 'run out' : 'run outs'}`);
  return parts.join(', ');
}

export function loadPlayerOfTheWeekAdminData(root = process.cwd()): AdminPotwData {
  const scoreCardRoot = join(root, 'public/score_cards');
  const playersRoot = join(root, 'public/players');
  const potwRoot = join(root, 'src/assets/player_of_the_week');
  const clubName = team.name;
  const matches: AdminPotwMatch[] = [];

  const seasons = existsSync(scoreCardRoot) ? readdirSync(scoreCardRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
  for (const season of seasons) {
    const squadDir = join(playersRoot, season);
    const squadFile = existsSync(squadDir) ? readdirSync(squadDir).find((name) => squadPattern.test(name)) : undefined;
    if (!squadFile) continue; // The publish backend requires the squad file, so a season without one can't be published to.
    const squad = readJson<SquadFile>(join(squadDir, squadFile)).season?.players ?? [];

    for (const file of readdirSync(join(scoreCardRoot, season))) {
      const dateMatch = scoreCardPattern.exec(file);
      if (!dateMatch) continue;
      const card = readJson<ScoreCard>(join(scoreCardRoot, season, file));
      const innings = card.innings ?? [];
      const ours = innings.filter((inn) => sameName(inn.team, clubName));
      const theirs = innings.filter((inn) => !sameName(inn.team, clubName));
      const teams = [card.match?.teams?.home?.name, card.match?.teams?.away?.name];
      const opponent = teams.find((name) => name && !sameName(name, clubName)) ?? theirs[0]?.team ?? 'Unknown';

      const players = squad.map((player) => ({
        id: player.id,
        name: player.name,
        batting: battingFigure(ours, player.name),
        bowling: bowlingFigure(theirs, player.name),
        fielding: fieldingFigure(theirs, player.name),
      }));
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

  return { matches, existing, defaultCompetition: latestCompetition.value };
}

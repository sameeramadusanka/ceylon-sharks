// Player of the Week figures as separate numbers (what the admin form edits)
// and the short text the site shows, e.g. "45* (32)" or "3/12 (3)".
// Browser-safe: used by the admin form and the build-time scorecard loader.

export interface PotwStats {
  // Batting
  runs: string;
  balls: string;
  notOut: boolean;
  // Bowling
  overs: string;
  maidens: string;
  runsConceded: string;
  wickets: string;
  // Fielding
  catches: string;
  runOuts: string;
  // Wicket keeping
  keeperCatches: string;
  stumpings: string;
}

export type PotwStatGroup = 'batting' | 'bowling' | 'fielding' | 'wicketKeeping';

export function emptyStats(): PotwStats {
  return { runs: '', balls: '', notOut: false, overs: '', maidens: '', runsConceded: '', wickets: '', catches: '', runOuts: '', keeperCatches: '', stumpings: '' };
}

const count = (value: string) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const has = (value: string) => value.trim() !== '';
const counted = (value: string, singular: string, pluralForm: string) => {
  const number = count(value);
  return number ? `${number} ${number === 1 ? singular : pluralForm}` : '';
};

export function battingFigure(stats: PotwStats): string {
  if (!has(stats.runs)) return '';
  return `${stats.runs.trim()}${stats.notOut ? '*' : ''}${has(stats.balls) ? ` (${stats.balls.trim()})` : ''}`;
}

export function bowlingFigure(stats: PotwStats): string {
  if (!has(stats.wickets) && !has(stats.runsConceded)) return '';
  const extras = [has(stats.overs) ? stats.overs.trim() : '', counted(stats.maidens, 'maiden', 'maidens')].filter(Boolean);
  return `${stats.wickets.trim() || '0'}/${stats.runsConceded.trim() || '0'}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

export function fieldingFigure(stats: PotwStats): string {
  return [counted(stats.catches, 'catch', 'catches'), counted(stats.runOuts, 'run out', 'run outs')].filter(Boolean).join(', ');
}

export function wicketKeepingFigure(stats: PotwStats): string {
  return [counted(stats.keeperCatches, 'catch', 'catches'), counted(stats.stumpings, 'stumping', 'stumpings')].filter(Boolean).join(', ');
}

export const FIGURE_FORMATTERS: Record<PotwStatGroup, (stats: PotwStats) => string> = {
  batting: battingFigure,
  bowling: bowlingFigure,
  fielding: fieldingFigure,
  wicketKeeping: wicketKeepingFigure,
};

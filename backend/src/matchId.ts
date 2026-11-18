import { createHash } from 'node:crypto';

/**
 * The published match data has no native match ID (see
 * backend/docs/existing-match-data-mapping.md). This derives a stable,
 * deterministic ID from the fields that uniquely identify a fixture in
 * the schedule feed. It must stay deterministic across coordinator runs
 * so the same fixture always maps to the same ScheduledActions/
 * MatchAvailability keys.
 */
export function computeMatchId(seasonId: string, matchDate: string, teamOne: string, teamTwo: string): string {
  const key = `${seasonId}|${matchDate}|${teamOne}|${teamTwo}`;
  return createHash('sha256').update(key).digest('hex');
}

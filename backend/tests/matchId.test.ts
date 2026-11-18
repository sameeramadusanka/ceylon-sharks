import { describe, expect, it } from 'vitest';
import { computeMatchId } from '../src/matchId.js';

describe('computeMatchId', () => {
  it('is deterministic for the same inputs', () => {
    const first = computeMatchId('2026_SEPTEMBER_SUPREME_DIVISION', '2026-11-28', 'Ceylon Sharks', 'Cool Stars');
    const second = computeMatchId('2026_SEPTEMBER_SUPREME_DIVISION', '2026-11-28', 'Ceylon Sharks', 'Cool Stars');
    expect(first).toBe(second);
  });

  it('changes when the date changes (a reschedule produces a different ID)', () => {
    const original = computeMatchId('2026_SEPTEMBER_SUPREME_DIVISION', '2026-11-28', 'Ceylon Sharks', 'Cool Stars');
    const rescheduled = computeMatchId('2026_SEPTEMBER_SUPREME_DIVISION', '2026-12-05', 'Ceylon Sharks', 'Cool Stars');
    expect(rescheduled).not.toBe(original);
  });

  it('changes when either team changes', () => {
    const a = computeMatchId('2026_SEPTEMBER_SUPREME_DIVISION', '2026-11-28', 'Ceylon Sharks', 'Cool Stars');
    const b = computeMatchId('2026_SEPTEMBER_SUPREME_DIVISION', '2026-11-28', 'Ceylon Sharks', 'Gillies');
    expect(a).not.toBe(b);
  });
});

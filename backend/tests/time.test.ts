import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { calendarDaysUntil, closureDeadline, localHour } from '../src/time.js';

const SGT = 'Asia/Singapore';

describe('calendarDaysUntil', () => {
  it('returns 0 on the match day itself', () => {
    const now = DateTime.fromISO('2026-11-28T10:00:00', { zone: SGT });
    expect(calendarDaysUntil('2026-11-28', SGT, now)).toBe(0);
  });

  it('returns 5 exactly five calendar days before', () => {
    const now = DateTime.fromISO('2026-11-23T09:00:00', { zone: SGT });
    expect(calendarDaysUntil('2026-11-28', SGT, now)).toBe(5);
  });

  it('counts a calendar day correctly just after local midnight, not by elapsed hours', () => {
    // 2026-11-23 23:58 SGT is still "5 days before" the instant it flips past midnight it becomes 4.
    const beforeMidnight = DateTime.fromISO('2026-11-23T23:58:00', { zone: SGT });
    const afterMidnight = DateTime.fromISO('2026-11-24T00:02:00', { zone: SGT });
    expect(calendarDaysUntil('2026-11-28', SGT, beforeMidnight)).toBe(5);
    expect(calendarDaysUntil('2026-11-28', SGT, afterMidnight)).toBe(4);
  });

  it('is negative once the match date has passed', () => {
    const now = DateTime.fromISO('2026-11-29T00:00:00', { zone: SGT });
    expect(calendarDaysUntil('2026-11-28', SGT, now)).toBe(-1);
  });
});

describe('closureDeadline', () => {
  it('computes the local closure instant N days before the match', () => {
    const deadline = closureDeadline('2026-11-28', SGT, 2, '23:59');
    expect(deadline.toISO()).toBe(DateTime.fromISO('2026-11-26T23:59:00', { zone: SGT }).toISO());
  });

  it('throws on a malformed closureLocalTime', () => {
    expect(() => closureDeadline('2026-11-28', SGT, 2, 'not-a-time')).toThrow();
  });
});

describe('localHour', () => {
  it('reads the hour on the club clock, not UTC', () => {
    expect(localHour('Asia/Singapore', DateTime.fromISO('2026-11-28T00:30:00Z'))).toBe(8);
  });
});

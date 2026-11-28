import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { matchStart, planManualInvitation } from '../src/manualInvitation.js';

const CONFIG = { timeZone: 'Asia/Singapore', invitationDaysBefore: 5, closureDaysBefore: 2, closureLocalTime: '23:59' };
const at = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Singapore' });
const plan = (matchDate: string, time: string, now: string) => planManualInvitation({ matchDate, time }, CONFIG, at(now));
const closes = (result: ReturnType<typeof plan>) => (result.sendable ? result.closesAt.toISO() : null);

describe('planManualInvitation', () => {
  it('is not offered for a played match or one the daily job will still send', () => {
    expect(plan('2026-11-27', '9:45 AM', '2026-11-28T10:00')).toEqual({ sendable: false, reason: 'past' });
    expect(plan('2026-12-05', '9:45 AM', '2026-11-28T10:00')).toEqual({ sendable: false, reason: 'automatic', automaticDate: '2026-11-30' });
  });

  it('keeps the normal deadline while it is still ahead (3-5 days out)', () => {
    const result = plan('2026-12-01', '9:45 AM', '2026-11-28T10:00');
    expect(result).toMatchObject({ sendable: true, customClosing: false });
    expect(closes(result)).toBe('2026-11-29T23:59:00.000+08:00');
  });

  it('closes the night before when the normal deadline has gone', () => {
    for (const now of ['2026-11-28T10:00', '2026-11-29T22:00']) {
      const result = plan('2026-11-30', '9:45 AM', now);
      expect(result).toMatchObject({ sendable: true, customClosing: true });
      expect(closes(result)).toBe('2026-11-29T23:59:00.000+08:00');
    }
  });

  it('on match day (or late the night before) closes two hours before the start', () => {
    expect(closes(plan('2026-11-30', '2:15 PM', '2026-11-30T08:00'))).toBe('2026-11-30T12:15:00.000+08:00');
    expect(closes(plan('2026-11-30', '4:30 PM', '2026-11-29T23:30'))).toBe('2026-11-30T14:30:00.000+08:00');
  });

  it('refuses when players would have under 30 minutes', () => {
    expect(plan('2026-11-30', '9:45 AM', '2026-11-30T07:30')).toEqual({ sendable: false, reason: 'too-late' });
    expect(plan('2026-11-30', 'TBC', '2026-11-30T07:30')).toEqual({ sendable: false, reason: 'too-late' });
  });
});

describe('matchStart', () => {
  it('reads 12-hour times', () => {
    expect(matchStart('2026-11-30', '12:00 PM', 'Asia/Singapore')?.toISO()).toBe('2026-11-30T12:00:00.000+08:00');
    expect(matchStart('2026-11-30', '12:30 AM', 'Asia/Singapore')?.toISO()).toBe('2026-11-30T00:30:00.000+08:00');
    expect(matchStart('2026-11-30', '7:30 am', 'Asia/Singapore')?.hour).toBe(7);
  });
});

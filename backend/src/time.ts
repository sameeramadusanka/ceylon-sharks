import { DateTime } from 'luxon';

/**
 * Calendar-day difference between "now" and a match date, computed in the
 * given IANA timezone. Deliberately not `Math.floor((matchDate - now) / 86400000)`
 * per the plan doc — that breaks around midnight/DST because it measures
 * elapsed milliseconds, not calendar days.
 */
export function calendarDaysUntil(matchDate: string, timeZone: string, now: DateTime = DateTime.now()): number {
  const matchDay = DateTime.fromISO(matchDate, { zone: timeZone }).startOf('day');
  const today = now.setZone(timeZone).startOf('day');
  return Math.round(matchDay.diff(today, 'days').days);
}

/**
 * The instant at which availability submissions close for a match:
 * `closureLocalTime` local time, `closureDaysBefore` calendar days before
 * the match, in the given timezone.
 */
export function closureDeadline(matchDate: string, timeZone: string, closureDaysBefore: number, closureLocalTime: string): DateTime {
  const [hour, minute] = closureLocalTime.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid closureLocalTime, expected HH:MM: ${closureLocalTime}`);
  }
  return DateTime.fromISO(matchDate, { zone: timeZone })
    .startOf('day')
    .minus({ days: closureDaysBefore })
    .set({ hour, minute, second: 0, millisecond: 0 });
}

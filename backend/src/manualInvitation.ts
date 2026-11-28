import { DateTime } from 'luxon';
import type { AvailabilityConfig } from './config.js';
import { calendarDaysUntil, closureDeadline } from './time.js';

// "Send invitations now" from the admin Schedule tab: for a match added too
// late for the daily job (invitations go out 5 days before and are never sent
// once the 2-day closing deadline has passed). These rules decide whether a
// captain may send them by hand and when availability then closes.

/** A night-before closing time needs at least this long to be worth sending. */
const MIN_NIGHT_BEFORE_MS = 60 * 60 * 1000;
/** Same-day matches close this long before the start... */
const SAME_DAY_CLOSING_LEAD_MS = 2 * 60 * 60 * 1000;
/** ...and only if that still leaves players this long to answer. */
const MIN_SAME_DAY_MS = 30 * 60 * 1000;

export type ManualInvitationPlan =
  /** May send. customClosing is set when the normal deadline has gone and the match gets its own. */
  | { sendable: true; closesAt: DateTime; customClosing: boolean }
  | { sendable: false; reason: 'past' | 'automatic' | 'too-late'; automaticDate?: string };

type TimingConfig = Pick<AvailabilityConfig, 'timeZone' | 'invitationDaysBefore' | 'closureDaysBefore' | 'closureLocalTime'>;

/** "9:45 AM" on the match date, in the club's timezone; null when the time can't be read. */
export function matchStart(matchDate: string, time: string, timeZone: string): DateTime | null {
  const parsed = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!parsed) return null;
  const hour = (Number(parsed[1]) % 12) + (parsed[3].toUpperCase() === 'PM' ? 12 : 0);
  return DateTime.fromISO(matchDate, { zone: timeZone }).set({ hour, minute: Number(parsed[2]), second: 0, millisecond: 0 });
}

export function planManualInvitation(match: { matchDate: string; time: string }, config: TimingConfig, now: DateTime = DateTime.now()): ManualInvitationPlan {
  const days = calendarDaysUntil(match.matchDate, config.timeZone, now);
  if (days < 0) return { sendable: false, reason: 'past' };
  if (days > config.invitationDaysBefore) {
    const automaticDate = DateTime.fromISO(match.matchDate, { zone: config.timeZone }).minus({ days: config.invitationDaysBefore }).toISODate() ?? undefined;
    return { sendable: false, reason: 'automatic', automaticDate };
  }

  // Still ahead of the normal deadline: the usual closing time, reminder and summary all apply.
  if (days > config.closureDaysBefore) {
    return { sendable: true, closesAt: closureDeadline(match.matchDate, config.timeZone, config.closureDaysBefore, config.closureLocalTime), customClosing: false };
  }

  // Too late for the normal deadline: close the night before the match...
  const nightBefore = closureDeadline(match.matchDate, config.timeZone, 1, config.closureLocalTime);
  if (nightBefore.toMillis() - now.toMillis() >= MIN_NIGHT_BEFORE_MS) return { sendable: true, closesAt: nightBefore, customClosing: true };

  // ...or, on the day itself, two hours before the start.
  const start = matchStart(match.matchDate, match.time, config.timeZone);
  if (start) {
    const beforeStart = start.minus({ milliseconds: SAME_DAY_CLOSING_LEAD_MS });
    if (beforeStart.toMillis() - now.toMillis() >= MIN_SAME_DAY_MS) return { sendable: true, closesAt: beforeStart, customClosing: true };
  }
  return { sendable: false, reason: 'too-late' };
}

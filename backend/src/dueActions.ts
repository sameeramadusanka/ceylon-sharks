import type { ActionType } from './repositories/scheduledActionsRepository.js';

export interface DueActionsInput {
  daysUntilMatch: number;
  invitationClaimed: boolean;
  reminderClaimed: boolean;
  closureClaimed: boolean;
  invitationDaysBefore: number;
  reminderDaysBefore: number;
  closureDaysBefore: number;
}

export interface DueAction {
  actionType: ActionType;
  /** True when this is a catch-up for a run the scheduler missed, not the on-time trigger day. */
  late: boolean;
}

/**
 * Pure decision function for which actions are due for a single match
 * right now, including the catch-up rules from the plan doc's "Late
 * discovery and missed runs" section:
 *  - A missed invitation is sent late as soon as it's noticed, but only
 *    while the deadline hasn't passed yet.
 *  - A reminder is never sent before the invitation, and never catches up
 *    late - only on its exact trigger day, and only once invited.
 *  - A missed closure is run late (summary still useful after the fact)
 *    as long as the invitation was actually sent and the match hasn't
 *    already happened.
 *  - Nothing is due once the match date itself has passed.
 */
export function determineDueActions(input: DueActionsInput): DueAction[] {
  const { daysUntilMatch, invitationClaimed, reminderClaimed, closureClaimed, invitationDaysBefore, reminderDaysBefore, closureDaysBefore } = input;

  if (daysUntilMatch < 0) return [];

  const due: DueAction[] = [];

  if (!invitationClaimed) {
    if (daysUntilMatch === invitationDaysBefore) {
      due.push({ actionType: 'INVITATION', late: false });
    } else if (daysUntilMatch < invitationDaysBefore && daysUntilMatch > closureDaysBefore) {
      due.push({ actionType: 'INVITATION', late: true });
    }
  }

  if (invitationClaimed && !reminderClaimed && daysUntilMatch === reminderDaysBefore) {
    due.push({ actionType: 'REMINDER', late: false });
  }

  if (invitationClaimed && !closureClaimed) {
    if (daysUntilMatch === closureDaysBefore) {
      due.push({ actionType: 'CLOSURE', late: false });
    } else if (daysUntilMatch < closureDaysBefore) {
      due.push({ actionType: 'CLOSURE', late: true });
    }
  }

  return due;
}

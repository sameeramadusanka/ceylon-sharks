import { describe, expect, it } from 'vitest';
import { determineDueActions, type DueActionsInput } from '../src/dueActions.js';

const BASE: DueActionsInput = {
  daysUntilMatch: 5,
  invitationClaimed: false,
  reminderClaimed: false,
  closureClaimed: false,
  invitationDaysBefore: 5,
  reminderDaysBefore: 3,
  closureDaysBefore: 2,
};

describe('determineDueActions', () => {
  it('fires the invitation on the exact invitation day', () => {
    const due = determineDueActions(BASE);
    expect(due).toEqual([{ actionType: 'INVITATION', late: false }]);
  });

  it('does not re-fire the invitation once claimed', () => {
    const due = determineDueActions({ ...BASE, invitationClaimed: true });
    expect(due).toEqual([]);
  });

  it('catches up a missed invitation while still before the deadline', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 4 });
    expect(due).toEqual([{ actionType: 'INVITATION', late: true }]);
  });

  it('does not catch up an invitation once the deadline has passed', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 1 });
    expect(due).toEqual([]);
  });

  it('fires the reminder on the exact reminder day when invited', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 3, invitationClaimed: true });
    expect(due).toEqual([{ actionType: 'REMINDER', late: false }]);
  });

  it('never sends a reminder before the invitation, even on the reminder day', () => {
    // Invitation is also overdue here (day 3 < invitationDaysBefore 5), so it catches up late -
    // but REMINDER must never appear since the invitation was never sent.
    const due = determineDueActions({ ...BASE, daysUntilMatch: 3, invitationClaimed: false });
    expect(due).not.toContainEqual(expect.objectContaining({ actionType: 'REMINDER' }));
  });

  it('never catches up a missed reminder late', () => {
    // Reminder day (3) was missed; we're now on day 2 past invitation but reminder has no catch-up.
    const due = determineDueActions({ ...BASE, daysUntilMatch: 2, invitationClaimed: true, reminderClaimed: false });
    expect(due).toContainEqual({ actionType: 'CLOSURE', late: false });
    expect(due).not.toContainEqual(expect.objectContaining({ actionType: 'REMINDER' }));
  });

  it('fires closure on the exact closure day when invited', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 2, invitationClaimed: true });
    expect(due).toEqual([{ actionType: 'CLOSURE', late: false }]);
  });

  it('does not close without ever having invited', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 2, invitationClaimed: false });
    expect(due).toEqual([]);
  });

  it('catches up a missed closure after the closure day, as long as invited and match not yet played', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 1, invitationClaimed: true, closureClaimed: false });
    expect(due).toEqual([{ actionType: 'CLOSURE', late: true }]);
  });

  it('does not duplicate a closure that already completed', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: 1, invitationClaimed: true, closureClaimed: true });
    expect(due).toEqual([]);
  });

  it('does nothing once the match date itself has passed', () => {
    const due = determineDueActions({ ...BASE, daysUntilMatch: -1, invitationClaimed: false });
    expect(due).toEqual([]);
  });

  it('can return both a late invitation and a late closure catch-up together is impossible by construction (closure requires invitationClaimed)', () => {
    // Invitation catch-up only applies while daysUntilMatch > closureDaysBefore, and closure catch-up
    // only applies once invitationClaimed is true, so the two late paths never overlap for one match.
    const due = determineDueActions({ ...BASE, daysUntilMatch: 4, invitationClaimed: false });
    expect(due).toEqual([{ actionType: 'INVITATION', late: true }]);
  });

  it('closes a hand-sent invitation at its own closing time, not by days', () => {
    const handSent = { ...BASE, daysUntilMatch: 1, invitationClaimed: true };
    expect(determineDueActions({ ...handSent, customClosing: { passed: false } })).toEqual([]);
    expect(determineDueActions({ ...handSent, customClosing: { passed: true } })).toEqual([{ actionType: 'CLOSURE', late: false }]);
    expect(determineDueActions({ ...handSent, closureClaimed: true, customClosing: { passed: true } })).toEqual([]);
  });
});

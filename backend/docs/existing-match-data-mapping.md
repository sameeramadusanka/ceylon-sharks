# Existing match data mapping

Phase 0 discovery deliverable for the Ceylon Sharks availability backend.
Promoted verbatim from the decisions recorded in `ceylon-sharks-availability-mvp.md`
section 5 and the Phase 0 checklist.

## Source files

- **Upcoming fixtures**: `public/upcoming_schedules/{SEASON}__SCHEDULE__{YEAR}.json`
  — shape `{ "season": {...}, "matches": [...] }`.
- **Completed matches**: `public/season_results/{SEASON}__RESULTS__{YEAR}.json`
  — free-text `result` string, no structured status.

## Fixture fields (`upcoming_schedules`)

```text
series, division, matchType, date (YYYY-MM-DD, Singapore local date),
time ("7:30 AM" / "12:00 PM" free-text, 12-hour with AM/PM),
teamOne, teamTwo, ground, umpireOne..Four, matchManager, scorer1, scorer2,
status, result
```

Only `status: "Scheduled"` has been observed in the current data; `result`
is `null` until the match is played and the fixture moves into the
`season_results` file instead, where `result` becomes a free-text string
(e.g. `"Ceylon Sharks won by 14 Runs"`, `"Abandoned."`).

## Match ID

**There is no native match ID anywhere in the published data.** Decision:
derive a synthetic, deterministic ID:

```text
matchId = sha256(`${seasonId}|${matchDate}|${teamOne}|${teamTwo}`)
```

Computed identically on every coordinator run so the same fixture always
maps to the same ID (required for the idempotency guarantees in the
`ScheduledActions` table). A fixture date change produces a different
derived ID — handled as a reschedule-detection case (match on season +
teams, carry forward `invitationSentAt`/`reminderSentAt` state), not a
new fixture.

## Status/result mapping

Source `status`/`result` values map onto the internal
`UPCOMING | COMPLETED | CANCELLED | POSTPONED` enum. Only `"Scheduled"`
has been observed so far; anything unrecognised must fail safe (treated
as non-upcoming, so no invitations are sent for it) rather than being
assumed to mean upcoming.

## Fetch source

Raw GitHub content, not the published site, since the repository is
confirmed public:

```text
https://raw.githubusercontent.com/sameeramadusanka/ceylon-sharks/main/public/upcoming_schedules/<file>.json
```

No GitHub token/secret is required. Always read from `main` so the
backend sees the same data the live site was built from.

## Competition field

The source data has no single `competition` field. `matchType`, `series`,
and `division` are the closest equivalents and should be mapped onto the
internal model's `competition` field (e.g. `matchType`, or
`series`/`division` if a more specific label is wanted later).

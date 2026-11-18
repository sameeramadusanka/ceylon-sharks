# Ceylon Sharks Availability Backend

Independent Node.js/TypeScript backend for the match-availability MVP
described in `../ceylon-sharks-availability-mvp.md`. Deployed separately
to AWS via AWS SAM (`../infrastructure/`); the GitHub Pages frontend
build never depends on this project.

See `docs/existing-match-data-mapping.md` for how the real match data in
this repository maps onto the backend's internal model, and the Phase 0
section of the plan doc for the decisions behind it.

## Local development

```bash
npm install        # install dependencies
npm run build       # compile TypeScript to dist/
npm run typecheck   # tsc --noEmit
npm run lint         # eslint src tests
npm test             # vitest run
```

There is no `.env` file — Lambda environment variables are supplied by
`infrastructure/template.yaml` at deploy time. For running a handler
locally (e.g. with `vitest` or a manual script), set the required
environment variables yourself; `src/config.ts` lists them and throws a
clear error naming whichever one is missing.

## Deploying

Requires the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
and AWS credentials for the `ap-southeast-1` account with SES configured
(currently in SES sandbox mode — only verified addresses can send/receive
until production access is requested).

```bash
cd ../infrastructure
sam build
sam deploy \
  --parameter-overrides \
    SesFromEmail=<verified-from-address> \
    CaptainEmail=<captain-email> \
    ViceCaptainEmail=<vice-captain-email>
```

`SesFromEmail`, `CaptainEmail`, and `ViceCaptainEmail` have no default in
`template.yaml` and are deliberately absent from `samconfig.toml` so real
email addresses are never committed to this public repository — always
pass them via `--parameter-overrides` (or a local, untracked parameter
file) at deploy time.

After deploying, the `AvailabilityApiUrl` stack output is the value to
use for the frontend's `PUBLIC_AVAILABILITY_API_BASE_URL`.

## What exists so far

**Phase 1 — foundation:**

- DynamoDB tables (`TeamMembers`, `MatchAvailability` + `TokenLookupIndex`
  GSI, `ScheduledActions`), HTTP API, and least-privilege IAM per function.
- `GET /availability/health` — returns `{ status, timestamp, configPresent }`,
  no secret values. Useful for confirming a deploy wired up correctly.
- `GET /availability/validate` and `POST /availability/submit` were
  stubs in Phase 1; both are now real (see Phase 3 below).

**Phase 2 — match integration and scheduler:**

- `src/providers/githubMatchProvider.ts` fetches and validates the real
  published schedule JSON (see `docs/existing-match-data-mapping.md`)
  and maps it to an internal `Match` model.
- `src/time.ts` computes Singapore-calendar-day differences and the
  closure deadline instant with Luxon.
- `src/dueActions.ts` is a pure function deciding which of
  INVITATION/REMINDER/CLOSURE are due for a match right now, including
  late catch-up and cancelled/postponed handling.
- `src/repositories/scheduledActionsRepository.ts` claims actions with a
  conditional DynamoDB write so duplicate coordinator runs never
  duplicate a send, while a genuinely `FAILED` action can be retried.
- `src/handlers/coordinator.ts` wires all of the above together and
  runs daily via the `ScheduleV2` event in `infrastructure/template.yaml`.

**Phase 3 — invitations and player response:**

- `src/token.ts` generates magic-link tokens (`randomBytes(32)` + sha256);
  only the hash is ever persisted.
- `src/repositories/matchAvailabilityRepository.ts` and
  `teamMembersRepository.ts` wrap the two tables' reads/writes, including
  the token-hash lookup via `TokenLookupIndex` and the `if_not_exists`
  update that preserves the original `submittedAt` across response edits.
- `src/email/templates.ts` + `sesClient.ts` build and send the invitation
  and captain/vice-captain-notification emails via SESv2, HTML-escaping
  all player-controlled text (name, comments).
- `src/notifications.ts`'s `sendInvitations` is now real: lists active
  team members, skips anyone who already has an invitation record for
  the match (coarse per-player idempotency - see the plan doc's Phase 3
  note on the fuller Phase 4 design), and paces sends at ~1/sec to match
  this account's confirmed SES sandbox rate limit.
  `sendReminders`/`closeAndSendSummary` remain log-only stubs - that's
  explicit Phase 4 scope.
- `src/handlers/validateAvailability.ts` and `submitAvailability.ts` are
  now real, replacing the Phase 1 stubs: token hash lookup, expiry/
  deadline enforcement (`401`/`410`), identity always derived from the
  token record (never from the request body), and a captain/vice-captain
  notification sent only after the DB write succeeds (a notification
  failure never fails the player's submission).
- `scripts/seed-team-members.ts` (`npm run seed:team-members`) seeds
  `TeamMembers` from a local JSON file. Only
  `seed-data/team-members.example.json` (fake data) is committed - the
  real file is gitignored.

**Not yet done:** an actual live send/respond test against a deployed
stack. Everything above is code-complete and unit-tested, but running
`sam deploy` provisions real AWS resources and, once a match is due,
sends a real email - do that deliberately, not as a side effect of a
docs/code update.

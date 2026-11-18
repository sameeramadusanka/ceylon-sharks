# Ceylon Sharks -- Match Availability MVP Implementation Guide

## 1. Objective

Implement a small, secure, passwordless match-availability feature for
Ceylon Sharks.

The existing cricket website must remain a static website hosted on
GitHub Pages. The availability backend is a separate, independently
deployed service hosted on AWS.

**Non-negotiable architecture principle: Keep the existing cricket
website independent of the availability backend.**

The existing website must: - Continue to build and deploy to GitHub
Pages exactly as it does today. - Continue serving cricket statistics,
seasons, matches, players and other static content if AWS is
unavailable. - Not require AWS credentials, server-side rendering, a
running API, or a database to build or deploy. - Not make availability
API calls as part of the normal homepage or existing cricket-statistics
experience. - Not have its existing data structures or deployment
workflow unnecessarily refactored for this feature.

The availability feature may be accessed through a dedicated page and
will communicate with an independently deployed AWS API. If that API is
unavailable, show an availability-specific error/retry message without
affecting the rest of the website.

This document defines the MVP only. Do not implement the future captain
dashboard, general-purpose administration portal, player accounts, or
advanced reporting unless explicitly required below.

------------------------------------------------------------------------

## 2. MVP scope

### Included

1.  Read upcoming Ceylon Sharks matches from the existing public
    GitHub-hosted JSON data.
2.  Maintain an authorised team-member email allowlist in AWS DynamoDB.
3.  Automatically send each active player an individual invitation five
    calendar days before a match.
4.  Give each player a unique, unguessable, match-specific passwordless
    link.
5.  Allow a player to submit `AVAILABLE`, `UNAVAILABLE`, or `MAYBE`.
6.  Allow the player to revisit the same link and update their response
    before the deadline.
7.  Notify the captain and vice-captain when a response is submitted or
    changed.
8.  Send one reminder three calendar days before the match to players
    who have not responded.
9.  Close submissions two calendar days before the match and send the
    captain and vice-captain a final summary.
10. Prevent duplicate scheduled emails and reject submissions after the
    deadline.
11. Deploy and operate the availability backend independently from the
    GitHub Pages frontend.

### Explicitly out of scope for MVP

-   Player username/password accounts.
-   Cognito accounts for ordinary players.
-   A full captain dashboard.
-   Self-service team-member registration.
-   Editing or creating cricket matches through the availability
    application.
-   Replacing the existing cricket JSON files or match-management
    process.
-   Automatically changing or committing files in the GitHub repository.
-   Push notifications, SMS or WhatsApp notifications.
-   Advanced analytics, attendance history charts or squad-selection
    tools.

A small protected admin capability may be added later. For MVP, team
members, captain and vice-captain can be configured through
deployment-controlled environment/configuration or a one-time seed
process. Do not expose a public team-member management endpoint.

------------------------------------------------------------------------

## 3. Architecture

``` text
                         EXISTING WEBSITE
                 GitHub Pages – Astro / React / TS
                  Existing cricket JSON and pages
                                |
                Dedicated /availability/respond page
                                |
                         HTTPS API requests
                                |
                                v
                  AVAILABILITY BACKEND (AWS)
                  Independent deployment lifecycle
                                |
                       API Gateway HTTP API
                                |
                  +-------------+-------------+
                  |                           |
                  v                           v
          Player API Lambdas            Scheduled Lambda
          - Validate invitation         - Fetch GitHub JSON
          - Get current response         - Find due matches
          - Submit/update response       - Send invitations
                  |                      - Send reminders
                  |                      - Close availability
                  |                           |
                  +-------------+-------------+
                                |
                           DynamoDB
                   - Team members
                   - Match availability
                   - Scheduled-action state
                                |
                         Amazon SES
                   - Player invitations
                   - Player reminders
                   - Captain notifications
                   - Final summary
```

### Technology choices

  -----------------------------------------------------------------------
  Area                                MVP choice
  ----------------------------------- -----------------------------------
  Existing frontend                   Keep current Astro + React +
                                      TypeScript

  Hosting                             Existing GitHub Pages

  Backend runtime                     Node.js + TypeScript

  Infrastructure as code              AWS SAM

  API                                 Amazon API Gateway HTTP API

  Compute                             AWS Lambda

  Database                            Amazon DynamoDB on-demand

  Email                               Amazon SES

  Scheduling                          Amazon EventBridge Scheduler

  Timezone                            `Asia/Singapore`

  Match source                        Existing public GitHub JSON files

  Player access                       Match-specific magic link

  Captain/vice-captain recipients     Preconfigured authorised email
                                      addresses
  -----------------------------------------------------------------------

Use one AWS region consistently for the MVP, preferably `ap-southeast-1`
(Singapore), subject to service availability and SES account readiness.

------------------------------------------------------------------------

## 4. Independence requirements

This is the most important architectural requirement.

### 4.1 Separate deployment units

The frontend and backend must have separate build and deployment
workflows.

**Frontend workflow** - Triggered by frontend or cricket-data changes. -
Builds the existing static website. - Deploys to GitHub Pages. - Must
not deploy AWS resources. - Must not require AWS secrets to build.

**Backend workflow** - Triggered by changes under `backend/` or
`infrastructure/`, or manually. - Runs backend tests and AWS SAM
build. - Deploys AWS resources using a dedicated AWS deployment
identity. - Must not rebuild or redeploy the GitHub Pages site.

Example repository layout:

``` text
CeylonSharks/
├── src/                         # Existing Astro/React website
├── public/
│   └── data/                    # Existing cricket JSON
├── backend/                     # New independent backend application
│   ├── src/
│   ├── tests/
│   ├── package.json
│   └── tsconfig.json
├── infrastructure/              # AWS SAM templates/configuration
│   ├── template.yaml
│   └── samconfig.toml
├── .github/
│   └── workflows/
│       ├── deploy-pages.yml      # Existing workflow; preserve behaviour
│       └── deploy-availability.yml
└── README.md
```

Adapt paths to the actual repository. Do not move or rename existing
frontend files merely to match this example.

### 4.2 Runtime independence

-   The homepage, season pages, player pages, match pages and statistics
    must work without the availability API.
-   Only the dedicated availability page calls the API.
-   API failures must be handled locally on that page.
-   No availability API request should block the frontend build.
-   Do not use a GitHub Actions workflow to run the availability
    scheduler.
-   AWS EventBridge invokes the scheduled Lambda directly.
-   The backend reads the published match JSON over HTTPS at runtime. It
    does not need GitHub write access.
-   Do not place AWS access keys, SES credentials or database
    credentials in frontend code or public GitHub variables.

### 4.3 Frontend configuration

The static frontend may have a public API base URL, for example:

``` text
PUBLIC_AVAILABILITY_API_BASE_URL=https://api.example.com
```

This is not a secret. It is acceptable for it to be embedded in the
static site.

Do not put AWS credentials, token-signing secrets, private keys or SES
credentials in any `PUBLIC_` variable.

If the API URL is absent or the service is unavailable, the availability
page should show a helpful message. Other website pages must remain
unaffected.

------------------------------------------------------------------------

## 5. Match JSON integration

Do not invent a second match source. Inspect the actual repository and
identify: - Where upcoming match JSON files are stored. - How seasons
refer to match IDs. - The actual match date field and format. - The
actual match status or result fields. - How cancelled, postponed and
completed matches are represented. - Whether the match ID is globally
unique.

### Repository discovery findings (Phase 0 — completed)

Upcoming fixtures are published at
`public/upcoming_schedules/{SEASON}__SCHEDULE__{YEAR}.json`, shape
`{ "season": {...}, "matches": [...] }`. Each match entry has:

``` text
series, division, matchType, date (YYYY-MM-DD, Singapore local date),
time ("7:30 AM" / "12:00 PM" free-text, 12-hour with AM/PM),
teamOne, teamTwo, ground, umpireOne..Four, matchManager, scorer1, scorer2,
status, result
```

Only `status: "Scheduled"` has been observed in the current data; `result`
is `null` until the match is played. Completed matches move to
`public/season_results/{SEASON}__RESULTS__{YEAR}.json` with a free-text
`result` string (e.g. `"Ceylon Sharks won by 14 Runs"`, `"Abandoned."`) —
there is no structured win/loss/cancelled field there either.

**There is no native match ID anywhere in the published data.** Neither
the schedule file nor the results file assigns a stable identifier to a
fixture. This differs from the assumption in section 2 and the example
model below.

**Decision:** the backend derives a synthetic, deterministic `matchId` by
hashing the fields that uniquely and stably identify a fixture in the
schedule feed — season, match date, team one, and team two:

``` text
matchId = sha256(`${seasonId}|${matchDate}|${teamOne}|${teamTwo}`)
```

This must be computed identically on every coordinator run so the same
fixture always maps to the same `matchId` (required for the idempotency
guarantees in sections 6.3 and 10). If a fixture's date changes, this
recomputes to a new ID — handle that as the "match date changes" case in
the **Match identity and changes** section below, not as a new fixture
with a stale one left behind. `status` and `result` from the source feed
map onto the internal `UPCOMING | COMPLETED | CANCELLED | POSTPONED`
enum; only `"Scheduled"` has been observed so far, so the mapping for
cancelled/postponed values should fail safe (treat anything
unrecognised as non-upcoming rather than sending invitations for it).

Create a backend adapter:

``` text
backend/src/providers/githubMatchProvider.ts
```

The adapter should: 1. Fetch only the required published JSON files. 2.
Use the repository's public raw GitHub URL or GitHub Pages data URL. 3.
Apply a reasonable timeout. 4. Validate the downloaded JSON at runtime.
5. Map the actual source structure to a small internal `Match` model. 6.
Ignore completed and cancelled matches. 7. Log fetch/validation failures
without logging secrets. 8. Avoid writing to GitHub.

Internal model (adapt after inspecting the real data):

``` typescript
export interface Match {
  matchId: string;
  seasonId: string;
  matchDate: string;       // YYYY-MM-DD, Singapore local match date
  opponent: string;
  competition: string;
  status: "UPCOMING" | "COMPLETED" | "CANCELLED" | "POSTPONED";
}
```

The example above is an internal model, not a requirement to change the
existing JSON schema.

### Match date rules

-   Treat match dates as Singapore calendar dates.
-   Do not parse a date-only value as UTC and then convert it to
    Singapore time.
-   Use a timezone-aware date library such as Luxon.
-   Calculate calendar-day differences in `Asia/Singapore`.
-   The invitation is due when the match is five Singapore calendar days
    away.
-   The reminder is due when the match is three Singapore calendar days
    away.
-   The close action is due when the match is two Singapore calendar
    days away.
-   Define the close time as 23:59 Singapore time on the date two
    calendar days before the match, unless the project owner changes
    this requirement.
-   Do not use `Math.floor((matchDate - now) / 86400000)` for
    calendar-day scheduling.

### Match identity and changes

There is no existing stable match ID (see discovery findings above). Use
the synthetic `matchId = sha256(seasonId|matchDate|teamOne|teamTwo)` as
the backend match key.

Because the ID is derived from the match date, a date change produces a
*different* `matchId` rather than an update to the same record. Treat
this explicitly: - Detect a likely reschedule by matching the old record
on season + teams when the date-derived ID is no longer present in the
feed. - Carry over `invitationSentAt`/`reminderSentAt` state to the new
`matchId` rather than resending an invitation already sent for that
fixture. - If the date change affects an already sent reminder or
closure, record the change and make a deliberate decision rather than
silently sending duplicates. - For MVP, log postponed/cancelled match
changes and do not send further scheduled messages for cancelled
matches.

------------------------------------------------------------------------

## 6. DynamoDB design

Create three tables. Use on-demand billing and enable encryption at
rest.

### 6.1 `CeylonSharks_TeamMembers`

Partition key: `email` (String)

  Attribute     Type      Notes
  ------------- --------- -------------------------------------------
  `email`       String    Normalised lowercase email; partition key
  `playerId`    String    Optional existing cricket player ID
  `name`        String    Player display name
  `role`        String    `PLAYER`, `CAPTAIN`, or `VICE_CAPTAIN`
  `isActive`    Boolean   Only active members receive invitations
  `createdAt`   String    ISO-8601 timestamp
  `updatedAt`   String    ISO-8601 timestamp

Seed the initial list using a controlled script or deployment process.
Do not commit real player email addresses to a public repository. Keep
the source list in a secure deployment input or seed it directly into
DynamoDB.

### 6.2 `CeylonSharks_MatchAvailability`

Partition key: `matchId` (String)\
Sort key: `playerEmail` (String)

One record per player per match.

  -----------------------------------------------------------------------
  Attribute               Type                    Notes
  ----------------------- ----------------------- -----------------------
  `matchId`               String                  Existing match ID;
                                                  partition key

  `playerEmail`           String                  Normalised email; sort
                                                  key

  `playerName`            String                  Name snapshot at
                                                  invitation time

  `availability`          String                  `NOT_SUBMITTED`,
                                                  `AVAILABLE`,
                                                  `UNAVAILABLE`, `MAYBE`

  `comments`              String                  Optional player comment

  `tokenHash`             String                  SHA-256 hash of raw
                                                  invitation token

  `tokenExpiry`           Number                  Unix timestamp

  `invitationSentAt`      String                  Invitation send
                                                  timestamp

  `reminderSentAt`        String                  Reminder send
                                                  timestamp, if sent

  `submittedAt`           String                  First successful
                                                  submission

  `updatedAt`             String                  Latest response update

  `emailStatus`           String                  Delivery state for
                                                  invitation

  `createdAt`             String                  Record creation
                                                  timestamp
  -----------------------------------------------------------------------

Add a Global Secondary Index for token lookup:

``` text
Index name: TokenLookupIndex
Partition key: tokenHash (String)
Sort key: matchId (String)
```

The backend must use the index to locate the invitation. Never put a
player's email address or database key in the magic-link URL.

### 6.3 `CeylonSharks_ScheduledActions`

Partition key: `actionId` (String)

Use deterministic IDs:

``` text
INVITATION#<matchId>
REMINDER#<matchId>
CLOSURE#<matchId>
```

Attributes:

  Attribute        Type     Notes
  ---------------- -------- ------------------------------------------------
  `actionId`       String   Deterministic action key
  `matchId`        String   Related match
  `actionType`     String   `INVITATION`, `REMINDER`, `CLOSURE`
  `status`         String   `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`
  `scheduledFor`   String   ISO-8601 timestamp
  `startedAt`      String   Processing start
  `completedAt`    String   Completion timestamp
  `attemptCount`   Number   Retry tracking
  `lastError`      String   Sanitised error summary

Use conditional writes to claim an action and prevent two scheduler
executions from processing it concurrently.

For individual email delivery, record per-recipient progress or use a
small delivery/outbox item keyed by action and recipient. This is
necessary to recover safely if a batch partially succeeds.

DynamoDB and SES do not share an atomic transaction. Do not claim
exactly-once email delivery. Implement idempotent processing, delivery
tracking and reconciliation to minimise duplicate emails and missed
notifications.

### TTL

If old invitation records need eventual cleanup, use a separate numeric
`expireAt` attribute configured as DynamoDB TTL. TTL deletion is
asynchronous. It must not be used to enforce the response deadline.

------------------------------------------------------------------------

## 7. Magic-link security

Players do not create accounts. Their invitation link is a bearer
credential that grants access to one player's response for one match.

### Token creation

Use Node.js cryptography:

``` typescript
import { randomBytes, createHash } from "node:crypto";

const rawToken = randomBytes(32).toString("base64url");

const tokenHash = createHash("sha256")
  .update(rawToken)
  .digest("hex");
```

-   Email the raw token.
-   Store only the SHA-256 hash.
-   Generate a different token for every player and match.
-   Do not log raw tokens.
-   Do not put tokens in analytics events.
-   Do not include tokens in error-monitoring payloads.
-   Use HTTPS only.

### Token validation

The API must: 1. Receive the raw token. 2. Hash it. 3. Find the record
using `TokenLookupIndex`. 4. Verify token expiry. 5. Verify the match
exists and is not cancelled. 6. Verify availability is still open. 7.
Return only the minimum information needed for the form.

The player identity must always be derived from the token's database
record. Never trust a `playerEmail` supplied by the browser.

### Email link scanners

Some email providers scan links automatically. A GET request must never
submit availability, consume a token, or make an irreversible change.

The validation endpoint must be read-only. Only an explicit POST from
the player may update a response.

### Updating a response

The same valid link can be used to change a response before the
deadline. The API should update the existing `matchId + playerEmail`
item, not create a second item.

For stronger protection, consider adding an optional email one-time code
in a later version. The MVP magic link is a bearer link, so a forwarded
link can be used by whoever receives it.

------------------------------------------------------------------------

## 8. API contract

Base URL example:

``` text
https://api.example.com
```

Use API Gateway HTTP API and Lambda integrations.

### 8.1 `GET /availability/validate?token={token}`

Purpose: Validate the invitation and return form details.

Successful response:

``` json
{
  "valid": true,
  "playerName": "Player Name",
  "match": {
    "matchId": "existing-match-id",
    "opponent": "Opponent",
    "competition": "Competition",
    "matchDate": "2026-11-28"
  },
  "currentAvailability": "NOT_SUBMITTED",
  "deadline": "2026-11-26T23:59:00+08:00"
}
```

Do not return the player's email, raw token hash, other players'
responses, or internal database fields.

Possible status codes: - `200`: Valid invitation. - `400`: Missing or
malformed input. - `401`: Invalid or expired token. - `404`: Unknown or
unavailable match. - `410`: Submission deadline has passed.

### 8.2 `POST /availability/submit`

Request:

``` json
{
  "token": "raw-magic-link-token",
  "availability": "AVAILABLE",
  "comments": "Available for the match"
}
```

Allowed values: - `AVAILABLE` - `UNAVAILABLE` - `MAYBE`

The backend must: 1. Validate the request schema and comment length. 2.
Hash and validate the token. 3. Derive player and match identity from
the stored invitation. 4. Check token expiry. 5. Check match status and
deadline. 6. Update the existing availability record using a conditional
write. 7. Preserve the original `submittedAt` on updates. 8. Update
`updatedAt`. 9. Trigger captain and vice-captain notification
processing. 10. Return a success response only after the response has
been persisted.

Response:

``` json
{
  "success": true,
  "message": "Availability submitted successfully",
  "availability": "AVAILABLE",
  "updatedAt": "2026-11-19T10:30:00+08:00"
}
```

Possible status codes: - `200`: Response saved. - `400`: Invalid
availability or malformed request. - `401`: Invalid invitation. - `410`:
Deadline passed or match closed. - `429`: Rate limit exceeded. - `500`:
Unexpected server error.

Do not expose stack traces or internal DynamoDB errors to the client.

### 8.3 `GET /availability/my-response?token={token}`

Optional for the first release. The validation endpoint can return the
current response, so this route may be omitted to keep the MVP smaller.

### Admin endpoints

A full admin API and dashboard are out of scope for MVP. Captain and
vice-captain email addresses are configuration values. The final summary
is delivered by email.

If a manual operational override is essential, implement it as a
separately authenticated, narrowly scoped endpoint. Do not expose an
unauthenticated close/reopen endpoint.

------------------------------------------------------------------------

## 9. Email behaviour

Use Amazon SES. Verify the sender domain and configure SPF, DKIM and
DMARC as appropriate. Confirm SES production access in the selected
region before sending to the full team.

Create responsive HTML and plain-text templates.

### 9.1 Invitation -- five days before

Send one individually addressed email to every active player.

Include: - Player's name. - Opponent. - Match date. - Competition. -
Submission deadline. - Personalised magic link. - Instructions to update
the response using the same link.

Suggested subject:

``` text
Ceylon Sharks – Please confirm your availability
```

Do not put all players in the To or CC field. Send separate messages so
player addresses are not disclosed to teammates.

### 9.2 Reminder -- three days before

Query the match's availability records and send a reminder only when
`availability = NOT_SUBMITTED`.

Do not send reminders to players who selected `AVAILABLE`,
`UNAVAILABLE`, or `MAYBE`.

Suggested subject:

``` text
Reminder: Ceylon Sharks match availability
```

Use the existing valid token if it is still valid. If a new token is
generated, invalidate the previous token hash.

### 9.3 Submission notification

After a successful player submission or update, notify both configured
recipients: - Captain. - Vice-captain.

Include player name, match, new status, previous status when applicable,
comments, and submission time.

Do not send a notification before the database write succeeds.

### 9.4 Final summary -- two days before

At closure, email the captain and vice-captain a consolidated summary: -
Total active invited players. - Available count and names. - Unavailable
count and names. - Maybe count and names. - No-response count and
names. - Match date and deadline.

The summary is generated from DynamoDB, not from client-side data.

------------------------------------------------------------------------

## 10. Scheduler implementation

Create one EventBridge Scheduler schedule that invokes the coordinator
every day at 08:00 Singapore time.

The coordinator should: 1. Fetch the current published match JSON. 2.
Validate and map upcoming matches. 3. Upsert match metadata in DynamoDB.
4. Calculate Singapore calendar days until each match. 5. Determine
which action is due. 6. Claim the deterministic scheduled-action record
with a conditional write. 7. Process the action. 8. Record completion or
failure. 9. Emit metrics and structured logs.

Pseudocode:

``` typescript
async function runDailyCoordinator(): Promise<void> {
  const matches = await githubMatchProvider.getUpcomingMatches();

  for (const match of matches) {
    await matchRepository.upsert(match);

    const daysUntilMatch = getSingaporeCalendarDayDifference(
      match.matchDate
    );

    if (match.status === "CANCELLED" ||
        match.status === "COMPLETED") {
      continue;
    }

    if (daysUntilMatch === 5) {
      await processOnce(
        `INVITATION#${match.matchId}`,
        () => sendInvitations(match)
      );
    }

    if (daysUntilMatch === 3) {
      await processOnce(
        `REMINDER#${match.matchId}`,
        () => sendReminders(match)
      );
    }

    if (daysUntilMatch === 2) {
      await processOnce(
        `CLOSURE#${match.matchId}`,
        () => closeAndSendSummary(match)
      );
    }
  }
}
```

`processOnce` is illustrative. Implement it with DynamoDB conditional
writes, processing leases or another concurrency-safe approach. A failed
action must be recoverable without resending all successfully delivered
messages.

### Late discovery and missed runs

Do not silently skip a match if the scheduler was unavailable on the
exact five-day or three-day point.

For MVP, define a catch-up policy: - If a match is first discovered
after its five-day invitation point but before its deadline, send the
invitation as soon as possible and record it as late. - If the reminder
point has passed, do not send a reminder before the initial
invitation. - If the deadline has passed, do not send invitations or
accept responses. - If the match is cancelled, stop future actions.

This prevents a temporary GitHub or AWS outage from permanently losing a
match invitation.

### Email partial failures

Process recipients individually or in small batches. Store per-recipient
delivery status. Retry only failed/pending recipients. Do not mark the
entire invitation action complete until every eligible recipient has a
terminal delivery result.

------------------------------------------------------------------------

## 11. Frontend implementation

Add a dedicated availability page to the existing Astro application.
Adapt the route naming to the existing project conventions.

Suggested additions:

``` text
src/
├── pages/
│   └── availability/
│       └── respond.astro
├── components/
│   └── availability/
│       ├── AvailabilityForm.tsx
│       ├── MatchDetails.tsx
│       ├── AvailabilityStatus.tsx
│       └── SubmissionConfirmation.tsx
└── services/
    └── availabilityApi.ts
```

The page should: - Read the token from the query string. - Call the
validation API. - Show a loading state. - Display player and match
details. - Display the existing response if one has been submitted. -
Allow Available, Unavailable or Maybe. - Allow an optional comment. -
Display the deadline. - Submit to the API. - Display a clear
confirmation or recoverable error. - Allow a player to update their
response before the deadline.

After reading the token, remove it from the visible address bar with
`history.replaceState`, but retain it in memory for API requests. Set a
restrictive `Referrer-Policy` and do not load third-party analytics or
scripts on this page that could receive the token.

Do not add API calls to existing homepage, match, player or statistics
components.

------------------------------------------------------------------------

## 12. AWS SAM infrastructure

Define all new AWS resources in `infrastructure/template.yaml`.

Expected resources: - API Gateway HTTP API. - Player validation
Lambda. - Player submission Lambda. - Daily coordinator Lambda. -
DynamoDB team-members table. - DynamoDB match-availability table and
token GSI. - DynamoDB scheduled-actions table. - EventBridge Scheduler
schedule. - IAM execution roles with least-privilege permissions. -
CloudWatch log groups and alarms where appropriate.

Use environment variables for non-secret configuration:

``` text
AWS_REGION
TEAM_MEMBERS_TABLE
MATCH_AVAILABILITY_TABLE
SCHEDULED_ACTIONS_TABLE
GITHUB_MATCH_DATA_BASE_URL
AVAILABILITY_FRONTEND_URL
SES_FROM_EMAIL
CAPTAIN_EMAIL
VICE_CAPTAIN_EMAIL
TIME_ZONE=Asia/Singapore
INVITATION_DAYS_BEFORE=5
REMINDER_DAYS_BEFORE=3
CLOSURE_DAYS_BEFORE=2
CLOSURE_LOCAL_TIME=23:59
```

Do not put AWS credentials in Lambda environment variables. Lambda
should use its execution role.

Use AWS SAM parameters or a secure configuration process for
environment-specific values. Never commit real team email addresses or
secrets to public source control.

------------------------------------------------------------------------

## 13. GitHub Actions and deployment

Keep the existing GitHub Pages workflow unchanged unless a minimal,
necessary adjustment is required.

Create a separate workflow such as:

``` text
.github/workflows/deploy-availability.yml
```

It should: 1. Trigger on changes to `backend/**` or `infrastructure/**`,
and support manual dispatch. 2. Install the supported Node.js version.
3. Run linting and type checks. 4. Run backend unit tests. 5. Run
`sam build`. 6. Deploy with `sam deploy`. 7. Run a lightweight
post-deployment health check.

Use GitHub Actions OIDC federation to assume an AWS IAM role instead of
storing long-lived AWS access keys in GitHub secrets.

The frontend deployment workflow must not depend on this backend
workflow, and the backend workflow must not deploy the frontend.

Document local development and deployment commands in the backend
README.

------------------------------------------------------------------------

## 14. Testing and acceptance criteria

### Unit tests

-   Token generation creates cryptographically random tokens.
-   Only token hashes are persisted.
-   Match JSON maps correctly to the internal model.
-   Singapore calendar-day calculations work around midnight.
-   Invitation, reminder and closure dates are correct.
-   Cancelled/completed matches are excluded.
-   Invalid availability values are rejected.
-   Comments are length-limited and safely rendered in emails.
-   A closed match rejects submissions.

### Integration tests

-   Valid token retrieves the correct player's match.
-   Invalid token is rejected.
-   Expired token is rejected.
-   Player can submit an initial response.
-   Player can update an existing response.
-   Submission uses token-derived identity, not browser-supplied email.
-   Captain and vice-captain notifications are triggered after
    persistence.
-   Reminder excludes all players who have responded.
-   Closure summary includes pending players.
-   Duplicate coordinator executions do not duplicate completed
    scheduled actions.
-   Partial SES failures retry only outstanding recipients.

### Frontend tests

-   Loading, valid, invalid, expired and closed-link states render
    correctly.
-   All three availability choices work.
-   Submission success and error states are clear.
-   The page works on mobile.
-   The rest of the static site works when the availability API is
    offline.

### Independence acceptance tests

These are mandatory: 1. Build the existing frontend with the
availability API unavailable. 2. Deploy the existing frontend without
AWS credentials. 3. Browse homepage, season, match, player and
statistics pages with the API unavailable. 4. Confirm no existing page
makes an availability API request. 5. Deploy backend changes without
triggering a GitHub Pages deployment. 6. Deploy frontend changes without
deploying AWS resources.

The MVP is not complete until all six independence tests pass.

------------------------------------------------------------------------

## 15. Observability and operational safeguards

Use structured CloudWatch logs. Include: - Match ID. - Action ID. -
Action type. - Recipient identifier in a privacy-conscious form. -
Processing result. - SES message ID where available. - Error category.

Never log: - Raw magic-link tokens. - Full invitation URLs. - AWS
credentials. - Unnecessary player personal data.

Create metrics or alarms for: - GitHub match-data fetch failures. -
Scheduler Lambda failures. - Invitation or reminder delivery failures. -
Submission API errors. - SES sending quota or rejection issues.

Add a simple health endpoint if useful, but do not make frontend
availability depend on it.

------------------------------------------------------------------------

## 16. Implementation task order

Complete the work in this order. Do not start by building the whole UI
or creating AWS resources before understanding the existing repository.

### Phase 0 -- Repository discovery

-   [x] Inspect the current repository structure and existing GitHub
    Pages workflow. (See `CLAUDE.md` and `.github/workflows/deploy.yml`.)
-   [x] Identify the real match JSON files and their relationships.
    (`public/upcoming_schedules/` for fixtures, `public/season_results/`
    for completed matches — see findings in section 5 above.)
-   [x] Document the actual match ID, date, status, opponent and
    competition fields. (No native match ID exists; synthetic ID
    decided — see section 5 above. Competition is not a field in the
    source data; `matchType`/`series`/`division` are the closest
    equivalents and should be mapped accordingly.)
-   [ ] Identify the public URL from which the backend can fetch the
    match data. (Candidate: raw GitHub content URL for
    `public/upcoming_schedules/*.json` on the `main` branch, or the
    published `ceylonsharks.com` site — needs a final decision.)
-   [ ] Identify the existing website origin and desired API domain.
    (Website origin is `https://www.ceylonsharks.com`; API domain not
    yet chosen.)
-   [ ] Confirm the AWS region and SES production access.
-   [x] Record the existing frontend build and deployment commands.
    (See `CLAUDE.md`.)
-   [x] Write a short mapping document before implementing the adapter.
    (Captured inline in section 5 above; promote to
    `backend/docs/existing-match-data-mapping.md` verbatim once the
    `backend/` project is scaffolded.)

**Deliverable:** `backend/docs/existing-match-data-mapping.md`

### Phase 1 -- Backend foundation

-   [ ] Create the independent TypeScript backend project.
-   [ ] Configure TypeScript, linting and tests.
-   [ ] Create AWS SAM template.
-   [ ] Create DynamoDB tables and indexes.
-   [ ] Configure IAM roles and API Gateway.
-   [ ] Add environment-specific configuration.
-   [ ] Implement health/diagnostic logging.

**Deliverable:** Backend builds and deploys independently.

### Phase 2 -- Match integration and scheduler

-   [ ] Implement GitHub match-data provider using actual schemas.
-   [ ] Implement Singapore calendar date utilities.
-   [ ] Implement match synchronisation.
-   [ ] Implement scheduled-action idempotency.
-   [ ] Implement daily EventBridge-triggered coordinator.
-   [ ] Add catch-up handling and cancelled-match handling.

**Deliverable:** Scheduler can identify matches due for invitation,
reminder and closure without sending real emails in test mode.

### Phase 3 -- Invitations and player response

-   [ ] Seed authorised team members.
-   [ ] Implement secure magic-link generation and hashing.
-   [ ] Implement invitation email template and SES integration.
-   [ ] Implement token validation endpoint.
-   [ ] Implement availability submission endpoint.
-   [ ] Implement response update behaviour.
-   [ ] Enforce token expiry and match deadline.
-   [ ] Add captain and vice-captain notification emails.

**Deliverable:** A test player can receive an invitation and
submit/update availability.

### Phase 4 -- Reminders and final summary

-   [ ] Implement reminder recipient selection.
-   [ ] Implement per-recipient email delivery tracking.
-   [ ] Implement two-day closure.
-   [ ] Implement final summary email.
-   [ ] Implement retry and partial-failure recovery.
-   [ ] Test duplicate scheduler invocations.

**Deliverable:** Full five-day, three-day and two-day workflow works in
a simulated environment.

### Phase 5 -- Frontend integration

-   [ ] Add the dedicated availability response page.
-   [ ] Add the availability API client.
-   [ ] Implement loading, error, expired and closed states.
-   [ ] Implement the response form.
-   [ ] Implement confirmation and update experience.
-   [ ] Confirm no existing pages depend on the API.

**Deliverable:** Mobile-friendly passwordless availability form.

### Phase 6 -- Production validation

-   [ ] Configure SES production sending and verified sender domain.
-   [ ] Configure production API URL and CORS.
-   [ ] Configure GitHub Actions OIDC for backend deployment.
-   [ ] Test with a small authorised group.
-   [ ] Verify all emails and deadlines.
-   [ ] Run independence acceptance tests.
-   [ ] Document support and recovery procedures.

**Deliverable:** MVP deployed without changing the existing website's
hosting model.

------------------------------------------------------------------------

## 17. Definition of Done

The MVP is ready when:

-   [ ] The existing GitHub Pages website builds and works exactly as
    before.
-   [ ] The backend deploys independently to AWS.
-   [ ] Upcoming matches are read from the real published GitHub JSON.
-   [ ] Active team members receive individual invitations five days
    before matches.
-   [ ] Every invitation link is unique, secure and match-specific.
-   [ ] Players can submit Available, Unavailable or Maybe without
    creating an account.
-   [ ] Players can update their response before the deadline.
-   [ ] Captain and vice-captain receive notifications after successful
    submissions/updates.
-   [ ] Non-responders receive reminders three days before matches.
-   [ ] Submissions close two days before matches.
-   [ ] Captain and vice-captain receive a final summary.
-   [ ] Duplicate scheduler executions do not cause avoidable duplicate
    emails.
-   [ ] Tokens and personal data are not leaked through logs or public
    frontend assets.
-   [ ] Existing website functionality remains available during an AWS
    outage.

------------------------------------------------------------------------

## 18. Instructions for the coding agent

Before making changes:

1.  Read the existing project structure, package scripts, data schemas
    and GitHub Pages workflow.
2.  Do not assume the example JSON in this guide matches the repository.
3.  Produce a short implementation plan based on the actual repository.
4.  Identify any ambiguity in match date/status fields before coding.
5.  Preserve existing frontend behaviour and deployment.
6.  Implement the backend as an independent application and deployment
    unit.
7.  Add tests alongside each backend feature.
8.  Use AWS SAM and least-privilege IAM.
9.  Never commit secrets or real player email addresses to public files.
10. Do not implement out-of-scope features without approval.

**Highest-priority instruction: The availability backend is an optional,
independent capability. The existing Ceylon Sharks static website must
continue to build, deploy and operate without the availability
backend.**

If any implementation choice would make the existing website dependent
on AWS availability, AWS credentials, or backend deployment, reject that
approach and choose an independent integration instead.

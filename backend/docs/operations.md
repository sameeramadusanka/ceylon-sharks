# Operations runbook

Support and recovery procedures for the deployed availability backend.
Stack name `ceylon-sharks-availability`, region `ap-southeast-1`. All
commands assume `aws` CLI credentials for the deploying AWS account and
(for `sam` commands) running from `infrastructure/`.

Get current resource names any time with:

```bash
aws cloudformation describe-stacks --region ap-southeast-1 \
  --stack-name ceylon-sharks-availability --query 'Stacks[0].Outputs'
```

## Health check

```bash
curl -s "$(aws cloudformation describe-stacks --region ap-southeast-1 \
  --stack-name ceylon-sharks-availability \
  --query 'Stacks[0].Outputs[?OutputKey==`AvailabilityApiUrl`].OutputValue' --output text)/availability/health"
```

Returns `{ status: "ok", configPresent: {...} }` with no secret values.
A `false` under `configPresent` means that env var is missing on the
deployed Lambda - check `infrastructure/template.yaml`'s `Globals`
and the parameters passed at deploy time.

## Logs

Each function has its own log group (30-day retention):

```bash
aws logs tail /aws/lambda/ceylon-sharks-availability-health      --region ap-southeast-1 --since 1h
aws logs tail /aws/lambda/ceylon-sharks-availability-validate    --region ap-southeast-1 --since 1h
aws logs tail /aws/lambda/ceylon-sharks-availability-submit      --region ap-southeast-1 --since 1h
aws logs tail /aws/lambda/ceylon-sharks-availability-coordinator --region ap-southeast-1 --since 1h
```

Logs are structured JSON (`src/logger.ts`) - `matchId`, `actionType`,
`result`/`errorCategory` are the useful filter fields. Recipient emails
are always masked (`a***n@example.com`); raw tokens are never logged.

## Manually running the coordinator now

The schedule (`CoordinatorFunctionDailySchedule`) fires every hour,
`Asia/Singapore` time. Only the 08:00 run does the daily work (invitations,
reminders, closing summaries); the other hours only close invitations a
captain sent by hand from the Schedule tab, at their own closing time (see
"Sending invitations by hand" below). Invoking it by hand with no payload
does the full daily run. To run it immediately instead of waiting (e.g. to
test, or to recover sooner after a fix):

```bash
aws lambda invoke --function-name ceylon-sharks-availability-coordinator \
  --region ap-southeast-1 --cli-read-timeout 60 /tmp/out.json
aws logs tail /aws/lambda/ceylon-sharks-availability-coordinator --region ap-southeast-1 --since 2m
```

It's always safe to run this more than once - every action is claimed
idempotently (`src/repositories/scheduledActionsRepository.ts`) and
every recipient is tracked individually, so a second run never
duplicates a send that already succeeded.

## Pausing / resuming the daily schedule

Useful before a data migration, or if `TeamMembers` is temporarily
empty/incomplete (see the gap noted below).

```bash
# Check current state
aws scheduler get-schedule --region ap-southeast-1 --name CoordinatorFunctionDailySchedule --query State

# Disable
aws scheduler update-schedule --region ap-southeast-1 --name CoordinatorFunctionDailySchedule \
  --group-name default --schedule-expression "cron(0 * * * ? *)" --schedule-expression-timezone "Asia/Singapore" \
  --flexible-time-window Mode=OFF \
  --target '{"Arn":"arn:aws:lambda:ap-southeast-1:<ACCOUNT_ID>:function:ceylon-sharks-availability-coordinator","RoleArn":"<CoordinatorFunctionDailyScheduleRole ARN from the stack>","Input":"{\"mode\":\"scheduled\"}"}' \
  --state DISABLED   # or ENABLED
```

This is a manual CLI change, not tracked in `template.yaml` - a
`sam deploy` of unrelated changes will not revert it.

**Known gap:** if `TeamMembers` has zero active rows when a match's
invitation point is reached, `sendInvitations` trivially succeeds
(nothing to send, no failures) and the coordinator marks that match's
`INVITATION` action `COMPLETED` - permanently, since only `FAILED`
actions are retryable. If that happens, re-adding real team members
afterward will **not** retroactively invite them for that match. Keep
`TeamMembers` populated with at least the real roster before letting
the schedule run unattended, or pause it if you expect a gap.

## Team members

```bash
# Re-seed (safe to re-run - each row is an upsert by email, the partition key)
TEAM_MEMBERS_TABLE=<TeamMembersTableName output> npm run seed:team-members -- path/to/team-members.json

# Check who's currently active
aws dynamodb scan --region ap-southeast-1 --table-name <TeamMembersTableName output> \
  --filter-expression "isActive = :a" --expression-attribute-values '{":a":{"BOOL":true}}' \
  --query 'Items[].{email:email.S,name:name.S,role:role.S}'
```

Never commit the real seed file - see `.gitignore` and
`backend/seed-data/team-members.example.json`.

### Adding a real player while SES stays in sandbox

Every recipient address must be individually verified while the
account is in SES sandbox mode (current state - production access has
been deliberately deferred). To add one:

```bash
aws sesv2 create-email-identity --region ap-southeast-1 --email-identity player@example.com
```

AWS emails that address a verification link; the invitation/reminder
flow will keep failing for that player (logged, retried daily) until
they click it. Check current verified identities with:

```bash
aws sesv2 list-email-identities --region ap-southeast-1 \
  --query 'EmailIdentities[].{Identity:IdentityName,Status:VerificationStatus}'
```

## Retrying a failed action

Nothing to do manually in the common case - a `FAILED` action is
automatically retried the next time the coordinator runs (see
`claimAction`'s `attribute_not_exists(actionId) OR #status = :failed`
condition). To check a specific match's action status:

```bash
aws dynamodb get-item --region ap-southeast-1 --table-name <ScheduledActionsTableName output> \
  --key '{"actionId": {"S": "INVITATION#<matchId>"}}'
```

`matchId` is deterministic - `sha256(seasonId|matchDate|teamOne|teamTwo)`
(`src/matchId.ts`) - recompute it if needed rather than guessing.

## Rolling back a deploy

```bash
git log --oneline -- backend infrastructure   # find the commit to roll back to
git checkout <commit> -- backend infrastructure
cd infrastructure && sam build && sam deploy --no-confirm-changeset \
  --parameter-overrides SesFromEmail=<...> CaptainEmail=<...> ViceCaptainEmail=<...>
```

CloudFormation keeps full stack history too -
`aws cloudformation describe-stack-events` shows what changed in the
last deploy if a rollback needs investigating first.

## Publishing Player of the Week from the admin panel

The admin panel's **Player of the Week** tab (only shown to the captain,
vice-captain and site owner) sends the poster and details to
`POST /admin/player-of-the-week`. The `publish-potw` Lambda checks the
session and the publisher list, validates the date, player and image, then
commits `{date}__{playerId}.{jpg|png}` + `.json` to
`src/assets/player_of_the_week/{season}/` as one commit. That commit runs the
site's normal **Deploy** workflow, so the change is live about 3 minutes later.

Who may publish: `CaptainEmail`, `ViceCaptainEmail` and
`PlayerOfTheWeekOwnerEmail` (GitHub secret `AVAILABILITY_POTW_OWNER_EMAIL`).
They also need to be on the admin allowlist to sign in at all.

Where it commits: `PlayerOfTheWeekPublishBranch`, set explicitly in
`deploy-availability.yml`. It's `main`, so a publish goes live. To try a
change to the publish flow safely, set it to `potw-test` (created from
`main` if missing; pushes there don't deploy), test, then set it back.

### Emails after publishing

After a successful commit, `publish-potw` starts `notify-potw` in the
background (an async "Event" invoke, with no automatic retries so nobody gets
emailed twice). It waits about a minute, then checks the share page every
30 seconds until it shows the new winner:

- **Live:** the winner gets a congratulations email with the page link (unless
  "Email the player" was unticked), then the captain, vice-captain and site
  owner get a "Player of the Week is live" email that says whether the
  winner was emailed.
- **Not live after ~12 minutes:** only the publishers get a "published, but not
  live yet" email pointing at the Pages deploy; the winner isn't emailed.

The winner's address comes from the TeamMembers table: matched on
`playerId` (the squad file's player ID) first, then on exact name. Add
`playerId` to the seed rows to make that reliable. A publish never fails
because of an email problem.

```bash
aws logs tail /aws/lambda/ceylon-sharks-availability-notify-potw --since 1h --region ap-southeast-1
```

## Changing the match schedule from the admin panel

The admin panel's **Schedule** tab (same people as Player of the Week) edits
the season schedule files in `public/upcoming_schedules/`, mainly to add the
knockout matches (QF1, QF2, quarter final, semi final, final) that aren't
known when the league schedule is published. It uses the `admin-schedule`
Lambda, the same GitHub token and the same branch
(`PlayerOfTheWeekPublishBranch`):

- `GET /admin/schedule` lists every season (any with a squad folder or a
  schedule file) and its fixtures, plus the opponents seen in any schedule.
- `POST /admin/schedule` makes one change and commits it:
  `{ action: "add", season, match }`, `{ action: "update", season, key, match }`
  or `{ action: "delete", season, key }`, where `match` is
  `{ format, opponent, date, time, ground }` and `key` is
  `date|teamOne|teamTwo` from the list. Formats and grounds are fixed lists in
  `backend/src/handlers/adminSchedule.ts`. A new match is stored as
  `Ceylon Sharks` v the opponent with status `Scheduled`; an update keeps the
  fixture's home/away order and the umpire/scorer fields. Two matches at the
  same date and time are refused, and a stale key (someone else changed the
  match first) returns 409 so the panel can reload.

The coordinator reads the same files, so a new fixture gets availability
emails like a league match. The availability match ID is built from the
season, date and both team names, so changing a match's date or opponent
after its invitations went out makes it a new match with fresh invitations;
responses to the old one stay in the admin panel's history.

```bash
aws logs tail /aws/lambda/ceylon-sharks-availability-admin-schedule --since 1h --region ap-southeast-1
```

### Sending invitations by hand

The daily run sends invitations 5 days before a match, catches up a missed
one while the match is still 3-4 days away, and never sends once the 2-day
closing deadline has passed. A match added later than that (typically a
knockout game confirmed a few days out) would get no invitations, so each
upcoming match in the Schedule tab shows where its invitations stand, and
**Send availability invitations** appears when it's 0-5 days away and they
haven't gone out (or the last attempt failed).

`POST /admin/schedule` with `{ action: "invite", season, key }`
(`backend/src/manualInvitation.ts` has the rules):

- 3-5 days out: sent now with the normal deadline; the reminder and closing
  summary then follow the normal daily rules.
- 2 days out or less: availability closes at 23:59 the night before the match,
  or, if that's under an hour away (or it's match day), 2 hours before the start
  time. If players would have under 30 minutes, it's refused.
- The admin function claims the match's `INVITATION#{matchId}` action (same
  conditional write as the daily run, so nothing is ever sent twice) with
  `trigger: MANUAL`, `requestedBy`, a match snapshot and, when it has its own
  closing time, `closesAt`. It then starts the coordinator asynchronously with
  `{ mode: "manual-invitation", match, closesAt }`, which sends the emails
  (about a second per player) and marks the action COMPLETED or FAILED. If the
  coordinator can't be started, the action is marked FAILED and the button
  comes back.
- A `closesAt` invitation is closed by whichever coordinator run first sees
  that time has passed - normally the next hourly run - which sends the usual
  summary to the captain and vice-captain.

To see a hand-sent invitation's record:

```bash
aws dynamodb scan --table-name <ScheduledActionsTable> --region ap-southeast-1 \
  --filter-expression "#t = :m" --expression-attribute-names '{"#t":"trigger"}' \
  --expression-attribute-values '{":m":{"S":"MANUAL"}}'
```

## Managing site photos from the admin panel

The admin panel's **Site photos** tab (same people as Player of the Week)
manages three folders: `src/assets/banner_images/` (homepage banner),
`src/assets/history_images/` (Our Story carousel) and
`src/assets/player_images/` (player photos, `{playerId}.{ext}`). It uses the
`site-photos` Lambda, the same GitHub token and the same branch
(`PlayerOfTheWeekPublishBranch`):

- `GET /admin/site-photos` lists the three folders.
- `POST /admin/site-photos/upload` stores one photo (JPEG/PNG, max 4 MB; the
  page shrinks photos first) as a git blob. Nothing is committed yet.
- `POST /admin/site-photos` commits the whole batch as one commit: the new
  banner/Our Story order (files are renamed `010__…`, `020__…` so the site's
  file-name order matches), photos left out are deleted, and player photos
  are written as `{playerId}.{ext}` with any other file for that player
  removed. Player changes are checked against that season's squad file.
  The banner can't be emptied.

Deleted photos stay in git history, so a mistake can be undone by restoring
the file from an earlier commit.

After the commit, `notify-site-photos` runs in the background (no retries).
It polls `https://ceylonsharks.com/build-info.json`, which the site build
writes with the commit it was built from (`src/pages/build-info.json.ts`),
and asks GitHub whether that commit includes the new one. Then the captain,
vice-captain and site owner get "Site photos are live", or after ~12 minutes
"saved, but not live yet".

```bash
aws logs tail /aws/lambda/ceylon-sharks-availability-site-photos --since 1h --region ap-southeast-1
aws logs tail /aws/lambda/ceylon-sharks-availability-notify-site-photos --since 1h --region ap-southeast-1
```

### The GitHub token

A fine-grained personal access token from the repo owner's account, limited
to this repository with **Contents: Read and write** only. It's stored as an
SSM SecureString and never appears in the repo or the template:

```bash
aws ssm put-parameter --region ap-southeast-1 --name /ceylon-sharks/github-publish-token \
  --type SecureString --value "<token>" --overwrite
```

It acts as the repo owner, so it passes `main`'s branch protection the same
way the owner's own merges do (admins aren't subject to the rules). Tokens
expire: when publishing fails with "The GitHub token may have expired", create
a new token on GitHub and run the command above again. A warm Lambda caches
the old token, but drops it automatically after GitHub rejects it, so the
next try uses the new one.

### Logs

```bash
aws logs tail /aws/lambda/ceylon-sharks-availability-publish-potw --since 1h --region ap-southeast-1
```

## Common troubleshooting

| Symptom in logs | Likely cause | Fix |
| --- | --- | --- |
| `AccessDeniedException ... ses:SendEmail ... identity/<recipient>` | IAM policy scoped `ses:SendEmail` to a resource ARN instead of a `ses:FromAddress` condition | Already fixed in `template.yaml` (Phase 3) - if it reappears, a template edit likely reverted it |
| `MessageRejected: Email address is not verified` | SES sandbox mode (current state) and that address isn't verified yet | Verify it (see above), or request SES production access when ready to go live to the full squad |
| `ThrottlingException` from SES | Sandbox `MaxSendRate` (1 req/sec) exceeded | Shouldn't happen - sends are paced at ~1.1s apart (`SES_SEND_PACING_MS` in `src/notifications.ts`); if it does, that pacing constant needs raising |
| Browser console: CORS error calling the API from a non-production origin | Expected and correct - `AvailabilityHttpApi`'s CORS is locked to `AvailabilityFrontendUrl` (`https://ceylonsharks.com`) | Not a bug. Testing from `localhost` needs mocked responses (see Phase 5 verification) |
| Real invitation link in production: "Unable to load this invitation" / "Unable to reach the availability service" | `AvailabilityFrontendUrl` was deployed as `https://www.ceylonsharks.com`, but the site actually redirects `www` to the apex domain (`https://ceylonsharks.com`) - confirmed with `curl -I https://www.ceylonsharks.com/...` and matches `src/data/site.json`'s own `canonicalUrl`. The browser loads the page at the apex origin after the redirect, so its CORS preflight (`Origin: https://ceylonsharks.com`) didn't match the API's allowed origin and was silently blocked | Fixed: `AvailabilityFrontendUrl` is now `https://ceylonsharks.com` (apex) in both `template.yaml`'s Default and the explicit `--parameter-overrides` in `deploy-availability.yml` - see the comment there for why it has to be explicit, not just the Default, on an already-existing stack. Verify with `aws apigatewayv2 get-api --api-id <id> --query CorsConfiguration` after any future domain change |
| `Invalid or expired invitation` (401) for a link that looks right | Token hash doesn't match any record - could be a stale link from before a reminder rotated the token | Expected: a reminder mints a fresh token and invalidates the old link (section 9.2) |
| Coordinator logs "fetched upcoming matches: 0" | GitHub schedule JSON fetch failed or returned no upcoming fixtures | Check `GITHUB_MATCH_DATA_BASE_URL` is reachable and `public/upcoming_schedules/*.json` has fixtures with `status: "Scheduled"` |
| GitHub Actions: `Error: Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity` | GitHub's OIDC `sub` claim includes immutable numeric IDs after the owner and repo name (`repo:OWNER@ORG_ID/REPO@REPO_ID:ref:...`), not just `repo:OWNER/REPO:...` - the deploy role's trust policy `StringLike` condition must account for that | Confirm via `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity` (the denied request's `Username` field shows the exact claim GitHub sent). Trust policy `sub` condition should be `repo:sameeramadusanka*/ceylon-sharks*:*`, not `repo:sameeramadusanka/ceylon-sharks:*` |
| GitHub Actions `sam build`: `Cannot find esbuild. esbuild must be installed on the host machine` | SAM's `NodejsNpmEsbuildBuilder` runs its own staged `npm install` per function that omits `devDependencies`, so `backend/package.json`'s own `esbuild` devDependency isn't visible to it | `deploy-availability.yml` installs it globally (`npm install -g esbuild`) right before `sam build` |
| GitHub Actions `sam deploy`: `AccessDenied ... cloudformation:CreateChangeSet ... stack/aws-sam-cli-managed-default/...` | `samconfig.toml`'s `resolve_s3 = true` makes `sam deploy` also re-verify/update its own separate `aws-sam-cli-managed-default` bootstrap stack on every run - the deploy role deliberately has no CloudFormation permissions outside the `ceylon-sharks-availability` stack | `sam deploy --config-env ci` selects `samconfig.toml`'s `[ci.deploy.parameters]` block, which uses an explicit `s3_bucket`/`s3_prefix` instead of `resolve_s3` - bypasses the bootstrap-stack check entirely. (An explicit `--s3-bucket` CLI flag alone doesn't work either: SAM CLI refuses to mix it with `resolve_s3=true` still present in config - "Cannot use both --resolve-s3 and --s3-bucket parameters" - hence the separate config environment rather than just adding a flag.) |
| GitHub Actions `sam deploy`: `AccessDenied ... cloudformation:CreateChangeSet on resource: arn:aws:cloudformation:ap-southeast-1:aws:transform/Serverless-2016-10-31` | Every `AWS::Serverless-2016-10-31` template needs `cloudformation:CreateChangeSet` on this AWS-owned transform resource (separate from our own stack's ARN - different account, "aws") to expand the SAM macro | Added as its own statement in `infrastructure/github-oidc-deploy-role/permissions-policy.json` - re-apply with `aws iam put-role-policy` if it ever drifts (see that directory's README) |

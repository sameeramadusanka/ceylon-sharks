# Ceylon Sharks — Availability Admin Panel (Proposal)

Status: idea / not yet built. This document describes a proposed design only — no code has been written against it yet.

**Decisions locked in:**
- Initial allowlist: Captain (`hddesilva93@gmail.com`), Vice-Captain (`lasithalokuge@gmail.com`), and `sameera234madusanka@gmail.com`. More can be added later via the same AWS CLI operation.
- Session length: 24 hours.
- Match history scope: full history — all past matches are visible, not just current/upcoming.

## Problem

Captain, vice-captain, and a handful of other trusted people (team manager, selectors — not necessarily all players) want to see live availability status per match: who's responded, who hasn't, and what they said. Today that information only reaches them as a one-time "final summary" email sent when the window closes. There's no way to check status mid-window, no way to see it on a phone without digging through email, and no way to grant visibility to someone who isn't a player (so isn't in `TeamMembers` at all).

## Design goals

- Login must be trivial: type an email, get a code, type the code back in. No passwords, no account creation, no OAuth provider.
- Who can log in is an explicit, tiny allowlist — not "everyone in `TeamMembers`". Captain and vice-captain are on it by default, but it should support adding someone who isn't a player.
- Zero risk to the static site. This follows the same architectural boundary already established for the availability-response feature: an independent page, calling an independent backend, never touching `index.astro` / `TeamDashboard.tsx` / the homepage build.
- Reuse what already exists rather than standing up new infrastructure: the same SES setup, the same token-hashing pattern already used for player magic links, and ideally the same backend SAM stack (just new routes), not a second deployment unit.

## Who gets access

New minimal DynamoDB table, `AdminAllowlist` (PK: `email`), separate from `TeamMembers`:

| field | notes |
|---|---|
| `email` | partition key, lowercased |
| `name` | display name in the panel |
| `addedAt` | ISO timestamp |

Keeping this separate from `TeamMembers` (rather than adding an `isAdmin` flag there) means admin access isn't tied to being an active player — the club manager or a selector can be added without creating a fake "player" row, and removing someone's admin access can't accidentally affect their availability invitations.

Managing this list is a manual AWS CLI operation for v1 (`put-item`/`delete-item`), the same way `TeamMembers` is managed today — no self-service UI for granting access, at least not initially, given how small and slow-changing this list is.

## Login flow — email + one-time code

1. Admin panel shows a single field: email.
2. Frontend calls `POST /admin/login/request` with that email.
3. Backend checks `AdminAllowlist`. If present, generates a 6-digit numeric code, stores a **hash** of it in a new `AdminLoginCodes` table (PK: `email`, fields: `codeHash`, `expiresAt`, `attempts`), and emails it via SES using the same branded template shell already built for invitation/reminder/summary emails. If the email isn't on the allowlist, the response is identical either way ("if that email has access, a code was sent") — this avoids leaking who's on the allowlist to someone probing the form.
4. Admin types the 6-digit code into the same page (not a clickable link — staying on one device/tab avoids the "clicked the link on my phone but I was signed in on my laptop" confusion that affects the player magic-link flow).
5. Frontend calls `POST /admin/login/verify` with `{ email, code }`. Backend checks the hash, checks expiry (~10 minutes) and an attempt counter (lock out after 5 wrong tries), then issues an opaque session token — stored hashed in a new `AdminSessions` table (PK: `sessionTokenHash`, fields: `email`, `expiresAt`), mirroring exactly how player invitation tokens already work in `matchAvailabilityRepository.ts`.
6. Frontend keeps the raw session token in memory / `sessionStorage` and sends it as `Authorization: Bearer <token>` on every subsequent admin API call. Every admin endpoint looks up the hash, checks expiry, and 401s if missing/expired — same trust model already in place for `findByTokenHash`.
7. Session lifetime: something like 12–24 hours, after which they just request a fresh code. No "remember me", no refresh tokens — keeps the surface area small.

Rate limiting worth calling out: cap code requests per email (e.g. 1 per minute, 5 per hour) so the form can't be used to spam someone's inbox.

## What the panel shows

- A list of matches (derive from existing `MatchAvailability` items grouped by `matchId` — opponent, date, time, ground already live on each invitation record; no new "Matches" entity needed).
- Per match, a live breakdown identical in spirit to the final-summary email, but queryable any time (including before the deadline, which the email can't do): counts for Available / Unavailable / Maybe / No response, and a table of every invited player with their status, comments, and last-updated timestamp.

## New backend surface (same SAM stack, new routes — not a new stack)

- `POST /admin/login/request`
- `POST /admin/login/verify`
- `GET /admin/matches` (requires session)
- `GET /admin/matches/{matchId}` (requires session)

These are new Lambda handlers added to the existing `backend/` service, reusing `createSesClient`, the email template module, and the existing `MatchAvailabilityTable`. No new SES identity, no new domain, no new CI/CD pipeline — it rides on the infrastructure that's already deployed and verified.

## New frontend surface (new, isolated page)

- `src/pages/admin/index.astro` — new page, own `<head>`, own stylesheet (`src/styles/admin.css`), does **not** import `global.css` or the GA snippet — same isolation `respond.astro` already follows.
- A new React island, e.g. `AdminPanel`, rendered `client:load` from that page only.
- A new `src/services/adminApi.ts` — calls the four endpoints above. Nothing outside `src/pages/admin/` and this new component tree imports it, and it does not import from or get imported by `availabilityApi.ts` — same hard boundary the existing MVP doc already establishes between the respond flow and everything else.
- The main site (`index.astro`, `TeamDashboard.tsx`) is untouched — adding a new static route doesn't affect the existing build, bundle, or deploy in any way.

## Non-goals for v1

- No self-service allowlist management UI (CLI only).
- No password/OAuth login.
- No push notifications to the panel — it's pull/refresh only.
- No editing of availability from the panel (read-only; players still respond only via their own magic link).

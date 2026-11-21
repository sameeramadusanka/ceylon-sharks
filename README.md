# Ceylon Sharks Cricket Dashboard

A responsive cricket club website built with Astro, React, and TypeScript. It's two independent parts: a statically generated dashboard presenting Ceylon Sharks' season results, squad, statistics, history, and records in a broadcast-inspired interface, and a separate match-availability tool backed by a small serverless AWS backend.

## Features

### Main dashboard (static, no backend)

- Home, Statistics, Matches, Squad, History, and Records sections
- Season and division selection for match results, player roster, and statistics; the newest available September season is selected by default when present
- Season performance metrics and charts derived from the selected results
- Match filtering by format and result, with scorecard details where scorecard data is available
- Upcoming fixture selection based on schedule dates and times
- Player profile dialogs with batting, bowling, and fielding statistics
- Captain and vice-captain cards kept first, followed by the remaining players alphabetically by name
- Record Book tabs for the two newest available seasons
- Responsive navigation, match filters, history image carousel, and collapsible history timeline
- Facebook link in the footer
- Favicon and Open Graph/Twitter social preview metadata using images in `public/brand/`
- Static output with no backend or database of its own

### Match availability & admin (separate AWS backend)

A player-facing page and a captain/vice-captain admin panel, deployed and run completely independently of the dashboard above — see [Match Availability & Admin](#match-availability--admin) below.

- Players confirm availability for upcoming matches via a one-time emailed link, no account required
- Automatic daily invitations, reminders, and a closing summary email, scheduled per match
- Captain/vice-captain admin panel: passwordless sign-in via a one-time emailed code, view every match's responses
- No passwords anywhere; secret links and sign-in codes are hashed, never stored in readable form

## Tech Stack

**Main dashboard**

- Astro with the React integration
- React and TypeScript
- Lucide React icons
- Custom CSS
- Local JSON and image assets

**Availability backend** (see [backend/README.md](backend/README.md) for detail)

- AWS Lambda (Node.js + TypeScript), one function per action
- Amazon DynamoDB, Amazon API Gateway (HTTP API), Amazon SES, Amazon EventBridge Scheduler
- AWS SAM for infrastructure as code (`infrastructure/`)
- Zod for request validation, Vitest for tests

## Project Structure

```text
src/
  components/
    ScorecardModal.tsx
    TeamDashboard.tsx
    admin/
      AdminPanel.tsx
    availability/
      AvailabilityResponse.tsx
  data/
    history.json
    matches.json
    players.json
    site.json
    team.json
  pages/
    index.astro
    availability/
      respond.astro
  services/
    adminApi.ts
    availabilityApi.ts
  styles/
    global.css
    scorecard.css
    availability.css
public/
  brand/
  players/
  score_cards/
  season_results/
  season_statistics/
  upcoming_schedules/
backend/        # availability/admin API - see backend/README.md
infrastructure/ # AWS SAM template for the backend above
```

`src/components/TeamDashboard.tsx` contains the interactive dashboard. `src/pages/index.astro` loads the local data and defines document and social metadata. Site text and shared settings are in `src/data/site.json`; team details are in `src/data/team.json`. Global styles are in `src/styles/global.css`, with scorecard-specific styles in `src/styles/scorecard.css`.

`src/pages/availability/respond.astro` and `src/components/admin/AdminPanel.tsx` are a separate page and admin panel for the match-availability feature, with their own stylesheet (`src/styles/availability.css`) and their own API clients (`src/services/availabilityApi.ts`, `src/services/adminApi.ts`). They never import anything from the dashboard above, and the dashboard never imports from them — see [Match Availability & Admin](#match-availability--admin).

## Season Data

Season data is read recursively from `public/`. The active naming convention includes the season and division, for example:

```text
public/players/2026_MAY_SUPREME_DIVISION/
public/season_results/2026_MAY_SUPREME_DIVISION/
public/season_statistics/2026_MAY_SUPREME_DIVISION/
public/score_cards/2026_MAY_SUPREME_DIVISION/

public/players/2026_SEPTEMBER_SUPREME_DIVISION/
public/season_results/2026_SEPTEMBER_SUPREME_DIVISION/
public/season_statistics/2026_SEPTEMBER_SUPREME_DIVISION/
public/score_cards/2026_SEPTEMBER_SUPREME_DIVISION/
```

The Matches season selector updates the results, roster, and season statistics together. It defaults to the newest available September season, falling back to the first available season if no September season exists. The Record Book selects its two newest seasons independently, ordered by year and season month.

When adding a season, provide matching results, player, and statistics files using the conventions and JSON shapes already present. Scorecards and upcoming schedules are optional; add them under their corresponding directories when available.

## Data and Brand Assets

- `public/players/` — season rosters
- `public/season_results/` — season match results
- `public/season_statistics/` — batting, bowling, and fielding statistics
- `public/score_cards/` — detailed match scorecards
- `public/upcoming_schedules/` — scheduled fixtures
- `src/assets/history_images/` — images for the History carousel
- `src/assets/banner_images/` — hero banner images
- `src/assets/ground_images/` — fallback ground image
- `src/assets/player_images/` — player photos, named `{playerId}.png` or `.jpg`
- `src/assets/player_of_the_week/{season}/` — Player of the Week posters and details

Images under `src/assets/` are resized and compressed automatically at build time, so add full-size originals there. Only the compressed copies are published.
- `public/brand/favicon.png` — browser favicon
- `public/brand/Open-graph-image.png` — Open Graph and Twitter share image

History timeline copy is maintained in `src/data/history.json`. Other static fallback data is in `src/data/`.

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev -- --host 0.0.0.0
```

Open `http://localhost:4321/` in a browser.

## Validation and Build

Run Astro and TypeScript diagnostics:

```bash
npm run check
```

Build the static site into `dist/`:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview -- --host 0.0.0.0
```

## Match Availability & Admin

A second, independently deployed feature lives alongside the dashboard:

- **Players** get a one-time emailed link to confirm availability for an upcoming match (`/availability/respond`) — no account needed. Invitations, reminders, and a closing summary email are sent automatically on a daily schedule.
- **Captain/vice-captain** sign in to an admin panel (`/admin`) with a one-time 6-digit emailed code (no password) to see every match's responses.
- The backend (`backend/`) is AWS Lambda + DynamoDB + API Gateway + SES + EventBridge, defined as code in `infrastructure/` and deployed separately by `.github/workflows/deploy-availability.yml`. It shares no code, no page, and no deployment with the dashboard above — see `CLAUDE.md` for why that boundary is deliberate.
- See [backend/README.md](backend/README.md) for backend setup, local development, and deployment; `backend/docs/operations.md` for the operational runbook.

## Deployment

The dashboard is deployed to GitHub Pages by `.github/workflows/deploy.yml` when changes are pushed to the `main` branch, or when the workflow is manually triggered. The workflow installs dependencies, runs `npm run check` and `npm run build`, then publishes `dist/`.

The availability backend is deployed separately by `.github/workflows/deploy-availability.yml` on pushes to `main` that touch `backend/` or `infrastructure/`; see [backend/README.md](backend/README.md) for details.

To deploy the dashboard manually to another static host, publish the contents of `dist/` after a successful production build.
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                      # install dependencies
npm run dev -- --host 0.0.0.0    # dev server at http://localhost:4321/
npm run check                    # Astro + TypeScript diagnostics (also run in CI before build)
npm run build                    # production build into dist/
npm run preview -- --host 0.0.0.0  # preview the production build locally
```

There is no test suite and no lint/format script configured. `npm run check` is the only automated correctness gate, and CI (`.github/workflows/deploy.yml`) runs it before `npm run build` on every push to `main`. It deploys `dist/` to GitHub Pages — there is no separate staging environment.

## Architecture

This is a fully static Astro + React + TypeScript site (**Ceylon Sharks Cricket Dashboard**) with no backend, database, or API — all content is local JSON and static images baked in at build time.

### Main site: single-page, data-driven-at-build-time

`src/pages/index.astro` is the main site's homepage. In its frontmatter it walks `public/` recursively with `readdirSync`/`readFileSync` (Node `fs`, build-time only) to discover season data purely from **filename convention** — there is no manifest file listing which seasons/files exist. It then passes everything as props into one React island, `TeamDashboard`, rendered with `client:load` (the entire UI is one hydrated component, not multiple islands).

### Player of the Week: homepage section + share pages

Posters live in per-season folders under `src/assets/player_of_the_week/`, named exactly like the season's other data folders (e.g. `src/assets/player_of_the_week/2026_SEPTEMBER_SUPREME_DIVISION/`). They're under `src/`, not `public/`, so Astro's image pipeline resizes/compresses them:

- `{YYYY-MM-DD}__{playerId}.jpg` — the designed 9:16 poster
- `{YYYY-MM-DD}__{playerId}.json` — `playerName`, `opponent` (required), `competition`, `batting`, `bowling`, `fielding`, `caption` (optional)
- `{YYYY-MM-DD}__{playerId}__share.jpg` — optional wide (1200x630) link-preview image; the poster is used otherwise

`src/lib/playerOfTheWeek.ts` loads them at build time (newest first) and, unlike the season-data matchers, **throws** on a misnamed image, a file outside a season folder, a poster without its `.json`, or two winners on one date — so a mistake fails `npm run build` instead of silently disappearing. `TeamDashboard` filters entries to the season selected in its season picker and renders the newest with `PlayerOfTheWeekSection`; if that season has no winners, the section and its nav link are hidden. Each entry also gets a static share page at `/player-of-the-week/{date}/` (plus `/player-of-the-week/` for the latest), rendered by `PlayerOfTheWeekPage.astro` with per-winner Open Graph/Twitter tags so social media links preview the poster. Those pages link back into the homepage with `?scorecard={date}` / `?player={id}` / `#section`, which `TeamDashboard` handles on load. Google Analytics lives in `GoogleAnalytics.astro`, shared by the homepage and these pages.

### Availability feature: a second, independent page

`src/pages/availability/respond.astro` is a separate page for the match-availability feature described in `ceylon-sharks-availability-mvp.md` (implementation under `backend/`, deployed independently to AWS — see that doc and `backend/README.md`). It renders its own `AvailabilityResponse` React island (`src/components/availability/`), calls the backend via `src/services/availabilityApi.ts`, and has its own stylesheet (`src/styles/availability.css`) and its own `<head>` — it does **not** import `global.css` or the Google Analytics snippet from `index.astro`. `src/env.d.ts` types the `PUBLIC_AVAILABILITY_API_BASE_URL` env var (not a secret; falls back to the deployed stack's API Gateway URL if unset). No other page or component may import from `services/availabilityApi.ts` — that boundary is the whole point of the independence design in the plan doc.

### Filename conventions (critical — breaks silently if not followed)

Data lives in per-season subfolders under `public/`, named e.g. `2026_SEPTEMBER_SUPREME_DIVISION/`. Within each, filenames are parsed with regex in `index.astro` to extract season/division/year/type:

- `public/players/{season}/{SEASON}__PLAYERS__{YEAR}.json`
- `public/season_results/{season}/{SEASON}__RESULTS__{YEAR}.json`
- `public/season_statistics/{season}/{SEASON}__{BATTING|BOWLING|FIELDING}__{YEAR}.json`
- `public/score_cards/{season}/{SEASON}__MATCH-{N}__{YYYY-MM-DD}.json`
- `public/upcoming_schedules/*.json` — any `.json`, shape `{ matches: [...] }`, not season-scoped
- `public/banner_images/optimized/`, `public/history_images/`, `public/ground_images/`, `public/player_images/{playerId}.ext` — plain image folders, sorted alphabetically, no manifest

Each matcher also accepts a legacy double-segment form (`{SEASON}__{DIVISION}__...`) alongside the modern single-segment form — both regex variants are tried. When adding a new season, follow the existing naming exactly; a misnamed file is silently excluded rather than erroring.

The September season is selected by default in `TeamDashboard` (falls back to the first available season); the two most recent seasons (sorted by year, then by month parsed out of the season name) are used for the Records tabs independently of the main season selector.

### Data flow: JSON → parsed domain model → UI

`TeamDashboard.tsx` (the whole UI — hero, snapshot stats, performance chart, match list/filters, squad grid, player modal, history timeline, records) does its own parsing of the raw season JSON on the client:

- `parsePlayers` joins the players file against the three statistics files (batting/bowling/fielding) by player name, derives captain/vice-captain ordering from a `role` field, and always sorts captain → vice-captain → alphabetical.
- `parseMatches` parses a free-text `result`/`scoreSummary` string (e.g. `"Ceylon Sharks won by 12 runs"`, `"Team: 184/6(20.0)"`) with regex to derive win/loss/margin — there is no structured result field in the source JSON.
- `site.json` holds essentially all UI copy, labels, and config (nav items, section headings, templated strings like `{team}`/`{nickname}`, stat definitions, filter options) — `team.json` holds club identity. Prefer editing `site.json`/`team.json` over hardcoding strings in JSX.
- The "Season Performance" chart is a hand-rolled bar chart (no charting library), despite `project_plan.md` describing Apache ECharts — treat `project_plan.md` as an early aspirational plan, not a description of the current implementation (it even refers to the club as "Titan CC" and assumes Tailwind CSS; neither is true of the actual code).

`assetPath()` in `TeamDashboard.tsx` prefixes all image/logo paths with `import.meta.env.BASE_URL` — needed because the production `site` in `astro.config.mjs` serves from a custom domain, but this helper must still be used for any new image reference to behave correctly if the base path ever changes.

### Styling

Plain CSS, no framework: `src/styles/global.css` (layout/sections) and `src/styles/scorecard.css` (scorecard modal, imported directly by `TeamDashboard.tsx`). Class names are hand-written BEM-ish (`match-card--interactive`, `player-card--captain`), not utility classes.

### Adding a new feature that needs a backend

`ceylon-sharks-availability-mvp.md` (if present) specifies a planned match-availability feature as a strict architectural boundary: the static site must keep building/deploying without any backend dependency. Any new backend-requiring feature should follow that pattern — an independent deployment unit under something like `backend/`, with its own GitHub Actions workflow, called only from a dedicated page, never from the existing homepage/season/player/stats components.

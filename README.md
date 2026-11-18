# Ceylon Sharks Cricket Dashboard

A responsive, statically generated cricket club website built with Astro, React, and TypeScript. It presents Ceylon Sharks' season results, squad, statistics, history, and records in a broadcast-inspired interface.

## Features

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
- Static output with no backend or database

## Tech Stack

- Astro with the React integration
- React and TypeScript
- Lucide React icons
- Custom CSS
- Local JSON and image assets

## Project Structure

```text
src/
  components/
    ScorecardModal.tsx
    TeamDashboard.tsx
  data/
    history.json
    matches.json
    players.json
    site.json
    team.json
  pages/
    index.astro
  styles/
    global.css
    scorecard.css
public/
  banner_images/optimized/
  brand/
  ground_images/
  history_images/
  player_images/
  players/
  score_cards/
  season_results/
  season_statistics/
  upcoming_schedules/
```

`src/components/TeamDashboard.tsx` contains the interactive dashboard. `src/pages/index.astro` loads the local data and defines document and social metadata. Site text and shared settings are in `src/data/site.json`; team details are in `src/data/team.json`. Global styles are in `src/styles/global.css`, with scorecard-specific styles in `src/styles/scorecard.css`.

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
- `public/history_images/` — images for the History carousel
- `public/banner_images/optimized/` — hero banner images
- `public/ground_images/` — fallback ground image
- `public/player_images/` — player photos
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

## Deployment

The site is deployed to GitHub Pages by `.github/workflows/deploy.yml` when changes are pushed to the `main` branch, or when the workflow is manually triggered. The workflow installs dependencies, runs `npm run check` and `npm run build`, then publishes `dist/`.

To deploy manually to another static host, publish the contents of `dist/` after a successful production build.
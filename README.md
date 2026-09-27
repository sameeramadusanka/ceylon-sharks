# Ceylon Sharks Cricket Dashboard

A responsive, static cricket club website built with Astro, React, and TypeScript. The site is designed to showcase the club story, current season, upcoming fixtures, squad, match records, and player statistics in a premium broadcast-style interface.

## Highlights

- Dynamic season switching across multiple datasets
- Current-season results and statistics from local JSON files
- Upcoming fixture logic based on the current date and scheduled match time
- Player cards with modal detail views and season stats
- Scorecard modal rendering for recent matches
- Collapsible milestone timeline in the History section
- Fully static deployment with no backend or database required

## Tech Stack

- Astro
- React
- TypeScript
- Lucide React icons
- Custom CSS
- Local static JSON and image assets

## Project Structure

```text
src/
  components/
    TeamDashboard.tsx
    ScorecardModal.tsx
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
  banner_images/
  brand/
  ground_images/
  player_images/
  players/
  score_cards/
  season_results/
  season_statistics/
  upcoming_schedules/
```

## Season Naming and Data Shape

The project supports both legacy and modern season naming conventions, but the active structure uses the division-based format below:

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

The app loads season files recursively and normalizes them so the selected dataset updates the dashboard, form, matches, statistics, and rider context without hardcoded season IDs.

## Data Sources

The site reads structured JSON from the `public/` folder:

- `players/*` — player roster information
- `season_results/*` — match results and season metadata
- `season_statistics/*` — batting, bowling, and fielding metrics
- `score_cards/*` — detailed scorecard JSON for each match
- `upcoming_schedules/*` — future fixture data used for date-aware next match selection

## Local Development

### Requirements

- Node.js 18+
- npm

### Install dependencies

```bash
npm install
```

### Start the dev server

```bash
npm run dev -- --host 0.0.0.0
```

The app is available at:

```text
http://localhost:4321/
```

## Validation and Build

Run code and Astro diagnostics:

```bash
npm run check
```

Generate the production build:

```bash
npm run build
```

Preview the build locally:

```bash
npm run preview -- --host 0.0.0.0
```

## Deployment

This is a static Astro site and can be deployed to any static hosting provider.

### Typical static deployment flow

```bash
npm install
npm run check
npm run build
```

Then publish the generated `dist/` folder to your hosting provider.

## Notes

- The site is intentionally data-driven and does not rely on a backend service.
- The History section uses a collapsible timeline so milestone entries stay compact on first load and expand for detail.
- Upcoming match selection uses the current date and scheduled time to highlight the correct fixture.
- The project has been updated to align May and September season data shapes so scorecards and stats render consistently.

## Useful Commands

```bash
npm run dev -- --host 0.0.0.0
npm run check
npm run build
npm run preview -- --host 0.0.0.0
```

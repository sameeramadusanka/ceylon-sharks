# Ceylon Sharks Cricket Dashboard

A responsive, static cricket club website built with Astro, React, and TypeScript. The site showcases Ceylon Sharks' season performance, matches, squad, club history, and records in a premium broadcast-style interface.

## Highlights

- Navigation sections in this order: Home, Statistics, Matches, Squad, History, Records
- Season/division switching for the match centre, results, player roster, and season statistics
- Current and previous season record-book tabs, calculated from each season's match data
- Season performance charts and summary metrics derived from the selected results dataset
- Upcoming fixture logic based on the current date and scheduled match time
- Player cards with modal profile details and batting, bowling, and fielding statistics
- Interactive scorecard modals for matches with scorecard data
- History section with a responsive title/description intro, page-width image carousel, and collapsible milestone timeline
- Responsive mobile navigation, match filters, and accessible tab controls
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
    optimized/
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

`src/components/TeamDashboard.tsx` renders the interactive dashboard, while `src/data/site.json` contains navigation labels, section copy, and other site configuration. `src/styles/global.css` and `src/styles/scorecard.css` provide the site and scorecard styling.

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

The app loads season files recursively and normalizes them so the selected dataset updates the dashboard, form, matches, player roster, and season statistics without hardcoded season IDs. The Record Book independently selects the two newest available seasons and provides Current season and Previous season tabs, so it remains usable regardless of the season selected in Matches. The History carousel and timeline use the content under `public/history_images/` and `src/data/history.json`, respectively.

## Data Sources

The site reads structured JSON from the `public/` folder:

- `players/*` — player roster information
- `season_results/*` — match results and season metadata
- `season_statistics/*` — batting, bowling, and fielding metrics
- `score_cards/*` — detailed scorecard JSON for each match
- `upcoming_schedules/*` — future fixture data used for date-aware next match selection
- `history_images/*` — images shown by the History carousel
- `banner_images/optimized/*` — optimized hero-banner carousel images
- `ground_images/*` — fallback ground image
- `brand/*` — club branding assets

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
- The History section presents its title and description side by side on wider screens, followed by a page-width image carousel and collapsible, full-width milestone timeline. The layout stacks on smaller screens.
- The Record Book compares the two most recent season datasets, ordered by year and season month, with separate tabs for each.
- Upcoming match selection uses the current date and scheduled time to highlight the correct fixture.
- The project includes May and September Supreme Division 2026 data. Add matching season files under the corresponding directories to make additional seasons available.

## Useful Commands

```bash
npm run dev -- --host 0.0.0.0
npm run check
npm run build
npm run preview -- --host 0.0.0.0
```

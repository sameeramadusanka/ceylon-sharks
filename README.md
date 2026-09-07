# Ceylon Sharks Cricket Dashboard

The Ceylon Sharks Cricket Dashboard is a responsive, static cricket team website built with Astro, React, and TypeScript. It presents the team's identity, current season results, squad, player profiles, scorecards, statistics, records, and match information in a broadcast-inspired interface.

The site is intentionally data-driven and does not require a backend, database, authentication, or live-score service. Content is stored in local JSON files and images are served from `public/`.

## Technology

- Astro static site generation
- React and TypeScript for interactive dashboard components
- Lucide React icons
- Local JSON data and image assets
- Responsive CSS with season-aware filtering

## Project Structure

```text
src/
  components/       React dashboard components
  data/             Team and site configuration
  pages/            Astro pages and data loading
  styles/           Global styles
public/
  players/{season}/
  season_results/{season}/
  season_statistics/{season}/
  score_cards/{season}/
  player_images/
  banner_images/
  ground_images/
  brand/
```

Season folders use the season identifier from the source filenames. For example, the current season is stored under `26_T3_MAY`, not `2026`:

```text
public/players/26_T3_MAY/
public/season_results/26_T3_MAY/
public/season_statistics/26_T3_MAY/
public/score_cards/26_T3_MAY/
```

To add another season, create the matching folder under each applicable data directory and add the season's JSON files. The Astro loader discovers nested files recursively.

## Requirements

- Node.js 18 or newer
- npm

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The site is available at `http://localhost:4321/`.

To allow access from another device on the local network:

```bash
npm run dev -- --host 0.0.0.0
```

## Validation

Run the Astro type and component checks:

```bash
npm run check
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

This project builds as a static site. The production output is generated in `dist/`.

1. Install dependencies and run the checks:

   ```bash
   npm ci
   npm run check
   npm run build
   ```

2. Deploy the contents of `dist/` to a static hosting provider such as Netlify, Vercel, GitHub Pages, or an Nginx web server.
2. Deploy the contents of `dist/` to a static hosting provider such as Netlify, Vercel, GitHub Pages, or an Nginx web server.

3. Configure the hosting provider to serve `dist/index.html` for the site root. No server-side runtime or database is required.

For a direct static-server deployment, copy the generated output to the web root:

```bash
rsync -av --delete dist/ user@server:/var/www/ceylon-sharks/
```

After changing JSON data, images, or source code, run `npm run check` and `npm run build` again, then redeploy the refreshed `dist/` directory.

### GitHub Pages with GitHub Actions

The repository includes `.github/workflows/deploy.yml`. Every push to `main` runs the checks, builds the Astro site, uploads `dist/`, and deploys it to GitHub Pages.

Enable Pages once in the GitHub repository:

1. Open **Settings > Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main` or run the **Deploy Astro site to GitHub Pages** workflow manually from the **Actions** tab.

The site will be available at `https://sameeramadusanka.github.io/ceylon-sharks/` after the workflow completes.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run check` | Run Astro diagnostics |
| `npm run build` | Generate the static production site |
| `npm run preview` | Preview the production build |

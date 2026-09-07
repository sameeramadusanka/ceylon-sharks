# 🏏 Cricket Team Website — Astro + React Implementation Plan

## 1. Project Overview

Build a futuristic, interactive, informative single-page website for a cricket team.

### Primary Goals

- Showcase the cricket team
- Present team identity and history
- Display current season performance
- Showcase players
- Display matches and results
- Present team and player statistics
- Highlight records and achievements
- Create a premium cricket-broadcast-inspired experience
- Keep the application fully static for the first version

---

# 2. Technology Stack

## Frontend

- Astro
- React
- TypeScript

## Styling

- Tailwind CSS
- CSS animations
- CSS gradients
- Glassmorphism where appropriate

## Data Visualization

- Apache ECharts

## Icons

- Lucide

## Data

- Local JSON files

## Images

- WebP / AVIF

---

# 3. Current Scope

## Features to Build

- [ ] Futuristic landing/hero section
- [ ] Team information
- [ ] Current season overview
- [ ] Team statistics
- [ ] Current form
- [ ] Upcoming match
- [ ] Recent matches
- [ ] Squad
- [ ] Player profiles
- [ ] Player statistics
- [ ] Batting statistics
- [ ] Bowling statistics
- [ ] Team analytics
- [ ] Home vs Away analysis
- [ ] Head-to-head
- [ ] Team records
- [ ] Trophy cabinet
- [ ] Team history
- [ ] Responsive design
- [ ] Animations
- [ ] SEO
- [ ] Accessibility

## Not Required in Version 1

- [ ] Backend
- [ ] Database
- [ ] REST APIs
- [ ] Authentication
- [ ] Admin panel
- [ ] Live scores
- [ ] Ball-by-ball commentary
- [ ] Full cricket scorecards
- [ ] Partnership analysis
- [ ] Live match tracking
- [ ] AI cricket analysis

---

# 4. Website Structure

```text
Navbar
   ↓
Hero
   ↓
Team Snapshot
   ↓
Current Form
   ↓
Season Performance
   ↓
Next Match
   ↓
Recent Matches
   ↓
Squad
   ↓
Player Spotlight
   ↓
Team Analytics
   ↓
Head-to-Head
   ↓
Records
   ↓
Trophy Cabinet
   ↓
Team History
   ↓
Footer
```

## 5. Navigation
Navigation items:
Home
Matches
Squad
Statistics
Records
History
Desktop
LOGO | HOME | MATCHES | SQUAD | STATS | RECORDS | HISTORY
Mobile
LOGO                              ☰
Interaction
Sticky navigation
Transparent at top
Glass/dark background after scrolling
Active section indicator
Smooth scrolling
## 6. Hero Section
Purpose
Immediately communicate:
Team identity
Cricket
Current season
Team strength
Content
CRICKET CLUB

TITAN
CRICKET CLUB

BUILT FOR THE BIG MOMENTS

18 WINS
5 LOSSES
1 NR

RANK #02
26_T3_MAY SEASON
Visual
Use:
Cricket stadium
Player silhouette
Team photograph
Stadium lights
Cricket pitch
Design
Dark background
Team colors
Large typography
Gradient lighting
Subtle grid
Stadium atmosphere
## 7. Team Snapshot
Display major statistics.
MATCHES       24

WINS          18

LOSSES         5

WIN RATE      75%
Additional statistics:
AVG SCORE
218

HIGHEST SCORE
246

AVG RUN RATE
8.4

TOTAL WICKETS
176
## 8. Season Selector
Allow users to change seasons.
SEASON

[ 2026 ▼ ]
Possible seasons:
2026
2025
2024
2023
Changing the season should update:
Team statistics
Matches
Form
Player statistics
Charts
## 9. Format Selector
Only show this if the team participates in multiple formats.
[ ALL ] [ T20 ] [ ODI ] [ TEST ]
Use React for interaction.
## 10. Current Form
Display the team's latest results.
CURRENT FORM

W   W   W   L   W   W   L   W
Use:
W = Win
L = Loss
D = Draw
NR = No Result
Add subtle animations when the section enters the viewport.
## 11. Season Performance
Create a major analytics section.
Controls
[ FORM ]
[ RUNS ]
[ WICKETS ]
[ WIN RATE ]
Chart
Use Apache ECharts.
Example:
Runs
250 ┤             ╭──╮
200 ┤       ╭─────╯  ╰─
150 ┤   ╭───╯
100 ┤───╯
    └────────────────────
       MATCHES
Hovering over a match should show:
MATCH 18

TITAN CC
214/7

RESULT
WIN
## 12. Performance Cards
Display:
BEST WINNING STREAK
7 MATCHES

AVG TEAM SCORE
218

HIGHEST SCORE
246

AVG RUN RATE
8.4
## 13. Next Match
Make the next fixture visually prominent.
NEXT MATCH

TITAN CC

        VS

EAGLES CC

19 SEP 2026
19:30

TITAN CRICKET GROUND
Display:
Competition
Date
Time
Venue
Opponent
Team ranking
Opponent ranking
## 14. Match Preview
Show lightweight match information.
TEAM FORM

TITAN
W W W L W

EAGLES
W L W W W
Head-to-head:
LAST 10 MATCHES

TITAN
6 WINS

EAGLES
4 WINS
Key player:
KEY PLAYER

ALEX MORGAN

1,240 RUNS
48.2 AVG
137.6 SR
## 15. Recent Matches
Create a horizontal match carousel.
Example:
┌──────────────────────────┐
│ T20 • MATCH 24           │
│                          │
│ TITAN CC      184/6      │
│                          │
│ EAGLES CC     172/8      │
│                          │
│ WON BY 12 RUNS            │
│ 18 SEP 2026              │
└──────────────────────────┘
## 16. Match Filters
Filters:
RESULT

[ ALL ]
[ WINS ]
[ LOSSES ]
[ NO RESULT ]

FORMAT

[ T20 ▼ ]

SEASON

[ 2026 ▼ ]
Filtering should happen without page reload.
Use React state.
## 17. Lightweight Match Details
Clicking a match can open a modal/panel.
Display:
TITAN CC 184/6
EAGLES CC 172/8

TITAN WON BY 12 RUNS

VENUE
Titan Cricket Ground

TOP BATTER
Alex Morgan — 72

TOP BOWLER
James Lee — 3/31
Do not include full scorecards in Version 1.
## 18. Squad Section
Create a visually rich player section.
THE SQUAD

BATTERS
────────────────

ALL-ROUNDERS
────────────────

WICKETKEEPERS
────────────────

BOWLERS
────────────────
## 19. Player Cards
Each card should show:
PLAYER IMAGE

#10

ALEX MORGAN

BATTER

1,240 RUNS
48.2 AVG
137.6 SR
Hover Interaction
Image zoom
Statistics reveal
Accent border
Player number animation
Click Interaction
Open player profile modal.
## 20. Player Profile
Display:
Personal Information
Name
Shirt number
Role
Batting style
Bowling style
Age
Nationality
Batting Statistics
Matches
Innings
Runs
Average
Strike rate
Highest score
50s
100s
Fours
Sixes
Bowling Statistics
Matches
Overs
Wickets
Average
Economy
Best figures
Only display relevant statistics depending on player role.
## 21. Player Spotlight
Highlight the team's most important player.
PLAYER OF THE SEASON

#10

ALEX MORGAN

1,240 RUNS

48.2 AVG
137.6 SR

TOP SCORE
112*
Use:
Large player image
Large typography
Statistics
Team colors
Dramatic background
## 22. Batting Statistics
Create a dedicated batting analytics section.
BATTING

TOTAL RUNS
4,821

AVG SCORE
218

HIGHEST SCORE
246

BOUNDARIES
542
Batting Leaders
PLAYER             RUNS    AVG     SR

Alex Morgan        1240    48.2   137.6
James Silva        1102    42.6   129.4
Daniel Kim          842    38.3   126.2
## 23. Bowling Statistics
Display:
BOWLING

WICKETS
176

ECONOMY
7.41

DOT BALL %
38%

BEST BOWLING
7/24
Bowling Leaders
PLAYER             WKTS    AVG     ECO

James Lee            32    21.4    7.2
Daniel Kim           28    23.1    7.5
Michael Tan          24    25.2    7.8
## 24. Team Analytics
Display important performance metrics.
WIN RATE
75%

AVG SCORE
218

AVG RUN RATE
8.4

WICKETS / MATCH
7.3

AVG WICKETS LOST
6.2

BOUNDARIES / MATCH
24
Use cards and charts.
## 25. Home vs Away
Create a comparison.
              HOME      AWAY

MATCHES        12        12

WINS            9         9

LOSSES          2         3

WIN RATE       75%       75%

AVG SCORE      226       210
Visualize using comparison bars.
## 26. Venue Statistics
Show important home-ground statistics.
TITAN CRICKET GROUND

MATCHES PLAYED
42

WINS
31

LOSSES
9

AVG FIRST INNINGS
184

HIGHEST TEAM SCORE
246
## 27. Head-to-Head
Allow the user to select an opponent.
HEAD TO HEAD

[ EAGLES CC ▼ ]
Display:
TOTAL MATCHES
18

TITAN WINS
10

EAGLES WINS
8
Show recent meetings below.
## 28. Records
Create a premium "Record Book" section.
Team Records
Highest score
Lowest score
Biggest win by runs
Biggest win by wickets
Highest successful chase
Longest winning streak
Player Records
Most runs
Most wickets
Highest individual score
Best bowling figures
Most sixes
Most appearances
## 29. Trophy Cabinet
Create a visual trophy section.
🏆

2026 CHAMPIONS

NATIONAL T20 CUP
Each trophy card contains:
Competition
Year
Result
Final opponent
Optional player of the final
## 30. Team History
Create a vertical timeline.
2005
●
TEAM FOUNDED

2010
●
FIRST MAJOR TROPHY

2016
●
FIRST TOP-DIVISION SEASON

2022
●
RECORD WINNING STREAK

2026
●
CURRENT ERA
Clicking an event can expand additional information.
## 31. Final CTA / Closing Section
End the page with a strong cricket identity.
EVERY RUN.
EVERY WICKET.
EVERY MOMENT.

THIS IS OUR STORY.

TITAN CRICKET CLUB
Use:
Stadium background
Team colors
Large typography
Subtle motion
## 32. Footer
TITAN CRICKET CLUB

HOME
MATCHES
SQUAD
STATISTICS
RECORDS
HISTORY

© 2026 Titan Cricket Club
## 33. Astro Component Architecture
Use Astro for mostly static components.
src/components/astro/

Navbar.astro
Hero.astro
TeamSnapshot.astro
CurrentForm.astro
NextMatch.astro
MatchCard.astro
PlayerCard.astro
Records.astro
TrophyCabinet.astro
History.astro
Footer.astro
## 34. React Component Architecture
Use React only for interactive components.
src/components/react/

SeasonSelector.tsx
FormatSelector.tsx
MatchFilters.tsx
PlayerProfile.tsx
HeadToHead.tsx
PerformanceChart.tsx
BattingChart.tsx
BowlingChart.tsx
HistoryExplorer.tsx
## 35. Data Structure
Use local JSON.
src/data/

team.json
seasons.json
players.json
matches.json
statistics.json
venues.json
records.json
history.json
Keep data separate from UI components.
## 36. Example Team Data
{
  "name": "Titan Cricket Club",
  "shortName": "Titan CC",
  "nickname": "The Titans",
  "founded": 2005,
  "stadium": "Titan Cricket Ground",
  "league": "National T20 Championship",
  "logo": "/images/team/logo.webp"
}
## 37. Example Player Data
{
  "id": 10,
  "name": "Alex Morgan",
  "number": 10,
  "role": "BATTER",
  "battingStyle": "Right Hand",
  "bowlingStyle": null,
  "image": "/images/players/alex.webp",
  "statistics": {
    "matches": 28,
    "runs": 1240,
    "average": 48.2,
    "strikeRate": 137.6,
    "highestScore": 112,
    "fifties": 8,
    "hundreds": 3,
    "fours": 96,
    "sixes": 41
  }
}
## 38. Example Match Data
{
  "id": 24,
  "format": "T20",
  "competition": "National T20 Cup",
  "date": "2026-09-18",
  "venue": "Titan Cricket Ground",
  "opponent": "Eagles CC",
  "teamScore": "184/6",
  "opponentScore": "172/8",
  "result": "WIN",
  "margin": "12 runs",
  "topBatter": {
    "name": "Alex Morgan",
    "score": "72"
  },
  "topBowler": {
    "name": "James Lee",
    "figures": "3/31"
  }
}
## 39. React Hydration Strategy
Do not turn the entire website into a React application.
Use Astro hydration selectively.
Example:
```astro
<SeasonSelector client:load />

<MatchFilters client:load />

<PlayerProfile client:idle />

<PerformanceChart client:visible />

<HistoryExplorer client:visible />
```
Use:
client:load for important immediate interactions
client:visible for charts and sections lower on the page
client:idle for secondary interactions
## 40. Visual Design System
Theme
Recommended direction:
Dark
Premium
Sport Broadcast
Futuristic
Data Driven
Visual Elements
Dark backgrounds
Team accent color
Large numbers
Thin borders
Glass panels
Subtle gradients
Stadium lighting
Grid patterns
Soft glow
Minimal noise texture
## 41. Cricket Broadcast Inspiration
Use visual language inspired by professional cricket broadcasts.
Example:
┌────────────────────────────┐
│ TITAN CC                   │
│                            │
│ 184 / 6                    │
│                            │
│ RUN RATE                   │
│ 9.20                       │
└────────────────────────────┘
Statistics should feel like a professional sports broadcast rather than a generic dashboard.
## 42. Animation Strategy
Use animations carefully.
Hero
Text reveal
Image fade/slide
Background movement
Statistics
Count-up animation
Number reveal
Players
Image zoom
Card elevation
Border animation
Charts
Animate when entering viewport
Navigation
Smooth active indicator
Timeline
Scroll-based reveal
Avoid excessive animation.
## 43. Responsive Design
Desktop
12-column layout
Large hero
4-column player grid
2-column analytics
Tablet
6-column layout
2-column cards
Horizontal match carousel
Mobile
Single column
Horizontal stat cards
Horizontal player carousel
Stacked analytics
Full-screen player modal
Vertical history timeline
## 44. Performance
Target:
Lighthouse Performance > 90
Use:
Astro static rendering
Partial React hydration
Lazy-loaded charts
WebP/AVIF
Optimized images
Minimal JavaScript
Code splitting
Lazy player images
## 45. Accessibility
Implement:
Semantic HTML
Keyboard navigation
Focus states
Alt text
Proper headings
Accessible buttons
Accessible charts
Reduced-motion support
Do not rely only on color.
Example:
✓ WIN
✕ LOSS
— DRAW
NR NO RESULT
## 46. SEO
Configure:
Page title
Meta description
Open Graph
Social preview image
Canonical URL
Sitemap
Robots.txt
Example title:
Titan Cricket Club — Matches, Players, Statistics & Records
## 47. Development Phases
Phase 1 — Project Setup
 Create Astro project
 Add React
 Add TypeScript
 Add Tailwind CSS
 Add ECharts
 Add Lucide
 Configure ESLint
 Configure Prettier
Phase 2 — Design System
 Define colors
 Define typography
 Define spacing
 Define cards
 Define buttons
 Define scoreboard components
 Define responsive breakpoints
 Define animation utilities
Phase 3 — Main Website
Build:
 Navbar
 Hero
 Team snapshot
 Current form
 Season performance
 Next match
 Recent matches
 Squad
 Player spotlight
 Analytics
 Head-to-head
 Records
 Trophy cabinet
 History
 Footer
Phase 4 — Local Data
Create:
 team.json
 seasons.json
 players.json
 matches.json
 statistics.json
 venues.json
 records.json
 history.json
Phase 5 — React Interactivity
Implement:
 Season selector
 Format selector
 Match filtering
 Player profile modal
 Head-to-head selector
 Interactive charts
 History interactions
Phase 6 — Visual Polish
Add:
 Scroll animations
 Number animations
 Hover effects
 Chart animations
 Stadium effects
 Micro-interactions
 Mobile refinements
Phase 7 — Quality
Test:
 Desktop
 Tablet
 Mobile
 Safari
 Chrome
 Firefox
 Accessibility
 SEO
 Lighthouse
 Reduced motion
## 48. MVP Checklist
The first version is complete when:
 Team has a strong visual identity
 Hero communicates the team immediately
 Current season is clearly presented
 Team statistics are visible
 Matches can be explored
 Players can be explored
 Player statistics are available
 Team analytics are available
 Records are visible
 Trophies are showcased
 History is presented
 Page works on mobile
 Animations are polished
 Page loads quickly
 SEO is configured
 Accessibility basics are implemented
## 49. Future Version 2
After the basic website is stable, consider adding:
Live scores
Live match centre
Full scorecards
Ball-by-ball commentary
Partnership analysis
Advanced player analytics
Player comparison
Wagon wheel
Pitch map
Bowling analysis
Match predictions
AI-generated match analysis
## 50. Future Architecture
Version 1
Astro
  +
React
  +
TypeScript
  +
Local JSON
Version 2
Astro
  +
React
  +
ASP.NET Core API
  +
SQL Server
Version 3
Cricket Data Provider
        ↓
ASP.NET Core API
        ↓
Database
        ↓
Astro + React
## 51. Final Design Philosophy
The website should feel like:
A digital stadium for the cricket team.
It should communicate five things immediately:
WHO ARE WE?
      ↓
HOW ARE WE PERFORMING?
      ↓
WHO PLAYS FOR US?
      ↓
WHAT HAVE WE ACHIEVED?
      ↓
WHERE DID WE COME FROM?
The first release should prioritize:
Identity → Matches → Players → Statistics → Records → History
rather than trying to become a complete cricket platform immediately.

### Recommended implementation order

If you're going to start coding this now, I would do it in this order:

**1. Design system → 2. Hero → 3. Team snapshot → 4. Matches → 5. Squad → 6. Player modal → 7. Statistics → 8. Records → 9. History → 10. Animations/polish.**

This will let you get a visually impressive version running early, rather than spending too much time building data structures before you can see the actual website.
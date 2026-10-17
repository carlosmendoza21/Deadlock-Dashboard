# Deadlock Dashboard

A React + TypeScript dashboard that shows live win probabilities for [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) matches. Search for a player, browse live matches, and watch each team's chance of winning update as the game goes on.

All data comes from the community [Deadlock API](https://deadlock-api.com). This project is not affiliated with Valve.

## Features

- **Find player**: search by Steam name, profile URL, or account ID to see a player's rank, hero stats, etc.
- **Live matches**: browse ongoing Normal-mode (6v6) ranked and unranked matches.
- **Match dashboard**: live win probability chart, team rosters with ranks, net worth, and lane objective status.
- **Win probability model**: a logistic regression fitted on about 25k recent matches (see [How the model works](#how-the-model-works)).
- **Backtest**: a script that scores the app's predictions against real match results.

## Getting started

Requires Node.js 20 or newer.

```bash
cd "Deadlock Dashboard"
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

### Scripts

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start the Vite dev server with hot reload     |
| `npm run build`   | Type-check and build for production to `dist/` |
| `npm run preview` | Serve the production build locally            |
| `npm run lint`    | Run ESLint                                    |

## Project structure

```
Deadlock Dashboard/
├── src/
│   ├── App.tsx               # Hash router and top-level layout
│   ├── api.tsx               # Typed client for api.deadlock-api.com
│   ├── hooks.tsx             # Data-fetching hooks
│   ├── predictMatch.tsx      # Turns a live match into a prediction (shared with the backtest)
│   ├── components/           # Pages and dashboard panels
│   └── model/
│       ├── model.json        # Fitted coefficients
│       └── winProbability.tsx
├── model/
│   ├── matches.sql           # Training-set query
│   ├── ranked_badges.sql     # Per-player rank query
│   ├── refit.mjs             # Downloads fresh data and refits the model
│   └── fit.cjs               # The fitting code
└── scripts/
    └── backtest.ts           # Live backtest against real outcomes
```

## How the model works

The win probability is computed from Team 0's point of view in two parts:

- **Pre-game**: the difference in average rank between the teams, plus the difference in hero strength (hero win rates for the lobby's skill range).
- **Live**: the pre-game estimate, combined with the relative and absolute net worth gap and the difference in objectives destroyed (Guardians, Walkers, Base Guardians, Shrines).

A separate logistic regression is fitted for each game-time checkpoint (6, 12, 15, 20 ... 50 minutes), and the weights are linearly interpolated between checkpoints. The coefficients live in [src/model/model.json](Deadlock%20Dashboard/src/model/model.json).

### Refitting the model

```bash
cd "Deadlock Dashboard"
node model/refit.mjs
npm run build
```

This runs the SQL queries in `model/` against the Deadlock API's SQL endpoint, saves the results to `model/data/`, and rewrites `src/model/model.json`. The SQL endpoint is rate limited (2 requests per minute) and marked deprecated upstream, so the script waits between queries.

## Backtesting

[scripts/backtest.ts](Deadlock%20Dashboard/scripts/backtest.ts) uses the same prediction code as the app to record predictions for live matches, then looks up the final results and reports how accurate the predictions were.

```bash
cd "Deadlock Dashboard"
npx tsx scripts/backtest.ts           # collect predictions (Ctrl+C to stop; prints a report every 30 min)
npx tsx scripts/backtest.ts report    # resolve pending results and print the report
```

Data is appended to `backtest/samples.jsonl` and `backtest/outcomes.jsonl`, so you can stop and restart collection at any time. Set `BACKTEST_DIR` to store it somewhere else.

## Tech stack

React 19, TypeScript, Vite, and ESLint. The app has no runtime dependencies besides React.

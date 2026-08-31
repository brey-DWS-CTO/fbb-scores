# The Nerds League Hub (fbb-scores)

Companion app for The Nerds fantasy basketball league (ESPN league 100537, est. 2010):

- **Scores** — live matchup scoreboard, daily box scores, projections (in-season, via ESPN's undocumented fantasy API)
- **Keepers** — the keeper worksheet: each team picks up to 2 keepers, the app computes tier rounds, exact pick costs (trades + same-tier bumps included), contract projections, and salary-cap legality
- **Draft** — live 14-round draft board with pick-trade ownership, keeper pre-fills, and a full-screen TV mode for draft night
- **League** — keeper tiers, contracts, draft-pick trade log, settings

## Stack

Vite 7 + React 19 + TanStack Query (frontend) · Express 5 (API: ESPN proxy + league state) · Neon Postgres in production, `.data/league-state.json` file store locally · deployed on Vercel (SPA + `api/index.ts` serverless function).

## Development

```bash
npm install
cp .env.example .env   # fill in ESPN cookies (ESPN_COOKIE_STRING recommended)
npm run dev            # Express on :3001 + Vite on :5173 (proxies /api)
```

Without `DATABASE_URL`, league state (keepers, draft picks, PINs) lives in `.data/league-state.json`. PINs are auto-seeded per owner on first use — read them with `npx tsx scripts/admin-pins.ts`.

## Keeper rules engine

`src/lib/keeper/engine.ts` implements Constitution §4 exactly:

- Players with **>25 GP** last season are ranked by league-scoring FPPG; pick cost = decile (rank 1–10 → R1, … 91+ → R10). Tier bands derive from the ranked list; **salary cap = R3 max + R3 min** (77.8 for 2027).
- **≤25 GP** → the season-before average is used (tier + cap). **0 GP** → flat 3rd-round cost.
- Keeper contracts: max years by original-round tier (R1: 1yr, R2–4: 2yr, R5–7: 3yr, R8–10: 4yr); cost re-derives each season, contracts travel with trades and never reset.
- Two keepers in one tier, or a traded-away round → cost walks up to the next-better owned pick.

The algorithm reproduces the league's official 2026 worksheet 100% (bands, per-player costs, and the 78.7 cap) — verified in `scripts/build-league-data.ts`.

## Data pipeline (annual, offseason)

```bash
npx tsx scripts/fetch-keeper-data.ts <rawDir>     # pull ESPN season stats + final rosters
npx tsx scripts/build-league-data.ts <rawDir>     # merge + validate -> src/data/league-2027.json
```

League-official season averages are transcribed from the ESPN app's Players view into
`src/data/source/screenshot-stats-2026.json` (the in-app numbers cut off at the fantasy
season end and are the league's convention; the API's full-season splits differ).
`src/data/source/league-2027-config.json` holds teams/draft order/contracts/pick trades.

## Deployment

```bash
npm run check
git push origin master
npm run smoke:prod  # after the Vercel deployment is Ready
```

Pushes to GitHub `master` deploy through the Vercel Git link. Use `vercel deploy --prod`
only as a fallback. Project `do-what-solutions-llc/fbb-scores`; Neon is attached via
the Vercel Marketplace (env `DATABASE_URL`). ESPN cookie env vars must be refreshed
when they expire. Never commit a real PIN. Manage commissioner PINs through Commish
Mode or `scripts/admin-pins.ts` with a production `DATABASE_URL`.

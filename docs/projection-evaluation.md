# Prospective matchup forecast comparison

The matchup model remains opt-in in My Team > Projections. Baseline projections are the default. The model is not claimed to improve accuracy until paired prospective outcomes support that conclusion.

## Collection

The existing authenticated hourly `/api/notify/tick` starts evaluation independently of reminder delivery, between 07:00 and 23:59 Pacific when ESPN read credentials are configured. No new email or desktop automation is created. Collection starts after this code is deployed; there is no historical reconstruction.

The collector loads the current fantasy week, the commissioner-accepted preseason projection snapshot, live league scoring and the current matchup environment. Its canonical baseline blends recent/season averages with preseason points rescored in the current league weights and the existing historical fallback. Personal edits and commissioner-only alternate source selections are excluded so every captured pair uses one reproducible league baseline.

For rostered player-games tipping off in the next two hours, both baseline and matchup projections are captured together. Games already started, missing confirmed tip-offs and future input timestamps are rejected. The first stored forecast wins across retries and instances. The source player inputs, preseason prior, scoring weights, source capture timestamp and versioned matchup environment are archived. Changing model parameters requires a new model version.

One frozen pair of legal remaining-week lineup selections is also captured per already-authorized pilot team and fantasy week, using exactly the same roster, daily eligibility and weekly cap. The initial capture may be midweek: completed/locked games consume the same budget in both models. No lineup access is granted and no ESPN moves are performed. If matchup data is unusable, no lineup comparison is frozen yet.

## Persistence and outcomes

Production uses a separate indexed Neon `projection_evaluation_records` table via the existing DATABASE_URL connection. Inputs and finalized outcomes are insert-only, with deterministic IDs and `ON CONFLICT DO NOTHING`. Raw archives are not added to normal league state or exposed by the report endpoint. Local development uses ignored `.data/projection-evaluation/` files with exclusive create semantics. A Vercel deployment without durable storage fails rather than pretending temporary files are persistent.

Each hourly run independently settles pending games from the last 30 days even when new capture fails. It checks up to three recent pending dates and one oldest date per run, joining exact athlete, NBA calendar date and team/opponent. Only a finalized scoreboard AND finalized box score can supply an outcome. A missing athlete, incomplete line or unknown participation stays pending; zero is allowed for an explicit provider DNP. Results are scored using each forecast's frozen league weights. Final results are frozen on first ingestion; later official stat corrections are not automatically incorporated in this version. Older unmatched captures remain visibly pending rather than receiving fabricated outcomes.

## Report

My Team > Projections > Forecast evaluation is commissioner-only, with a no-store authenticated API. It returns aggregates, not raw archived rosters or inputs:

- Captured, adjusted, scored and pending counts, distinct scored dates, missing baseline and invalid capture counts.
- Paired MAE, RMSE and bias on the same finalized games, separated into all available forecasts, matchup-adjusted games only, and active-player-only matchup games.
- Explicit DNP count, and paired MAE improvement (baseline MAE minus matchup MAE; positive favors matchup).
- Completed frozen-lineup comparisons and mean actual-points gain. All games in either frozen selection must have final outcomes before the pair counts.

The report says 'Collecting evidence' until at least 100 adjusted player-games across 14 dates are scored. This threshold is a review cue, not a statistical significance test or automatic promotion rule. Shared-game/day correlations, sample coverage and DNP effects still need review. Frozen choices are a counterfactual fixed-lineup comparison, not a claim about how managers actually changed lineups or used extra games after DNPs. No model is automatically promoted.

## My Team game averages

Roster rows show Season, L3, L7 and L15 fantasy points per game simultaneously. These are current-season completed **games**, not ESPN's 7/15-day windows. The public ESPN game log is requested with an explicit season and cached for ten minutes per player. Each complete game is scored in the accepted projection snapshot's league weights, falling back to the app's league defaults. Duplicates, wrong-season, live/future and incomplete/DNP lines are excluded; a complete legitimate zero-point appearance is included. A short early-season window averages the available games and shows `*`; its accessible description/title gives the exact sample count. Unavailable data is an em dash and failed reads can be retried. Read-only rows stay 34px tall with all four averages visible at 390px width.

## Validation

Tests exercise true game-count windows, early samples, custom scoring, zero-point appearances, immutable retry/restart behavior, pre-tipoff and future-input guards, separate fallback coverage, explicit DNP evidence, missing baselines, result settlement, frozen-lineup completion/gain, and report authorization. Existing game-log, box-score, lineup and reminder-clock tests run as regressions. Local Vite QA uses a labeled sample roster and live public game logs in both themes. Live Neon storage and scheduled production capture cannot be verified before deployment; no accuracy evidence is invented for that gap.

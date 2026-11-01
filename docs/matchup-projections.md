# Planner matchup projections, version 1

The My Team weekly planner offers an opt-in experimental model with a conservative pace and position-defense signal to its existing league-scored player baseline. Other scores pages and win probabilities retain their current model during this pilot.

## Sources and scoring

- FantasyPros: https://www.fantasypros.com/daily-fantasy/nba/fanduel-defense-vs-position.php
- ESPN pace: https://www.espn.com/nba/hollinger/teamstats
- Pace definition: https://www.nba.com/stats/help/glossary

FantasyPros supplies season-to-date games played and per-game PTS, REB, AST, 3PM, STL, BLK, TO allowed to PG/SG/SF/PF/C. We score those categories with the live week's league weights (accepted projection weights, then league defaults if unavailable). We do **not** import the site's FanDuel point total as our projected score. These shared categories are a defensive matchup proxy: FG makes/misses, FT misses and double/triple-double bonuses are not present in this table. The baseline still includes the full league scoring. This is not a complete league-scored defense-against-position model.

Both HTML parsers require the requested season and complete 30-team coverage, reject duplicate/invalid rows, and select only the GC-0 season-to-date positional rows. Hidden rolling windows, ALL and TM aggregates are excluded. FantasyPros uses the starting year; ESPN uses the ending year. UTH/NOR/PHO and ESPN team aliases are normalized before joining.

## Formula

For each position, calculate weighted shared-category points allowed divided by the opponent's pace. Compare this to the games-weighted league average of the same per-possession quantity. This removes the opponent's raw tempo before adding a separate game-pace estimate.

- Reliability = games / (games + 15).
- Defense factor = 1 + (position defense ratio - 1) * reliability, limited to 0.90-1.10.
- Estimated game pace = mean of the player's team pace and opponent pace.
- Pace factor = 1 + (estimated game pace / player's team pace - 1) * reliability, limited to 0.95-1.05.
- Game projection = existing baseline * defense factor * pace factor.

Multiple listed positions average their signals, without choosing the easiest one. Generic G maps to PG/SG and F to SF/PF. Unknown positions retain the baseline. The positional sample also controls pace shrinkage because the pace table lacks GP.

These limits and the 15-game prior are initial conservative choices, not fitted accuracy claims. Positional allowance still reflects opposing talent, role/minutes distribution and schedule difficulty. Pace is a team average rather than player-on-court pace. This model does not estimate injury return minutes, starting lineup changes, rest or positional defensive assignments.

## Fallback and caching

ESPN daily projections take precedence and are never multiplied by our matchup model. Zero baselines, started games, absent opponents, unknown positions, zero samples, wrong seasons, future capture timestamps and captures older than 24 hours retain the baseline. No current matchup environment is applied to already-started historical games.

Sources are fetched together with 10-second timeouts, shared in flight, and cached for six hours in process (at most two seasons). Failures cache an explicit baseline response for five minutes. There is no last-good stale carryover. The browser shares an hourly query; the public success response has five-minute browser caching. No API keys or league credentials are sent to these sources.

The planner's visible footer reports how many upcoming games are adjusted. Each game title and accessible description contains its source or baseline/pace/defense breakdown. Recommended games and weekly totals use the same adjusted function.

## Validation and evaluation

Focused tests cover source formats, season conventions, alias joins, hidden duplicate windows, cache/retry behavior, neutral signals, pace double-counting, sample shrinkage, adjustment bounds, league scoring, multi-position averaging, fallback and daily-source precedence. An optimizer integration test verifies that one available game goes to the stronger matchup.

A live source smoke read covers all 30 teams. Local UI QA uses synthetic schedules with real captured matchup environments, clearly labeled as sample data. These checks prove functioning inputs and arithmetic; they do not prove improved predictive accuracy.

Before expanding beyond the planner, archive baseline and adjusted predictions before tip-off with source capture timestamps, then join finalized outcomes. Compare paired player-game MAE, RMSE and bias, with sample counts and coverage, and evaluate weekly selected-lineup outcomes separately. Use the forecast evaluation work in PR #133 as the starting point. Do not backtest using today's full-season DvP table against earlier games: that leaks their outcomes into the prediction.

## Reference tables

Both My Team > Projections and the season Projections editor contain a collapsed Matchup data section. Pace ranks all 30 teams by possessions per 48 minutes; Vs position selects PG/SG/SF/PF/C and ranks raw shared-stat points allowed per game with sample GP. Rank 1 means fastest / most allowed, respectively. Both tables can reverse the metric sort; ties share a rank. Zero-sample allowances are unknown and unranked.

The tables reuse the same cached matchup environment as the planner and its shared-category scoring function. No source request is made solely for a closed section. The position table explicitly excludes FG/FT misses and DD/TD bonuses; its raw allowances are not the planner's shrunk, pace-normalized adjustment. Captured time and source links accompany the table. The shared component keeps both themes, adjacent 16px logos and compact rows consistent.

Keep these as local views for now; no additional primary navigation tab was added. A dedicated projections section can follow when player forecasts and league-wide matchup research become an independent in-season workflow.

Prospective tracking, baseline defaults and the commissioner comparison report are documented in [projection-evaluation.md](projection-evaluation.md).

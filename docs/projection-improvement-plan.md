# Projection improvement: audit and evaluation first

PR #132 merged October 20, 2026 (Pacific). This branch starts phase 1; it does not replace live forecasts or claim calibrated win probabilities.

## Source audit

| Input | Current behavior | Limitation / next action |
| --- | --- | --- |
| ESPN daily projection | `scores.ts` reads source 1 rows with a matching scoring period; `dailyProjection.ts` prefers the resulting value. | Validate split type and season as well as period; distinguish a genuine zero from an empty placeholder. Current day parser does not validate season or split. |
| Season / last 15 days | League scoring applied to ESPN source 0 split totals, divided by GP. Blend weights .3/.5 with sample reliability. | At opening night, two overlapping averages can both describe the same single game. Backtest alternative shrinkage without double-counting evidence. |
| Preseason | `useExpectedPoints` reads `useProjectionData().snapshot`. ESPN/Hashtag fills, commissioner source selection and personal edits may be applied. | Viewer-dependent. Establish one server-owned canonical source and version, independent of sign-in and private ranking edits. |
| Historical baseline | Committed league dataset's prior-season FPPG, keyed by ESPN ID. | Rookies / new players can be absent. Persist date and source; never silently equate missing with zero. |
| Injury | OUT / SUSPENSION removes all future games; other statuses treated as available. | A current OUT tag is not a return-date forecast. Need per-game availability and minutes distributions. |
| Schedule / lineup | Known future daily starters and schedule; grid estimates for missing schedule days; actual past starts preserved. | Future lineup choices remain assumptions. Track completeness and avoid describing estimated games as confirmed. |
| Live game | Current points plus a bounded, minutes-aware estimate of remaining output. | Validate rotation and overtime behavior against live snapshots. |
| Weekly cap | ESPN allowance, per-week commissioner override; last-day high-score overage deductions. | Simulations must apply deductions within each simulated outcome, not just subtract expected scores. |
| Win odds | Analytic normal margin, game spread .4 and shared uncertainty .1. | Assumed variance, not calibrated probabilities; no validated injury or player correlation model. |

The source paths are repository findings, not guarantees about undocumented ESPN fields. We need captured raw row metadata to verify their meaning before changing parsing.

## First deliverable now implemented

- A frozen archive contract containing a sanitized `ScoresWeek`, numerical priors, capture time and prior availability time.
- Reproducible offline predictions for the current blend and a historical-only comparator. Both use the same schedule and cap rules.
- Missing future-game source coverage, including affected player IDs, is recorded rather than hidden in a zero total.
- Evaluation against separately supplied final results: team MAE, RMSE, signed bias, Brier score, calibration bins, opening/midweek/closing groups and distinct matchup counts.
- Future-dated inputs, post-final forecasts, duplicate observations, duplicate results and invalid probabilities are rejected. Ties are excluded from binary win scoring, but retain total error scoring.
- File outputs refuse to overwrite existing snapshots. No production database changes, external messages, or scheduled collection are introduced.

## First captured audit: October 20, 2026, 10:19 PM Pacific

The public preview payload contains five unfinished matchups and 241 remaining starter player-games before cap deductions. With the committed historical baseline and no private signed-in snapshot, 15 player-games across five players have no daily projection, current average, recent average, or historical prior: Kyrie Irving, Fred VanVleet, Tyrese Haliburton, Cameron Boozer and Caleb Wilson. This is an input-coverage finding, not a judgment about whether those players will play. The sanitized case summaries are in `projection-source-audit-2026-10-20.json`; raw frozen inputs remain local under the ignored `.forecast-research/` directory.

Running evaluation with no finalized results correctly returns five unmatched cases and no accuracy metrics. None of these opening-week forecasts has been validated against a finished matchup.

## Run locally

Commands read saved public score responses; do not put credentials or raw authenticated ESPN responses in an archive.

```powershell
npm run forecast:eval -- capture week.json archive.json
npm run forecast:eval -- predict archive.json cases.json
npm run forecast:eval -- evaluate cases.json outcomes.json report.json
```

`outcomes.json` is an array of `{ season, week, matchupId, finalizedAt, homeTotal, awayTotal }`. It must contain final totals after league deductions. Do not pass live partial totals. Capture records use the current time; capturing an old league payload today does not reconstruct a historical forecast. Prediction cases can be combined into an array for evaluation; duplicate model/matchup/time records are refused.

## Data collection and honest validation

Start recording at known forecast horizons (opening, midweek, closing) with input timestamps, scoring rules, cap, roster, injuries and source versions. Backfill only where contemporaneous records exist. A historical box score plus today's player projection is not a valid backtest. Do not invent an accuracy result from the current unfinished week.

The first audit sample can establish source completeness and reproducibility only. Actual skill needs finalized matchups. Track distinct matchups as well as snapshots; repeated observations from one game do not constitute independent trials. Report errors by stage, season segment, missing-data rate and injury status. Freeze tuning parameters on a training period and evaluate on later untouched weeks. Report calibration sample counts; sparse bins cannot establish accuracy.

## Subsequent phases

1. **Canonical inputs:** shared server-side projections with provenance, version, freshness and explicit missing-data states; remove dependence on viewer identity and personal edits. Capture raw ESPN row metadata for the parser audit. Gate incomplete odds rather than pretending certainty.
2. **Player model:** minutes × per-minute production, preseason / historical priors, sample-aware updating and per-game availability. Address role changes and return restrictions. Compare with simple baselines before adding opponent / pace features.
3. **Team simulation:** simulate actual daily lineup assumptions, player variance, availability, minutes, correlations and cap deductions for every draw. Use a seeded engine for reproducibility; convergence tests for numerical precision.
4. **Calibration and rollout:** temporal holdouts, reliability plots with counts and uncertainty, comparison with current and historical-only models. Shadow-run first. Display ranges and confidence labels; promote only after a measured improvement with no missing-data regressions.

### Acceptance gates

- Same public inputs produce the same forecast for every viewer.
- Every future starter game has an attributable baseline or an explicit missing flag.
- No future result or revised projection enters an earlier forecast.
- Candidate total error and probability scoring improve on agreed baselines on held-out weeks; the report includes sample sizes and uncertainty, not a fabricated percentage target.
- Final scores, cap deductions and played-game accounting agree with the league's actual results.

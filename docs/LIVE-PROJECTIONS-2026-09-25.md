# Live projections: 25 September 2026

ESPN now supplies 348 usable season projections. The existing fetch and
totals-to-FPPG calculation work. The fixes are the rank bridge, zero-game
availability, an estimate for the double-double bonuses ESPN leaves out,
and admin copy that mistook a stale snapshot for unpublished projections or
promised a source switch without scoring settings.

## Capture

The dated fixture records the capture time in UTC (26 September, still
25 September Pacific). It keeps 448 STANDARD-ranked or committed players.
The public endpoint with the client's exact filter returns 3,184 players,
349 current-season rows, and 399 prior-season projection rows. Without the
filter it returns 50 players and 20 current-season rows. All current rows
are `102027`, source 1, split 0, season 2027, scoring period 0. No other
projection splits were present. The old filter and season guard work.

348 rows contain the 31 keys listed in the handoff and positive games in
stat 42. None contains `averageStats`; there is no second representation
to compare. Jordan Miller, marked OUT, has the 349th row with an empty
stats dictionary. Normalization excludes it. No explicit zero-game row
was observed. Six other injured players have populated rows. Current
rookies Dybantsa, Peterson and Boozer have projections, as do Maluach and
Yang Hansen.

Scoring comes from league 100537's live `mSettings`, not the rulebook or
ESPN's `appliedTotal`. The 13 items include DD, TD and QD, which the
projection dictionaries omit. See "The double-double bonus" below for how
those are filled in. Live QD is 170; Appendix A says 175. No keeper math
changed.

| Player | Last-season FPPG | Projected FPPG | Projected games |
| --- | ---: | ---: | ---: |
| Nikola Jokic | 64.2 | 64.7 | 72 |
| Shai Gilgeous-Alexander | 51.7 | 52.4 | 76 |
| Luka Doncic | 56.5 | 57.8 | 68 |

Projected FPPG here includes the estimated double-double bonus. Without it
Jokic reads 60.3, four points under a season he actually played.

## The double-double bonus

This league pays 1.8 for a double-double, 6.2 for a triple-double and 170
for a quadruple-double. ESPN's projection dictionary has none of those
counts, so scored as sent, every double-double player came up short. Jokic
lost about five points a game, Sabonis and Giddey two to three.

`src/lib/league/doubleDoubles.ts` estimates the odds from the projected
per-game line. Each of points, rebounds, assists, steals and blocks is
treated as roughly normal around its average, with a spread of 1.1 times
the square root of the average, and a game counts the category at 9.5 or
more. The five are taken as independent, and the 32 ways they can land
give exact odds of two, three or four at once. The bonus is paid only for
items the dictionary lacks, so if ESPN ever sends stat 37, nothing is added
twice. `projectedBonusPerGame` reports the estimate apart from the rest.

Checked against 2024-25 box scores: Jokic 0.91 double-double odds against
a real 0.90, triple-double 0.46 against 0.49; Sabonis 0.85 against 0.87;
Giannis 0.77 against 0.81; Harden 0.45 against 0.38; Giddey 0.43 against
0.43. Wembanyama runs low, 0.66 against 0.78: a big's rebounds vary less
than the model assumes. The tests hold each name to a band and name the
miss.

What it moved: Jokic 60.3 to 64.7, Sabonis 43.2 to 45.6 and 11th to 9th,
Giddey 40.3 to 43.0 and 25th to 14th, Giannis 55.6 to 57.5. The top five
did not change order.

Four matched players fall outside a factor of 1.6: Beal 9.8 to 23.2,
Adams 18.2 to 9.8, Dick 10.0 to 18.2, Sochan 8.3 to 17.8. These are
explicit regression-test exceptions. All remaining matched players pass
the band. No projected FPPG is remotely close to a season total.

## Value and availability

On the committed dataset plus the captured draft pool: 348 players use
projections, 63 use the rank bridge, 36 use last season, and 1 has no data.
The primary source is `projection`. The bridge fits projected points when
at least ten usable pairs exist, otherwise last season's points. This
keeps a ranked rookie without a projection on the current forecast scale.
The old fixture and acceptance tests still cover next September's fallback.

Stat 42 divides counting totals and sets availability as games / 82.
Equal 50-FPPG lines over 60 and 82 games have different values. Zero games
now means zero availability, rather than the old full-season default.
With no valid average, FPPG falls through to a named rank/history source;
the player stays on the board with zero projected availability.

`PlayerValue.fppg`, `source`, `perGame`, `seasonValue` and other fields keep
their names for the future keeper value tool.

## Round one

Same assumed keepers as PR #29. Seed 7, 200 runs per mode. These are
forecasts from a saved response, not claims about actual draft choices.

| Pick | Owner | Sharp, seed 7 | Realistic, seed 7 |
| --- | --- | --- | --- |
| 1.1 | Joel | Jokic, assumed keeper | Jokic, assumed keeper |
| 1.2 | Ryan | Gilgeous-Alexander | Gilgeous-Alexander |
| 1.3 | Patrick | Antetokounmpo | Barnes |
| 1.4 | Bryan | Jalen Johnson | Cunningham |
| 1.5 | Kyle | Edwards | Antetokounmpo |
| 1.6 | Dustin | Tatum, assumed keeper | Tatum, assumed keeper |
| 1.7 | Aaron | Sabonis | Flagg |
| 1.8 | Derek | Wembanyama, assumed keeper | Wembanyama, assumed keeper |
| 1.9 | Brey | Cunningham | Edwards |
| 1.10 | Amy | Doncic, assumed keeper | Doncic, assumed keeper |

Chance the player is still available, before the pick:

| Player | Sharp 1.5 | Realistic 1.5 | Sharp 1.9 | Realistic 1.9 |
| --- | ---: | ---: | ---: | ---: |
| Giannis | 0% | 12.5% | 0% | 2% |
| Jalen Johnson | 1.5% | 70% | 0% | 16% |
| Edwards | 98.5% | 49% | 1.5% | 11% |
| Cunningham | 100% | 81.5% | 81% | 33% |
| Mitchell | 100% | 94% | 97% | 76% |
| Sabonis | 100% | 99.5% | 21% | 96.5% |
| Maxey | 100% | 98.5% | 100% | 87% |
| Giddey | 100% | 100% | 100% | 99% |
| Anthony Davis | 100% | 100% | 100% | 100% |

At 1.9, sharp rooms take Cunningham 58.5%, Sabonis 20%, Mitchell 16.5%.
Realistic rooms take Mitchell 24.5%, Cunningham 18%, Maxey 13%, Johnson
12.5%. Sabonis is the double-double story: a sharp room takes him before
1.9 four times in five, a realistic room almost never does. Barnes at 1.3
in the sample is a rare noisy reach; across 200 realistic runs 1.3 is
Giannis 61%, Edwards 17%. The model parameters have not been tuned to
restore the old readout.

Our board differs from ESPN's current rank: Towns 12 vs 22, Duren 13 vs
26, Giddey 14 vs 16, Siakam 16 vs 25, Durant 19 vs 21, Davis 20 vs 29,
Maxey 21 vs 12, Barnes 24 vs 15, and Young 26 vs 14. These gaps combine
league scoring, the double-double bonus, games, positional replacement and
schedule. They are not pure FPPG ranks.

PR #29's Davis story is gone: the new projection has 45.9 FPPG but only
61 games, while updated rank and ADP also changed. The difference from
that PR cannot all be attributed to projections alone.

## Three-minute check

1. Read the two round-one columns and the 1.5/1.9 odds above.
2. Open the branch preview's Commish page. Fetch rankings. Check the
   projection count and scoring warning before accepting.
3. Accept the snapshot, reload, and check that the source says
   2026-27 projection and Jokic shows about 65 FPPG, never 3,000.

For the repeatable report, set `REPORT_PROJECTIONS=1` and run
`node --require ./tests/tsx-windows-shim.cjs --import tsx --test tests/mock-draft-projections.test.ts`.

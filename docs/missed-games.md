# Missed-games report

Publicly visible under Scores > Missed Games (`/scores/missed-games`). The page reads the persistent report. For commissioners, it then refreshes the current ESPN week and backfills any missing closed regular-season matchups. Manual refresh repeats this process. Recheck a saved week to pick up later ESPN stat corrections. Everyone can read the report without signing in. Only commissioners can refresh data or approve exemptions; the private ledger is removed from general league-state responses.

## Counting

A missed game is a shortfall against the matchup game limit: `max(0, cap - actual started games played)`. Bench appearances and DNP stat rows do not count. This is not a count of unused bench opportunities. Commissioner-set weekly caps take precedence over ESPN caps, then the default 30. Caps are resolved when reading the report, so a cap correction updates totals without re-importing game results.

Open weeks are provisional and show games still needed. A matchup becomes final only after its end date in ESPN's Eastern calendar, after NBA games have finished, and with schedule and daily roster coverage for all configured teams. Incomplete reads never create penalties or replace finalized data. Each season/week has one saved row; re-importing updates it without double-counting.

The season report exposes `missedWeeks`, `totalGamesMissed`, `countedWeeks`, `playInEligible`, and per-week history for every configured team. A fourth counted missed matchup sets `playInEligible` false. Three or fewer remain eligible so far. Unknown calendar or unverified closed weeks returns null eligibility, unless four verified offenses already establish ineligibility. This selector is shared so future play-in pages can use exactly the same rule. Playoff top-four qualification is unaffected. Only regular-season matchups count.

## Storage and clock

The ledger lives in the existing durable league-state backend (Neon in production, local JSON in development). The existing authenticated hourly notify tick runs catch-up at 8 AM Pacific. One historical week is processed per daily run; initial calendar discovery can also load the first outstanding closed week. Page refresh can backfill all pending weeks. The cron must already be configured and ESPN credentials must match the league season. No new external message is sent.

## Exceptions

Rule 6.7 requires both commissioners to approve an exemption. Approval records are keyed by season, matchup and team, with a shared reason and distinct authenticated approvers; repeated approval by the same person counts once. Actual missed totals remain visible, while an approved exemption removes that week from `countedWeeks`.

The current config marks only Brey as commissioner. Therefore a second approval cannot currently be recorded and no exemption can take effect until the second commissioner is explicitly configured. This change does not expand anyone's administrative permissions. A different reason cannot overwrite the first approval.

## Verification

Pure tests cover threshold boundaries, per-week caps, provisional/incomplete coverage, DNPs, bench games, time zones and exemptions. API integration tests cover public read access, commissioner-only writes, private-state redaction, durable all-team refresh, idempotent approvals, and retention of final records after failed or incomplete reads. Fixtures contain no ESPN credentials. Production ESPN validation and browser QA remain separate.

# Projection compute budget

This feature adds no cron schedule, no per-player Vercel function and no AI calls. The existing hourly reminder invocation hosts a once-daily, finite experiment. Ordinary user-driven roster/scores/API traffic still exists; this document limits the new background experiment rather than promising a zero bill.

## Enforced background limits

| Work | Limit |
| --- | --- |
| Clock eligibility | 07:00 Pacific only; other 23 hourly ticks return before database/source work |
| Duplicate protection | Durable daily claim shared across cold instances; no second attempt that day |
| Capture lifetime | First 28 calendar days from the first daily claim |
| Settlement grace | Next 14 days, with no new week/model source fetches |
| After day 42 | No capture, settlement, optimization or archive scan; only a small daily control lookup remains in the existing tick |
| Forecast persistence | At most 300 today's future player-games/day; at most 8,400 captures/trial |
| Week source expansion | At most 14 days, rejected before daily-source fan-out |
| Private ESPN reads | 8-second request timeout and 8 MiB response limit for evaluation |
| Lineup comparisons | One already-authorized pilot/week, at most one roster read/day; reject over 30 players/slots, 14 days or cap 60 |
| Result collection | One pending date/day, one scoreboard and at most 15 final-game summaries |
| Retry behavior | No immediate/day-loop retries; unresolved games remain pending |
| Report generation | During the daily job only, saved as a small summary |
| Report page reads | Saved summary only; no raw archive reader; coalesced/cache for 60 seconds in process and one-hour browser query freshness |

A normal seven-day capture job needs at most 35 external ESPN/FantasyPros reads, including the maximum result slate and pilot read. A 14-day week with the opening-night fallback is bounded at 56. A settlement-only day uses at most 16. These are outbound source reads inside the existing invocation, not additional Vercel invocations. Database reads/writes are separate. Claims intentionally consume the day's attempt even if a source fails, rather than repeatedly spending compute. Outages and late/unmatched results can reduce coverage; there is no fabricated backfill.

Forecasts are frozen in the morning rather than within two hours of tip-off. This reduces background work from up to 17 full-week loads/day to one and keeps both models on the same available information. The trial does not automatically extend when incomplete. Its summary must be reviewed before promoting the model or explicitly starting another experiment.

## UI and traffic safeguards

- Read-only My Team roster polling is five minutes (previously 15 seconds). The faster 15-second interval is retained only for enabled lineup writes.
- The weekly planner polls every five minutes instead of every minute. Other live Scores views keep their existing refresh behavior.
- Projection consumers passively subscribe to the navigation's shared league-state poll rather than starting additional polling timers.
- Player game logs are fetched directly from ESPN in the browser, cached for ten minutes, retained for 30 minutes, and do not refetch just on focus. Refresh roster explicitly refreshes its players' logs. There is no per-player backend polling job.
- Matchup data is not requested by a planner using the baseline. It loads on experimental opt-in or when a reference table is opened. Successful public matchup responses receive a six-hour Vercel CDN TTL as well as the in-process cache.
- Archived lineup inputs omit the other nine teams and unnecessary per-game stat payloads. The daily capture's existing-record read is reused by result settlement.

## Repeatable checks

Run `node --require ./tests/tsx-windows-shim.cjs --import tsx scripts/projection-compute-audit.ts` for a synthetic full capture-budget load test. It makes no external requests or database writes. The fixture has 8,400 forecasts, their outcomes, and 28 environment metadata records. An independent optimizer case exercises the maximum accepted 30-player / 30-slot / 14-day / 60-game input.

Observed on the local development machine: the synthetic archive was 10.53 MiB, report aggregation about 35-60 ms median, the saved summary 765 bytes, and the two maximum-budget optimizers about 85-100 ms together. Actual archives include fuller environment data and additional lineup outcomes, so this is a CPU/load test rather than an exact production storage or invoice estimate. Archived maximum-budget synthetic plan inputs were about 27 KiB after stripping unrelated rosters.

Tests cover duplicate claims across fresh store instances, 28+14 expiry, DST gating, 300-capture persistence limit, 14-day source rejection before fan-out, 15-summary maximum and shared saved-report reads. Live Vercel/Neon billing must still be checked after deployment. No preview build or production deployment was requested for this audit.

# Fantasy Cast compute and cost estimate

Reviewed October 22, 2026. This is a source-based budget model, not an invoice. Vercel account metrics were unavailable; reconnecting is not required to use this estimate.

## Changes

- One initial schedule read; no recurring Cast updates before the first scheduled tipoff. A timer resumes at tipoff. A delayed start is checked slowly without fetching a pregame play feed.
- Poll every 20 seconds while games are live; pause between games and stop after the last final summary. Hidden tabs do not poll. A minimized overlay is unmounted and does not poll.
- Share in-flight ESPN summary requests between Cast and box-score consumers. Cache live summaries/parsed plays for 20 seconds and completed games for 15 minutes. Caches have bounded entry counts.
- Public responses use Vercel CDN cache headers; browser-specific rosters and ownership never enter that cache. Cache errors are not published to the CDN. CDN savings must still be verified after deployment.
- Cast's roster observer polls only while Cast's current-day slate is live. Other pages retain their own independent polling rules.
- Memoize roster indexes, sorting, filtering and running totals; build the unique-player index once per game parse; aggregate final corrections in one pass.

This preserves live responsiveness rather than slowing the feed to save pennies. Polling more slowly would cost less; there is no provable absolute minimum independent of freshness and traffic.

## Measurements and regression checks

A local real-data read on October 22 returned today's first tipoff at 23:00 UTC (4 PM Pacific), phase `waiting`, zero plays, and a 135-byte response. Yesterday's completed 11-game slate returned `complete`, no next poll, 5,724 plays, 1,698,873 JSON bytes, and 134,566 gzip bytes. Local cold retrieval/processing took 421 ms of process CPU and 338 ms elapsed for that completed slate. These are local process measurements including HTTP work, not production billable CPU or a guarantee for live requests.

Mocked tests verify: 50 pregame readers share one schedule fetch with zero summary fetches; 20 concurrent live readers share one fetch per started game; the next live tick rereads only the live game; final summaries are reused; first-tipoff cache expiration, delayed schedules, off days, failed-read retries and final-summary completion are covered.

At the old 20-second cadence a visible tab made 180 Cast requests/hour regardless of whether today's games had begun or finished. Six hours before tipoff meant 1,080 wasted polls per tab. The new schedule makes zero recurring Cast polls during that wait, following its initial read. With nine finished games and two live games, a warm live tick now needs two summary reads rather than eleven (82% fewer), apart from occasional final-game correction refreshes.

## Budget assumptions

- One private 10-manager league; 10 people each watch 3 hours/day, 30 days/month. Multiple tabs count as additional viewers.
- 20-second live cadence: 162,000 viewer feed requests/month, or 37,800/week.
- Up to six hours of daily live coverage shared by viewers: approximately 32,400 CDN refresh opportunities/month per busy region. This is an ideal shared-cache model, not a hard invocation cap; cold instances, retries and multiple regions increase it.
- Using the largest measured compressed response for every request gives approximately 21.8 GB/month (5.1 GB/week). Actual early-game responses are smaller. Wire compression must be enabled by the serving platform; the uncompressed equivalent is approximately 275 GB/month.
- Model 0.05–0.5 CPU seconds, 0.3–2 seconds occupied time and 2 GB memory per origin refresh. A conservative 0.421 CPU seconds plus 2 seconds occupied time at 32,400 refreshes gives roughly $0.89/month for CPU, memory and invocations at the US East rates below. Allow headroom for cache misses, other regions, origin transfer and retries.

| Scope | Weekly equivalent | Monthly budget |
| --- | ---: | ---: |
| Cast feed infrastructure usage, before plan credit | $0.23–$1.15 | $1–$5 |
| Entire app, additional costs excluding existing Pro base fee | $0–$6.90 | $0–$30 |

Weeks use monthly cost / 4.345. The Cast estimate excludes charging the same shared roster/state requests a second time. It is part of the whole-app estimate, not an amount to add on top. If existing Pro usage credit covers the service, Cast's additional billed amount can be $0.

The whole-app budget excludes the existing $20/month Vercel Pro platform fee. It comprises approximately $0–$10 of usage beyond the existing plan credit and approximately $0–$20 for Neon. This is incremental spending on the existing plan, not a claim that the app has no base subscription cost. It assumes normal league use, no paid email plan, no paid observability extras, modest builds and no significant bot traffic. Additional deploying seats, paid email, unusually frequent builds, external subscriptions, domain renewal and tax are excluded. A Hobby/free-tier deployment could be cheaper but is subject to its eligibility and quotas.

The database is a larger uncertainty than Cast. League state polls every 30 seconds while active (3 seconds during a live draft); the cron configuration schedules about 5,161 invocations/week, including minute checks on three UTC days. The claim handler returns early outside its Pacific weekend, but configured weekend claim reads and 15-minute maintenance can keep Neon awake. At 0.25 CU, an always-awake 30-day database would consume 180 CU-hours; at $0.106/CU-hour that is $19.08/month plus storage on Launch. Free-tier quotas and actual autosuspend behavior materially change that number. These clocks are separate from Cast and have not been changed by this optimization.

## Published rates used

- [Vercel Pro](https://vercel.com/docs/plans/pro-plan): $20/month platform fee with one deploying seat and $20 usage credit; 1 million CDN requests and 1 TB transfer in the included CDN tier.
- [Vercel Fluid Compute](https://vercel.com/docs/functions/usage-and-pricing): US East CPU $0.128/hour, memory $0.0106/GB-hour; invocations $0.60/million. Compute pauses CPU billing during I/O; occupied memory is still billable.
- [Neon pricing](https://neon.com/pricing): Free provides 100 CU-hours/project/month; Launch compute $0.106/CU-hour and storage $0.35/GB-month. Free and default Launch autosuspend after five idle minutes.
- [Vercel build pricing](https://vercel.com/pricing): basic $0.007/minute, standard $0.014/minute. Keep batching pushes as required by AGENTS.md.
- [Vercel cache headers](https://vercel.com/docs/caching/cache-control-headers): Vercel-specific CDN headers let the shared cache differ from browser caching.

To replace the model with a bill estimate later, collect production Cast route counts, CDN hit rate, billed active CPU, occupied memory, actual response bytes, Neon CU-hours and actual plan/add-on invoices. No billing settings or production resources were changed here.


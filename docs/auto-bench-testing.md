# Daily waiver auto-bench

Owners enable **Auto-bench my new pickups** on **My Team**. All members can open that page; opting in grants reads of their own configured ESPN roster for the current season. Manual ESPN move access remains controlled separately. Turning the preference off removes the derived read access.

## Schedule

A daily cron at 07:00 UTC plans the upcoming Pacific day's run. It publishes one Vercel Queue message delayed until 15 minutes after that day's waiver time, calculated using the same NBA schedule and Pacific-time rules as the waiver clock. Opting in also publishes idempotently, covering owners who join after the daily planner.

The private queue consumer is `api/auto-bench.ts`, topic `daily-waiver-auto-bench`. Auto-bench is not invoked by `/api/notify/lm-clock`. Queue publish deduplication and durable per-owner daily claims prevent duplicate batches. Every eligible pickup in an owner's batch is considered. LM adds, including queued LM claims, are excluded.

A delivery outside the five-minute run window, with a changed league/season, or whose expected time no longer matches the waiver schedule is skipped. Unknown ESPN write outcomes are never resubmitted. The worker verifies the saved roster after each move.

## Test safely in the app

1. Sign in as your own owner and open **My Team** (under **More** on mobile).
2. Enable **Auto-bench my new pickups**. Your own roster view should load.
3. Select **Check without making changes**. It reads ESPN and shows today's planned time plus a decision for each pickup. LM pickups say **Skipped: LM add**. Outside today's run window it explains that the pickup would be skipped. No pickups is a valid result when nothing qualified today.
4. The check never sends a lineup write, claims a daily batch, or changes the roster. It can be repeated without using up that day's automation.
5. Turning opt-in off should stop the derived My Team reads, unless your account already has separately granted roster access.

## Automated tests

```powershell
node --require ./tests/tsx-windows-shim.cjs --import tsx --test --test-concurrency=1 tests/auto-bench.test.ts tests/auto-bench-queue.test.ts tests/lineup-api.test.ts tests/lineup-read-view.test.ts tests/nav-sections.test.ts
```

These use injected or mocked ESPN and queue transports. They cover normal/early/DST waiver times, delayed delivery, owner/team binding, duplicate and concurrent delivery, multiple pickups in one batch, LM exclusions, bench capacity, later lineup choices, ambiguous writes, consent revocation, and a read-only check that leaves automation state unchanged.

After deployment through the Git integration, verify the daily planner publishes successfully and Vercel delivers the private consumer at the planned time. The actual ESPN write path is covered by fixtures; validating the deployed queue transport and the first opted-in live pickup requires that production run. The latest result is visible in My Team and retained in the audit ledger.

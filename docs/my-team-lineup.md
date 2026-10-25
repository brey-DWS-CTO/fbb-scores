# My Team lineup management

## Current release boundary

My Team is a disabled integration, not a working ESPN remote control. No ESPN
lineup write endpoint, browser selectors, or payload is assumed. Existing
`espnLm.ts` settings and FREEAGENT writes are unrelated to this provider.
There is no environment switch to enable live lineup execution.

The production provider is GET-only. Roster reading requires both a server-side
owner grant and `ESPN_LINEUP_READS_ENABLED=1`, which defaults off. It reuses the
existing server-side ESPN read credentials. A grant cannot enable execution.
The navigation entry is commissioner-only during the initial rollout. No
achievements changed. The user explicitly requested no live moves overnight;
the next real test requires fresh authorization in the next testing session.

## Evidence, checked October 25, 2026

- [ESPN basketball lineup instructions](https://support.espn.com/hc/en-us/articles/360000958652-Setting-Your-Lineup)
  describe eligible-position moves, occupied-slot swaps, and immediate saving.
- [ESPN basketball LM roster tools](https://support.espn.com/hc/en-us/articles/360000958772-Roster-Adjustments-After-Players-Have-Locked)
  document LM Tools and locked-lineup overrides. An enabled LM control is not
  evidence that an ordinary manager's move is legal.
- [ESPN lock settings](https://support.espn.com/hc/en-us/articles/360054748151-Lineup-and-Roster-Lock-Times)
  describe individual and day/week locks. The actual league settings must be
  inspected. NBA tip times alone do not establish the applicable lineup lock.

No supported authenticated ESPN lineup-write API was established. The user's
authenticated LM session was inspected through LM Tools, Roster Moves, Edit
Roster, their own team, Perform as Team Manager. Continue opened the observed
`/basketball/tools/lmeditlineup` UI route with `isActingAsTeamOwner=true`. The
form expressly says this role follows ordinary team-manager lock rules.

Chrome Network showed team-scoped `view=mRoster` and league `view=mSettings`
GETs. The settings identify `INDIVIDUAL_GAME` lineup locks and
`FIRSTGAME_SCORINGPERIOD` roster locks. The roster supplies player IDs,
lineupSlotId, eligibleSlots, onTeamId, and lineupLocked. Both captured reads
were conditional 304s with cached bodies. They prove response shape, not fresh
lock state or any write. New server reads use unique nonces, no conditional
headers, and reject every status other than 200, including 304.

Selecting Quickley's MOVE exposed valid HERE destinations, including an empty
G slot. No HERE was clicked. The selection was canceled and Quickley remained
on the bench. No lineup write request, payload, or acceptance is proven.
Claude's local ESPN memory was inspected; its captured settings and FREEAGENT
requests are useful precedent but do not establish lineup-write support.

## Implemented flow

`/my-team` renders roster rows as the controls. The first tap selects a player;
the second submits a highlighted destination. The server must supply explicit
provider-approved destinations in addition to domain eligibility checks.
Missing destinations deny all moves. Production returns fresh read-only rosters
only when reads and the matching owner grant are enabled, and no executable
destinations. Failed reads return an explicit error and no stale audit snapshot.
The UI groups starters, bench, and reserves, with a whole-roster Refresh button.
Unknown lock timestamps are labeled unavailable, never converted into unlocked
time windows. Read access is rechecked after ESPN responds in case it was revoked.

The lifecycle is REQUESTED → VALIDATING → EXECUTING → VERIFYING → SUCCEEDED,
FAILED, or UNKNOWN. Every transition, actor, target, request, timestamp, and
before/after snapshot stays in the private operation ledger. The existing
Neon state compare-and-set persists the ledger and roster mutex atomically.
The JSON fallback uses the existing serialized local writer; run only one local
server process against that file. Use DATABASE_URL for multi-instance hosting.

An idempotency ID is bound to actor and request. Duplicate requests do not write
again. An uncertain write retains the roster mutex indefinitely. Read-only
reconciliation may confirm success; mismatches remain UNKNOWN. Timers never
release an uncertain mutex. Provider errors are replaced with safe messages;
raw HTTP configuration, cookies and stack traces do not enter the ledger.

Freshness (30 seconds), SHA-256 revision, complete roster content, both participants'
eligibility, and all applicable locks are checked before execution. The cutoff
defaults to ten minutes and can be increased with
`LINEUP_SAFETY_CUTOFF_MINUTES`. Invalid or smaller configured values use ten.
Missing reliable lock data denies the move. Provider capability must validate
the full plan and any intermediate browser steps; reciprocal eligibility alone
does not prove a two-player swap can be executed.

Repeated ESPN UTIL/bench slots share a position type rather than durable
instance IDs. With explicit ESPN slot-capacity rules, verification compares the
exact player multiset within every position type and checks all configured
capacities. An unlimited bench may lose an excess empty display row after a
promotion. This does not permit an unrelated player or position change.

The observed read responses omit exact lock timestamps. The parser deliberately
keeps those null, and shared move validation refuses execution. It currently
accepts only the observed lock enums; unsupported settings fail closed. An
unlocked flag alone cannot satisfy the ten-minute cutoff. ESPN eligibleSlots
also includes IR for healthy players, so it is not sufficient proof of IR legality.

Access is default deny. The existing server-verified owner identity is reused;
guests, impersonated sessions, and temporary PIN accounts cannot manage lineups.
The commissioner can grant their own config-mapped team in the configured ESPN
league and revoke any existing grant. Later beta grants/delegation are not yet
enabled. The client cannot submit a target league or team in a move request.
The service rechecks the grant in the atomic transition immediately preceding
execution. Private lineup state is removed from the general league-state API.

## Authentication and browser-worker setup gate

No new ESPN secret is required for this read-only release. Existing read cookies
remain server-side and are not interpreted as evidence of write permission.
Do not copy cookies into source, client storage, issue text, logs or screenshots.

Before implementing `EspnBrowserSession`:

1. Use a private server-side browser context on a host that supports a persistent
   browser worker. Current Vercel Express deployment is not evidence of that.
2. Sign in through ESPN normally. The owner completes login, MFA and any CAPTCHA.
   Store any resulting session state in an encrypted secret store with restricted
   worker access. Never place it in the public client or durable operation ledger.
3. Read the authenticated ESPN account and league/team identity. Confirm it owns
   the configured team. The initial repository map is not fresh ESPN proof.
4. Use LM Tools → Roster Moves → Edit Roster → authorized team → Perform as
   Team Manager. Do not substitute the ordinary My Team workflow or Perform as
   League Manager. Check the observed editor URL with
   `assertLmTeamManagerContext` immediately before any future submission.
   Establish reliable
   scoring-period selection, roster slots (including repeated slots), eligibility,
   league cadence, player/period locks, and legal ordinary-manager destinations.
5. Capture a real user-authorized lineup operation or implement the observed
   ordinary browser controls. Evaluate endpoint stability and permission behavior
   before choosing an undocumented request over browser automation.
6. Implement uncached independent read-back. A successful POST, click, toast, or
   optimistic local roster update cannot confirm success.
7. Cover session expiration, navigation changes, timeout after submission, and
   worker restart. The adapter must never retry a write automatically.
8. Return provider-approved executable destinations from My Team GET only once
   the full write mechanism is verified. Fresh read-only snapshots already use
   `EspnReadOnlyLineupProvider`.
   Bind revision to period, locks, eligibility, slots and player IDs. Reuse the
   service's revalidation and operation ledger rather than putting writes in UI.

## Precise manual validation

In a preview deployment, sign in directly as the commissioner. Open Scores →
My Team. Confirm it says lineup changes are off. In Admin → Lineup access,
enter the configured league ID and your config-mapped team ID. Grant and revoke
access. Confirm execution remains off, a normal member cannot change grants,
and neither browser client nor network responses contain ESPN cookies. To test
read-only loading, set ESPN_LINEUP_READS_ENABLED=1 in that preview environment,
with the existing ESPN read credentials. The roster should load with disabled
rows and missing-lock notices; turning on reads must never enable moves. No
secrets or grants were provisioned in production during this task.
For the observed 2026–27 season, verify ESPN_SEASON_ID is 2027 before enabling
reads. The older generic environment example may still name the prior season.

After the browser adapter and hosting are verified, explicitly authorize one
specific own-team move, naming player, destination, scoring date and team.
Choose an unlocked move more than ten minutes before every applicable lock.
Record the complete before lineup, execute once, reload ESPN independently,
and compare every slot. Verify the operation is SUCCEEDED only after read-back.
Test on a phone and desktop: tap rows twice, double-tap the destination, change
the roster directly in ESPN between taps, revoke access during validation, and
interrupt the response after execution. The last case must stay UNKNOWN and
block subsequent writes until reconciliation. Do not test against other teams.

Undo is not offered by the disabled provider. A future adapter may offer it only
as a new separately validated move against fresh state, with a brief expiry.
Never promise undo after a lock. UNKNOWN states that do not reconcile need an
operator to inspect ESPN and the ledger; do not delete a mutex or replay a job
without first proving what happened. Interrupted REQUESTED/VALIDATING jobs also
need operator review; no background resume worker is included in this release.

## Validation and known limits

Domain and service tests simulate provider data. They do not prove ESPN writes.
API tests use an isolated local store and verify default deny, own-team grants,
target injection rejection, disabled execution, and private-state redaction.
Run `npm test`, `npm run lint`, and `npm run build` before review. The build
retains existing schedule JSON-import and bundle-size warnings.
The current full suite passes 1,345 tests, including the observed-shape parser,
GET transport, read authorization/revocation, and repeated-slot verification
cases. Lint and the TypeScript/Vite build pass.
Browser QA used an isolated loopback-only simulated provider, with no ESPN
requests. Desktop and 390×844 phone checks covered selection, highlighted
destinations, Moving, disabled rows during submission, and the saved result.
Both light and dark themes were inspected; a light-theme contrast defect found
during QA was corrected. These checks establish the simulated UI flow only.
Read-only browser QA also loaded the sanitized captured roster locally: 14
players in 16 displayed slots, split into starters, bench and reserves. All 16
rows were disabled and unselected. Phone layout had no horizontal overflow;
Refresh roster remained a read-only action. A false-selected empty-slot bug
found during this check was fixed. No fixture or HAR containing private
request headers is committed.
The operation ledger has a 2,000-record guard; add archival before enabling a
long-running integration. UNKNOWN records must be retained during archival.

No browser-worker implementation, ESPN login provisioning, live server-cookie
read validation, live move, undo provider, beta delegation, or production
deployment is included. The read parser was validated against the sanitized
captured ESPN response as well as synthetic fixtures. The live browser session
was inspected without a roster change; the new server GET transport was tested
with fixtures rather than transferring the browser's cookies into this checkout.
These remain explicit integration work, not silent fallback behavior.

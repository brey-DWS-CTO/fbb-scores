# Handoff: projections and a mock draft

Read `CLAUDE.md` at the repo root before anything else. It governs how work
lands here: branch, pull request, preview, merge. The league is live with ten
real people and the draft is **Sunday 18 October 2026, 2:00 PM Pacific**.
Keepers are due 24 hours earlier.

Everything below is commissioner-only until it is good enough to show the
league. Gate it the way `ScheduleAdmin` and `PlayerPoolAdmin` are gated.

## The problem, in the commissioner's own words

This is a real text conversation from 6 September 2026. Kyle is negotiating a
trade with Brey, and the deciding question is what the board looks like if the
deal happens versus if it does not.

> **Kyle:** By Derek and Amy picking behind me right?
>
> **Brey:** Yep. And if we don't do this deal I'll keep Cade.
>
> **Brey:** I'm gonna build mock drafting based on projected keepers (and real
> after everyone locks them in) into my app soon. But until then the draft is
> gonna be like this
>
> 1. Joel - Jokic
> 2. Ryan - SGA/Giannis
> 3. Pat - Whoever is left of sga/Giannis
> 4. Bryan - could take Cade here
> 5. Your pick
> 6. Dustin - keeps Tatum
> 7. Aaron's pick
> 8. Derek - keeps Wemby
> 9. My pick
> 10. Amy - keeps Luka

**That list is the product.** A commissioner typing out round one by hand,
from memory, into a text message, because the app cannot answer it yet.

Read it closely and notice what it actually contains:

- **Assumed keepers for other teams.** "Dustin - keeps Tatum", "Amy - keeps
  Luka". Nobody has locked keepers yet, so these are guesses.
- **A distinction between a keeper slot and a live pick.** Slots 5, 7 and 9
  are "your pick", "Aaron's pick", "my pick". The rest are consumed.
- **Uncertainty carried forward.** "Whoever is left of SGA/Giannis" at 3
  depends on what happens at 2.
- **A conditional.** "If we don't do this deal I'll keep Cade" changes Brey's
  own keeper, which changes his pick, which changes everything after it.

A tool that answers this is worth more than one that ranks players.

The draft order in `src/data/source/league-2027-config.json` matches that
message exactly: 1 Joel, 2 Ryan, 3 Patrick, 4 Bryan, 5 Kyle, 6 Dustin,
7 Aaron, 8 Derek, 9 Brey, 10 Amy.

## Before you design anything: go and look at the good ones

**Do this first. Do not skip it and do not design from imagination.**

Mock draft tools are a solved genre. People arrive already knowing how one
works, and every convention you invent instead of borrowing is a thing ten
league members have to learn for no reason. Study these and write down what
they do, then match it unless there is a reason not to:

- **Sleeper** — the best draft room in the business. Look at the queue, the
  positional filters, the tier breaks, how "you are on the clock" feels, and
  how it behaves on a phone. This app is phone-first, and Sleeper is the bar.
- **Yahoo Fantasy** — mock draft lobby, autopick behaviour, pre-draft
  rankings you can drag to reorder.
- **FantasyPros Draft Wizard** — the closest thing to what is being asked
  for here. Look hard at Draft Simulator and Mock Draft Simulator: how it
  presents "who will be there at your next pick", how it grades a pick, and
  how it shows a distribution rather than a single answer.
- **ESPN's own** — the league already lives in ESPN, so its conventions are
  the ones these ten people know best.

Report what you learned before building. The specific things worth stealing:

1. **A queue or watchlist.** Every one of these has it. It is the single
   most used feature in a live draft room.
2. **Best available, filtered by position**, with the user's own ranking able
   to override the default.
3. **Tier breaks** drawn on the list, not just an ordered column. A visible
   gap between tier 3 and tier 4 is how people decide to trade down.
4. **"Your pick in N"** and how long you have.
5. **A pick grade or value delta**, comparing where a player went against
   where they were ranked. This is the part people screenshot.
6. **Distribution, not prophecy.** "Available at 2.09: Cade 62%, Tatum 41%"
   beats one name pretending to be certain.

Where this tool must differ from all of them, and where it beats them:

- **Keepers.** None of those tools models a keeper league with pick costs,
  tier bumps and contracts. This app already does.
- **This league's weekly schedule.** You know games per team per week for
  2026-27. They do not. See the value model below.
- **Real pick ownership.** Traded picks, resolved. Sleeper knows this for its
  own leagues; a generic simulator does not.

## What already exists, so you do not rebuild it

Read these before writing anything. There is more here than you would guess.

| Thing | Where | Notes |
| --- | --- | --- |
| Every pick, snake order, trade ownership resolved | `buildAllPicks` in `src/lib/keeper/engine.ts` | `PickSlot` carries `round`, `slot`, `overall`, `originalOwner`, `currentOwner`, `viaTradeFrom` |
| Which pick a keeper is charged to | `resolveTeamKeepers` | Charges the **latest** pick owned at or better than the tier round. Ryan holding 4.4 and 4.9 pays 4.9 |
| The board, keepers and picks together | `buildDraftBoard` | |
| Who is left | `availablePlayers(dataset, dynamic)` | Already subtracts keepers and made picks |
| Projecting another team's keepers | `src/lib/league/keeperScenario.ts` | **This is the text message's "projected keepers", already built and already private per viewer** |
| The player pool | `src/lib/league/playerPool.ts` | Immutable snapshot, 324 players, keyed on `espnId` |
| Games per team per week for 2026-27 | `src/lib/league/schedule.ts` | `summarizeAllTeamSchedules`, per-week counts plus play-in and playoff totals |
| Pick trades, and what they do to keepers | `src/lib/league/pickTrades.ts` | Includes `ownersResetByTrade` and `keeperChargedPicks` |

League shape: **10 teams, 14 rounds, keeper tiers span rounds 1 to 10, 324
players.** Roster is 14 plus 1 IR, starting 10: 1 C, 1 PF, 1 SF, 1 SG, 1 PG,
1 F, 1 G, 3 FLEX.

Scoring is a points league and **is never hardcoded**. It arrives live from
ESPN's `mSettings` as `scoringSettings.scoringItems` and `computeFpts`
multiplies. Keep it that way.

## Ranking data: what is available today

I checked this against ESPN on 7 September 2026.

### Available right now, verified

**ESPN's draft ranking data is live and populated for 2026-27 today.** From
one `kona_player_info` call, per player:

| Field | Example |
| --- | --- |
| `ownership.averageDraftPosition` | Jokic 1.75, SGA 2.92, Wembanyama 3.01 |
| `draftRanksByRankType.STANDARD` | rank plus `auctionValue`, Jokic rank 1, value 65 |
| `draftRanksByRankType.ROTO` | Wembanyama rank 1, value 68 |
| `ownership.percentOwned` | 99.9 for the top players |

I pulled those numbers myself. They are real, current, and enough to build
and ship the entire tool. **Nothing is blocked on projections.**

### Not available yet, verified

**Full-season stat projections (`102027`) do not exist yet.** I requested
them by name through `filterStatsForTopScoringPeriodIds.additionalValue` and
got nothing back. `002027` exists but is empty, which fits a season that has
not started.

What is confirmed about the mechanism, for when they do arrive:

- `statSourceId` is `0` for an actual line, `1` for a projection. The stat
  entry id is `{statSourceId}{statSplitTypeId}{seasonId}`, so `102027` is the
  full-season 2026-27 projection.
- **This app has been discarding projections on every call since it was
  built.** `src/lib/espn/adapter.ts` filters `statSourceId === 0` in nine
  places; `scripts/fetch-keeper-data.ts` does the same.
- A projection row carries a raw stat dictionary. I pulled `102026` and it
  has 31 populated keys, in the exact ids this app already reads: `0` PTS,
  `1` BLK, `2` STL, `3` AST, `6` REB, `11` TO, `13`/`14` FGM/FGA. So it goes
  straight into `computeFpts` and comes out as projected FPPG **in this
  league's scoring**, keyed on `espnId`, with no name matching at all.

Re-check weekly. These usually land closer to opening night.

## No projections yet: what the board shows

**Never alphabetical. Alphabetical ordering is a bug, not a fallback.**

Order players by the best source available, in this order, and **always name
the source on screen** so nobody mistakes last season for a forecast:

1. **Projected FPPG** in this league's scoring, once `102027` exists.
   Label: "2026-27 projection".
2. **ESPN draft rank or ADP**, live today. Label: "ESPN draft rank". This is
   ESPN's own ranking for the coming season, so it is a genuine forecast, not
   a historical number.
3. **Last season's FPPG** in this league's scoring, from `stats2026` or
   `api2026` in the committed dataset. This is what keeper tiers already use.
   Label: "2025-26 actual".

Rules for the fallback:

- **Show which source ranked the list, always**, as a visible label and not a
  tooltip. A commissioner comparing two mocks needs to know whether he is
  looking at a forecast or last year.
- **Let the user switch source** and see the board reorder. Comparing "ESPN
  rank" against "last season" is genuinely useful and costs nothing once both
  are loaded.
- **A player with no data in any source goes last**, marked "no data", not
  silently sorted into the middle. Rookies will hit this.
- When projections arrive, this becomes a one-line default change, not a
  rewrite. Design for that.

## What to build, in order

Nothing here waits on projections.

### 1. A ranking snapshot

Follow the pattern already in the repo twice over: fetch a candidate, show
the commissioner every change, write only when they accept, store immutable.
Read `server/lib/playerPoolService.ts` and `server/lib/teamNameService.ts`
and copy their shape. Do not invent a third pattern.

Capture in one snapshot: ADP, STANDARD and ROTO rank, auction value, percent
owned, and the projection stat dict when `102027` starts returning. Key the
projection on `10{season}` so it works for any year.

### 2. A value model, not a ranking

Raw FPPG does not rank a draft, and this is where the tool earns its keep.

The league starts 10 and caps games per week, so what matters is value over
the replacement player **at each position**, weighted by projected games
played and by the weekly schedule this app already holds. A 40 FPPG player
whose team plays two games that week is worth less than the number says.
Nobody else's draft tool knows this league's schedule grid. You do.

Keep it pure, in `src/lib/league/`, tested with no server and no browser.

### 3. The simulation

**The opponent model is the whole thing.** Nine bots taking the
best-available player make a mock useless, because real people reach and real
people have needs. Blend:

- value from step 2
- ESPN ADP from step 1, which is what makes bots reach like humans do
- positional need for that team's current roster
- noise

Then pick from the top few rather than always the top one.

It must fill 1 C, 1 PF, 1 SF, 1 SG, 1 PG, 1 F, 1 G, 3 FLEX and notice when a
slot has become unfillable.

**Run it many times with a seed.** One mock draft is an anecdote. The useful
answer is "across 200 drafts from slot 9, here is who was there at 2.09 and
how often". Seeded, so a result can be reproduced and argued about in the
group chat.

### 4. What-if worlds

This is the feature that answers the text message, and it has two kinds of
assumption. Both must be switchable, and the board and the mock must both
follow whatever is switched on.

**Assumed keepers.** Set what you think each other team keeps.
`keeperScenario` already does this, is already private per viewer, and is
already what the message means by "projected keepers". Do not build a second
mechanism. Once a team has really locked, use the real keepers and mark them
as known rather than assumed.

**Pending trades.** Every offer sitting in the commissioner's inbox or sent
box becomes a switch: **"what if this one is accepted?"** Turn it on and the
board redraws with the picks moved, and the mock runs from that world.

This is what Kyle and Brey were actually doing over text. It is the whole
conversation.

Rules for trade what-ifs:

- Only **pending** proposals are switchable. Accepted ones are already true;
  rejected and pulled ones are gone.
- **Two proposals that move the same pick cannot both be on.** Turning one on
  greys the other out and says why. This is the conflict rule the
  commissioner asked for, and `pickRefKey` already gives you the identity to
  compare on.
- **A trade that moves a charged keeper pick resets that owner's keepers.**
  That rule is live: see `ownersResetByTrade` and `keeperChargedPicks` in
  `pickTrades.ts`. A what-if that ignores it would show a board that cannot
  happen. Model the reset, and show it, because it is exactly the kind of
  consequence somebody would miss.
- Switching a trade on must never write anything. It is a view.
- Show plainly which assumptions are on. A board built on three guesses and a
  hypothetical trade must not look like fact.

### 5. The screen that answers the text message

This is the acceptance test. Build it so Brey never types that message again.

1. **Round one as a list of slots**, each either a keeper (with the player)
   or a live pick, exactly like the message.
2. **Assumed keepers editable**, board updates live.
3. **Pending trades as switches**, board updates live.
4. **"Who is likely there at my pick"** as a probability across many seeded
   runs, not a single name.
5. **Two worlds side by side.** "If I keep Cade" against "if I make this
   trade". The conditional is the reason the conversation happened.

Before the reveal, keepers are secret. The tool must make clear which keepers
are **assumed** and which are **known**, and never leak a real keeper into a
view meant to be a guess. There is a live precedent for how carefully this is
handled: the `detailed` flag in `previewProposal`, and the test named "what a
hidden keeper costs does not leak through the summary".

## Rules you must not break

In `src/data/source/rulebook-2027.json`. Read the clause, do not trust this
summary.

- **Keepers:** up to 2 per team. Cap is `round3max + round3min` FPPG. Two in
  the same tier bumps the second to a better pick. No two round-1 tier
  keepers.
- **A keeper is charged to the latest pick** owned at or better than its tier.
  Open issue `keeper-charged-latest-pick`.
- **Pick trading:** every round before the draft starts, rounds 3 to 10 once
  it has. Max 2 traded away per year, max 2 held in any round.
- **The app is the ledger** for pick trades and keeper contracts, not ESPN.

## Conventions

- Pure logic in `src/lib/league/*.ts`, tested with no server and no browser.
  See `src/lib/league/polls.ts` and `tests/polls.test.ts`.
- `src/index.css` is append-only per feature. The block titled "Offsets around
  the two nav bars" stays last in the file.
- Never re-implement keeper maths. `src/lib/keeper/engine.ts` is the only
  place it happens.
- TypeScript is strict: `erasableSyntaxOnly`, `noUnusedLocals`, no enums, no
  underscore escape. `npm run build` typechecks `server/` as well as `src/`.
- Icons are drawn, not emoji. Use `NavIcon`.
- Orwell's rules for every word a person reads. No em dashes.
- Phone first. Sleeper is the bar.

## Done looks like

- `npm test`, `npx eslint .` and `npm run build` all clean.
- A written note on what Sleeper, Yahoo, FantasyPros and ESPN do, and which
  conventions were matched.
- The commissioner opens one screen, sets assumed keepers for the other nine
  teams, and reads round one as a list with keeper slots and live picks
  marked differently.
- He flips his own keeper and watches the board change.
- He switches on a pending trade and watches the board change again, with
  conflicting proposals greyed out and any keeper reset shown.
- He asks what is likely available at 2.09 and gets a distribution over many
  seeded runs.
- The board says which ranking source it used, and works today on ESPN draft
  rank with no projections at all.
- Nothing secret leaks. An assumed keeper never becomes a real one on screen.
- **Brey can answer Kyle's question without typing a list by hand.**

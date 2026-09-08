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
  are "your pick", "Aaron's pick", "my pick". The rest are consumed by a
  keeper.
- **Uncertainty carried forward.** "Whoever is left of SGA/Giannis" at 3
  depends on what happens at 2.
- **A conditional.** "If we don't do this deal I'll keep Cade" changes Brey's
  own keeper, which changes his pick, which changes everything after it.

A tool that answers this is worth more than one that ranks players.

The draft order in `src/data/source/league-2027-config.json` matches that
message exactly: 1 Joel, 2 Ryan, 3 Patrick, 4 Bryan, 5 Kyle, 6 Dustin,
7 Aaron, 8 Derek, 9 Brey, 10 Amy.

## What already exists, so you do not rebuild it

Read these before writing anything. There is more here than you would guess.

| Thing | Where | Notes |
| --- | --- | --- |
| Every pick, snake order, trade ownership resolved | `buildAllPicks` in `src/lib/keeper/engine.ts` | `PickSlot` carries `round`, `slot`, `overall`, `originalOwner`, `currentOwner`, `viaTradeFrom` |
| Which pick a keeper is charged to | `resolveTeamKeepers` | Charges the **latest** pick owned at or better than the tier round. Ryan holding 4.4 and 4.9 pays 4.9 |
| The board, keepers and picks together | `buildDraftBoard` | |
| Who is left | `availablePlayers(dataset, dynamic)` | Already subtracts keepers and made picks |
| Projecting another team's keepers | `src/lib/league/keeperScenario.ts` | `scenarioWithProjectedKeepers`, `stateWithKeeperScenario`. **This is exactly the text message's "projected keepers", already built and already private per viewer** |
| The player pool | `src/lib/league/playerPool.ts` | Immutable snapshot, 324 players, keyed on `espnId` |
| Games per team per week for 2026-27 | `src/lib/league/schedule.ts` | `summarizeAllTeamSchedules`, per-week counts plus play-in and playoff totals |
| Pick trades and their effect on keepers | `src/lib/league/pickTrades.ts` | Includes `ownersResetByTrade`, since trading a charged pick resets that owner's keepers |

League shape, from the committed dataset: **10 teams, 14 rounds, keeper tiers
span rounds 1 to 10, 324 players.** Roster is 14 plus 1 IR, starting 10:
1 C, 1 PF, 1 SF, 1 SG, 1 PG, 1 F, 1 G, 3 FLEX.

Scoring is a points league and **is never hardcoded**. It arrives live from
ESPN's `mSettings` view as `scoringSettings.scoringItems` (statId to points)
and `computeFpts` multiplies. Keep it that way.

## Projections: what is verified and what is not

I checked this against ESPN on 7 September 2026. Do not repeat the research;
do repeat the one call, because the answer will change.

**Verified true:**

- ESPN returns a list of stat lines per player. `statSourceId` is `0` for an
  actual line and `1` for a projection.
- **This app has been discarding projections on every call since it was
  built.** `src/lib/espn/adapter.ts` filters `statSourceId === 0` in nine
  places, and `scripts/fetch-keeper-data.ts` does the same.
- The stat entry id is `{statSourceId}{statSplitTypeId}{seasonId}`. So
  `102027` would be the full-season 2026-27 projection.
- A projection row carries a **raw stat dictionary**, not just a total. I
  pulled `102026` and it has 31 populated keys.
- Those keys are the ones this app already reads: `0` PTS, `1` BLK, `2` STL,
  `3` AST, `6` REB, `11` TO, `13`/`14` FGM/FGA. So a projection row can go
  straight into `computeFpts` and come out as projected FPPG **in this
  league's scoring**, with no name matching at all, keyed on the `espnId`
  the pool already uses.

**Verified false, for now:**

- **`102027` does not exist yet.** I requested it by name through
  `filterStatsForTopScoringPeriodIds.additionalValue` on the public
  `leaguedefaults` path and got nothing back. `002027` exists but is empty,
  which fits a season that has not started.

**Not verified:** whether the authenticated league path differs from the
public one. I had no ESPN cookies locally; they live only in Vercel. My read
is that this is timing rather than permissions, because ESPN publishes
projections league-wide.

**So the first job is a ten-minute check, not a build.** Run the
`kona_player_info` call against season 2027 with `102027` in the filter,
using the real cookies, and dump one player's `stats` array. If a row comes
back with `statSourceId: 1`, `statSplitTypeId: 0`, `seasonId: 2027` and a
populated dict, everything below gets easy. Re-check weekly if not; these
usually land closer to opening night.

**If they never appear**, the fallback is FantasyPros at about $108/year,
which is the only source with a written personal-use licence. DARKO is free
and good but has no licence at all. Rotowire, Dunks & Threes and NBA.com all
forbid what would be needed, and NBA.com names fantasy use directly. That is
the commissioner's call, not yours.

## What to build, in order

### 1. A projection snapshot

Follow the pattern already in the repo twice over: fetch a candidate, show
the commissioner every change, write only when they accept, store immutable.
Read `server/lib/playerPoolService.ts` and `server/lib/teamNameService.ts`
and copy their shape. Do not invent a third pattern.

Key it on `10{season}` so it works for any year. Store projected per-game
stats plus the derived FPPG under this league's scoring.

The same call also returns `ownership.averageDraftPosition` and
`draftRanksByRankType`. **Capture ADP in the same snapshot.** You need it in
step 3 and it is free here.

### 2. A value model, not a ranking

Raw projected FPPG does not rank a draft, and this is where the tool earns
its keep.

The league starts 10 and caps games per week, so what matters is value over
the replacement player **at each position**, weighted by projected games
played and by the weekly schedule this app already holds. A 40 FPPG player
whose team plays two games in a week is worth less that week than the number
says. Nobody else's draft tool knows this league's schedule grid. You do.

Keep it pure, in `src/lib/league/`, tested with no server and no browser.

### 3. The simulation

**The opponent model is the whole thing.** Nine bots taking the
best-projected-available player make a mock useless, because real people
reach and real people have needs. Blend:

- projected value from step 2
- ESPN ADP from step 1
- positional need for that team's current roster
- noise

Then pick from the top few rather than always the top one.

It must fill 1 C, 1 PF, 1 SF, 1 SG, 1 PG, 1 F, 1 G, 3 FLEX and notice when a
slot has become unfillable.

**Run it many times with a seed.** One mock draft is an anecdote. The useful
answer is "across 200 drafts from slot 9, here is who was there at 2.09 and
how often". Seeded, so a result can be reproduced and argued about in the
group chat.

### 4. The screen that answers the text message

This is the acceptance test. Build it so Brey never has to type that message
again.

It must:

1. **Show round one as a list of slots**, each either a keeper (with the
   player) or a live pick, exactly like the message.
2. **Let him set assumed keepers for other teams** and see the list change.
   `keeperScenario` already does this and is already private to the viewer,
   so do not build a second mechanism.
3. **Answer "who is likely there at my pick"** with a probability, not a
   single name. That is what 200 seeded runs are for.
4. **Compare two worlds side by side.** "If I keep Cade" against "if I make
   this trade". The conditional is the reason the conversation was happening
   at all. A mock draft that cannot answer a what-if has missed the point.

Before the reveal, keepers are secret. The tool must make clear which
keepers are **assumed** and which are **known**, and it must never leak a
real keeper into a view that is meant to be a guess. There is a live
precedent for how carefully this is handled: see the `detailed` flag in
`previewProposal` and the test named "what a hidden keeper costs does not
leak through the summary".

## Rules you must not break

These are in the rule book at `src/data/source/rulebook-2027.json`; read the
clause rather than trusting this summary.

- **Keepers:** up to 2 per team. Cap is `round3max + round3min` FPPG. Two
  keepers in the same tier bump the second to a better pick. No two round-1
  tier keepers.
- **A keeper is charged to the latest pick** you own at or better than its
  tier. Written up as open issue `keeper-charged-latest-pick`.
- **Pick trading:** every round before the draft starts, rounds 3 to 10 once
  it has. Max 2 picks traded away per year, max 2 held in any round. Four
  open rule book issues cover where the app is deliberately ahead of the
  written rules.
- **The app is the ledger** for pick trades and keeper contracts, not ESPN.

## Conventions

- Pure logic in `src/lib/league/*.ts`, tested with no server and no browser.
  See `src/lib/league/polls.ts` and `tests/polls.test.ts`.
- `src/index.css` is append-only per feature. The block titled "Offsets
  around the two nav bars" must stay last in the file.
- Never re-implement keeper maths. `src/lib/keeper/engine.ts` is the only
  place it happens.
- TypeScript is strict: `erasableSyntaxOnly`, `noUnusedLocals`, no enums, no
  underscore escape for unused variables. `npm run build` typechecks `server/`
  as well as `src/`.
- Icons are drawn, not emoji. Use `NavIcon`.
- Orwell's rules for every word a person reads. No em dashes.

## Done looks like

- `npm test`, `npx eslint .` and `npm run build` all clean.
- The commissioner can open one screen, set assumed keepers for the other
  nine teams, and read round one as a list, with keeper slots and live picks
  marked differently.
- He can flip one assumption, his own keeper included, and watch the board
  change.
- He can ask what is likely available at 2.09 and get a distribution over
  many seeded runs, not one name.
- Nothing secret leaks. An assumed keeper never becomes a real one on screen.
- **Brey can answer Kyle's question without typing a list by hand.**

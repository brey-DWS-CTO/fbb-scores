# Mock draft research: what the good ones do

Read before designing any mock draft screen. Written 7 September 2026 from
the official help pages and product pages of Sleeper, Yahoo, FantasyPros
Draft Wizard and ESPN, plus a few reviews where the vendor says nothing. Each
fact names its source. Where a fact came only from a search snippet of a page
that refused to load, it says so. Nothing here was checked by drafting in the
apps; do that before copying a detail that matters.

The purpose is to borrow, not invent. Ten people already know how a draft room
works. Every convention we make up is a thing they have to learn for nothing.

## Sleeper

The bar for a phone draft room.

- Mock setup: you tap the draft board slot you want. Settings gear sets snake
  or linear, third round reversal, time per pick, roster size, team count, and
  the player pool (all, rookies only, vets only). Opponents can be bots, real
  people, or both. Past mocks are saved.
  ([how to mock](https://support.sleeper.com/en/articles/4662857-how-to-conduct-a-mock-draft),
  [create a mock](https://support.sleeper.com/en/articles/3982891-how-to-create-a-mock-draft))
- Keepers are cells on the grid. Before the draft you tap a square and pick the
  player. There is no separate keeper list. The product page lists "fully
  editable draftboards for keeper setup" and custom ADPs.
  ([mock draft page](https://sleeper.com/mockdraft))
- Picks can be traded mid-draft and any pick can be undone. Help articles cover
  compensatory picks and skipped picks, so the board tolerates uneven pick
  ownership. ([why Sleeper](https://support.sleeper.com/en/articles/1876028-why-you-should-use-sleeper-for-any-draft))
- Two lists, not one: a Draft Queue that exists only around the draft, and a
  season-long Watch List. A queued player drops off the moment anyone drafts
  him. ([queue vs watch list](https://support.sleeper.com/en/articles/3989685-watch-list-vs-draft-queue))
- Autopick takes your queue first, then "what positions my team needs" from the
  higher-ranked players left. ([autopick](https://support.sleeper.com/en/articles/4038850-where-does-the-cpu-auto-pick-from))
- The timer is soft. With autopick off, "nothing will happen" when time runs
  out. The commissioner can pause without limit, change the clock mid-draft,
  and force a pick. ([timer](https://support.sleeper.com/en/articles/4029085-how-does-the-draft-timer-work))
- Phone layout: the board is one view; players, Queue, Roster and Chat are
  tabs. The web version cannot show the queue, roster or chat tabs at all,
  which tells you the phone is the primary design.
  ([web draft limits](https://support.sleeper.com/en/articles/4701435-can-i-draft-on-the-web-app))
- Ordering and tiers: the official docs never name the default sort or a
  ranking source label. Third-party guides say the list shows ADP with tier
  marks and that autopick falls back to Sleeper's own rankings. Unverified.
  ([fantasyjoes review](https://fantasyjoes.gg/sleeper-draft))

## Yahoo Fantasy

- Mock lobby is a table: room, numbered slots 1 to 14 each with a Join button,
  start time, league type. You pick your slot by joining it.
  ([basketball lobby](https://basketball.fantasysports.yahoo.com/nba/mock_lobby))
- Instant mocks (paid) use bots running a "Value Over Last Starter" model and
  mirror your league settings. Not offered for keeper or dynasty leagues.
  ([help](https://help.yahoo.com/kb/SLN37117.html))
- Default clock 60 seconds. Star a player to queue him. A message above the
  draft order says when it is your turn. Time out, leave, or miss the draft and
  autopick uses your pre-rank. ([live draft](https://help.yahoo.com/kb/live-standard-draft-sln6230.html))
- Pre-draft rankings: sort and filter by position, drag players into your list,
  keep a Do Not Draft list. Autopick takes the highest of your pre-rank, then
  Yahoo's default rank, filtered by position need, starters before bench.
  ([pre-rank](https://help.yahoo.com/kb/SLN6163.html))
- The 2025 to 2026 redesign put the Draft Board on its own tab on phones,
  added inline position filters, a list of your upcoming picks, and per-pick
  draft grades in real time for head-to-head leagues.
  ([redesign](https://sports.yahoo.com/fantasy/article/a-faster-redesigned-draft--welcome-to-the-new-yahoo-fantasy-draft-experience-125520188.html))
- The player list sorts by ADP or projected stats, and a paid filter re-sorts
  it to a named analyst's board. ([experts in the room](https://sports.yahoo.com/fantasy/article/draft-like-the-experts--now-built-right-into-your-draft-125550753.html))
- Keepers: "each Keeper takes the place of a draft pick." The commissioner sets
  which pick each keeper uses; that team is skipped in that round.
  ([keepers](https://ca.help.yahoo.com/kb/SLN6111.html))
- Traded picks must be imported by the commissioner before keepers are
  assigned. ([traded picks](https://help.yahoo.com/kb/SLN6453.html))

## FantasyPros Draft Wizard

The closest thing to what is being asked for here.

- Setup syncs a league from Yahoo, ESPN, Sleeper, CBS or Fantrax, pulling
  scoring, rosters, keepers and draft order. Keepers are entered per team with
  the round they cost. Custom scoring is a paid feature.
  ([draft software](https://draftwizard.fantasypros.com/basketball/draft-software/),
  [blog](https://blog.fantasypros.com/08-22-2023-making-the-most-of-the-mock-draft-simulator/))
- Rankings are Expert Consensus Rankings from 60 or more basketball experts,
  with tiers, tags and notes built into the cheat sheet. NBA consensus ADP is a
  composite of exactly two hosts, Yahoo and ESPN.
  ([ADP page](https://www.fantasypros.com/nba/adp/overall.php))
- **Pick Predictor** is the standout. It shows the percent chance each player
  is still there at your next pick, switchable to one, two or three rounds
  out, colour-coded for risk. It comes from running simulations against every
  cheat sheet and ADP source in their database, adjusted for players gone,
  opponents' roster needs, and picks remaining. (Support pages returned 403;
  facts from search snippets of
  [What is the Pick Predictor](https://support.fantasypros.com/hc/en-us/articles/115001315067-What-is-the-Pick-Predictor).)
- In-draft, "ADP Alerts" flag a reach. After the draft, the analyzer grades the
  team: projected standings, positional ranks, steals and reaches. The draft
  score is total value over the replacement player on waivers, from consensus
  projections; a steal is a pick two or more rounds after ADP. (Snippets of
  [What is the Draft Score based on](https://support.fantasypros.com/hc/en-us/articles/115001354808-What-is-the-Draft-Score-based-on).)
- Bots draft "against logic" with position-value sliders, and "Draft Intel"
  models your league mates' tendencies from two or more seasons of history.

## ESPN

The conventions these ten people know best.

- Mock lobby is a table of rooms: name, draft type, league type, time,
  members (for example 1/10). You join a room, not a slot. Rooms start on
  five-minute marks and slip until full.
  ([lobby](https://fantasy.espn.com/basketball/mockdraftlobby),
  [draft methods](https://support.espn.com/hc/en-us/articles/360003780852-Draft-Methods))
- Draft room: the pick order runs across the top with your team in yellow.
  The player list sorts by position, NBA team, or ESPN's projected stats, with
  a search box. Drag players into the queue in the order you rank them. The
  clock sits top left and, at zero, takes the top player in your queue. You
  select, confirm in "Selected Player", then press the red Draft Player button.
  ([mock drafts](https://www.espn.com/fantasy/basketball/story/_/id/20806648/mock-drafts))
- Queue has no size limit; queued players go first on autopick. Autopick
  falls back to your pre-ranked list, then ESPN's default rankings, taking the
  best player who fits an open slot. Draft list edits close an hour before.
  ([queue](https://support.espn.com/hc/en-us/articles/4669749280404-Online-Draft-Player-Queue),
  [autopick](https://support.espn.com/hc/en-us/articles/360000042712-Autopick-Draft))
- The app has a Draft Board showing every pick for every team with position
  colours, and a "Draft Train" row of completed picks along the top.
  ([draft board](https://support.espn.com/hc/en-us/articles/28953716779540-NEW-Draft-Board-and-Train-for-ESPN-Fantasy-Football))
- Timer default: sources disagree. League manager tools say 30 seconds, an
  older basketball blog says 90. Check in a real league before relying on it.
  ([LM tools](https://support.espn.com/hc/en-us/articles/360000140711-League-Manager-In-Draft-Abilities-Website))
- Keepers fill the first rounds and keeper rounds do not snake, or the
  commissioner sets a round and pick per keeper from dropdowns. Non-commissioners
  cannot see kept players' pick numbers until the draft starts.
  ([keeper leagues](https://support.espn.com/hc/en-us/articles/360000070552-Keeper-Leagues),
  [custom keeper rounds](https://support.espn.com/hc/en-us/articles/15713607159060-Custom-Keeper-Draft-Rounds-LM-Leagues))
- Pick trades move "a team manager's pick in a given round, not the pick
  itself," so a later draft order change moves the traded pick with it.
  ([trade picks](https://support.espn.com/hc/en-us/articles/360046052292-Trade-Draft-Picks))
- ESPN grades the draft and writes a recap automatically afterwards.

## What they all do the same

Match these unless there is a reason not to.

1. **A queue.** Every room has one. Autopick takes from it first, then the
   platform's own rankings filtered by roster need. A drafted player leaves
   the queue on his own.
2. **Keepers are pick slots.** A keeper consumes a specific pick before the
   draft, and that cell is shown filled on the board. Nobody models keepers as
   a separate roster list.
3. **Board and player list are separate views on a phone.** Yahoo gave the
   board its own tab; ESPN's board is app-only; Sleeper's tabs are players,
   queue, roster, chat.
4. **The clock lives in one corner, and "your turn" gets a banner too.**
5. **Mock setup asks three things:** team count, your slot, time per pick, and
   you take your slot by tapping it. ESPN is the exception; you join a room.
6. **Everyone grades the draft afterwards.** Only Yahoo and FantasyPros grade
   as you go.
7. **Sort by ADP or by projected points, switchable.** Yahoo and ESPN both
   offer it in the room.

## Where they differ, and what we take

- **Odds of availability.** Only FantasyPros shows "62% he is there at your
  next pick," one to three rounds out, colour-coded. That is the feature the
  handoff asks for and the one to copy. Yahoo and ESPN recommend a name; they
  do not give odds.
- **Naming the ranking source.** FantasyPros says "60+ experts" and names its
  two ADP hosts. Yahoo lets you pick an analyst. ESPN and Sleeper show a rank
  with no source on screen. We label the source on every list, always, which
  is stricter than any of them; it costs nothing and it is the whole point of
  the fallback chain.
- **Tier breaks.** Only FantasyPros draws them for certain. Sleeper's are
  claimed by a review. Worth doing; nobody in the ESPN app has them.
- **Soft versus hard clock.** Sleeper lets time run out with nothing
  happening. This league's clock is manual by rule ("CLOCK", then 30 seconds),
  so a mock must not auto-skip on time either.
- **Traded picks.** Sleeper handles them natively. Yahoo needs an import step.
  ESPN trades the round, not the pick, and breaks if the order changes. We
  already resolve real pick ownership in `buildAllPicks`; a generic simulator
  cannot.

## What does not apply to this league

- **Lobby and slot picking.** There are ten named teams and a fixed order in
  `league-2027-config.json`. You are Brey at 9. Nobody picks a slot.
- **Random bots with generic rosters.** Nine opponents have real keepers,
  real traded picks and real needs. The opponent model must start from that.
- **ESPN's keeper round rules.** Keeper cost comes from tiers, same-tier bumps
  and traded-away rounds in `src/lib/keeper/engine.ts`, charged to the latest
  pick owned at or better than the tier. No generic tool's keeper model fits.
- **Draft grades on consensus projections.** There are no consensus rankings
  for a custom points league, and no other tool knows the 2026-27 weekly
  schedule grid. Value has to be figured here, from ESPN's numbers and
  `computeFpts`.
- **A second identity for secret keepers.** Pre-reveal, an assumed keeper must
  never be shown as real. None of the four tools has this problem; we do.

## What this means for the build order

Phase 1 (this pass) froze the numbers everything else reads: ADP, rank,
auction value, percent owned, and the projection row when ESPN publishes it,
in `src/lib/league/draftRankings.ts`. The ordering there already labels its
source per player, which is convention 7 plus the source labelling above.

Later phases, in the order the handoff gives them: the value model, the
seeded simulation with the availability distribution (the FantasyPros idea),
then what-if worlds and the round-one screen. The screen should look like an
ESPN board with the phone tabs of Sleeper: board, players, queue, and a
"my picks" strip that says "your pick in N".

import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import { buildAllPicks, buildDraftBoard, pickLabel, resolveTeamKeepers } from '../src/lib/keeper/engine.ts';
import type {
  LeagueDataset,
  LeagueDynamicState,
  PickTransfer,
} from '../src/lib/keeper/types.ts';
import {
  assetOrigin,
  canAnswer,
  checkProposalAgainstState,
  checkProposalShape,
  datasetWithTransfers,
  describeTrade,
  draftCalendarYear,
  draftYearLabel,
  expireStale,
  expiresAtFrom,
  futurePickLabel,
  inboxCount,
  ordinal,
  pickRefKey,
  pickSeason,
  pickTitle,
  previewProposal,
  proposalsOf,
  provenanceFor,
  sameRef,
  seasonPicks,
  tradablePicksFor,
  tradableSeasonPicksFor,
  tradeableSeason,
  tradeSidesFor,
  transfersForProposal,
  transfersOf,
  visibleProposals,
  type PickTradeProposal,
  type ProposalInput,
} from '../src/lib/league/pickTrades.ts';

const dataset = rawDataset as unknown as LeagueDataset;

/** The draft that is on now, and the one after it. */
const SEASON = dataset.season;
const NEXT = SEASON + 1;

const ref = (round: number, originalOwner: string, season = SEASON) => ({
  season,
  round,
  originalOwner,
});

function state(patch: Partial<LeagueDynamicState> = {}): LeagueDynamicState {
  return {
    season: dataset.season,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null, closedAt: null },
    locks: { keepersLocked: false },
    pickTransfers: [],
    pickTradeProposals: [],
    ...patch,
  };
}

/** The draft running with rounds 1 and 2 already in the books. */
function midDraftPicks(): Record<string, { playerKey: string; playerName: string }> {
  const picks: Record<string, { playerKey: string; playerName: string }> = {};
  for (let overall = 1; overall <= 20; overall++) {
    picks[String(overall)] = { playerKey: `taken-${overall}`, playerName: `Taken ${overall}` };
  }
  return picks;
}

function transfer(
  round: number,
  originalOwner: string,
  from: string,
  to: string,
  at = '2026-09-01T12:00:00.000Z',
  proposalId = 'trade-1',
  season = SEASON,
): PickTransfer {
  return { season, round, originalOwner, from, to, at, proposalId };
}

function proposal(patch: Partial<PickTradeProposal> = {}): PickTradeProposal {
  const createdAt = '2026-09-01T12:00:00.000Z';
  return {
    id: 'trade-a',
    season: dataset.season,
    proposer: 'Amy',
    recipient: 'Kyle',
    offer: [ref(7, 'Amy')],
    request: [ref(7, 'Kyle')],
    note: '',
    status: 'pending',
    version: 1,
    createdAt,
    expiresAt: expiresAtFrom(createdAt),
    ...patch,
  };
}

const ownerOf = (data: LeagueDataset, round: number, originalOwner: string) =>
  buildAllPicks(data).find((p) => p.round === round && p.originalOwner === originalOwner)
    ?.currentOwner;

const input = (patch: Partial<ProposalInput> = {}): ProposalInput => ({
  proposer: 'Amy',
  recipient: 'Kyle',
  offer: [ref(7, 'Amy')],
  request: [ref(7, 'Kyle')],
  note: '',
  ...patch,
});

/* ─── Ownership and provenance ─────────────────────────────────────────── */

test('the committed seed still decides who owns a pick before anything moves', () => {
  // Derek gave Ryan his 3rd in the preseason trade.
  assert.equal(ownerOf(dataset, 3, 'Derek'), 'Ryan');
  assert.equal(ownerOf(dataset, 3, 'Amy'), 'Amy');
});

test('an accepted transfer moves a pick without touching the committed seed', () => {
  const before = dataset.pickTrades.length;
  const after = datasetWithTransfers(dataset, [transfer(7, 'Amy', 'Amy', 'Kyle')]);

  assert.equal(ownerOf(after, 7, 'Amy'), 'Kyle');
  assert.equal(ownerOf(dataset, 7, 'Amy'), 'Amy', 'the source dataset is untouched');
  assert.equal(dataset.pickTrades.length, before, 'the seed array is not mutated');
});

test('a pick traded twice keeps its whole chain of custody', () => {
  // Derek's 3rd went to Ryan in the seed. Ryan sends it on to Amy, Amy to Kyle.
  const moved = datasetWithTransfers(dataset, [
    transfer(3, 'Derek', 'Ryan', 'Amy', '2026-09-01T00:00:00.000Z', 'trade-1'),
    transfer(3, 'Derek', 'Amy', 'Kyle', '2026-09-02T00:00:00.000Z', 'trade-2'),
  ]);

  assert.equal(ownerOf(moved, 3, 'Derek'), 'Kyle');
  const chain = provenanceFor(moved, ref(3, 'Derek'));
  assert.equal(chain.currentOwner, 'Kyle');
  assert.deepEqual(
    chain.steps.map((step) => `${step.from}>${step.to}`),
    ['Derek>Ryan', 'Ryan>Amy', 'Amy>Kyle'],
  );
  assert.equal(chain.ref.originalOwner, 'Derek', 'the original owner never changes');
});

test('the pick a team traded away is the one that moves, not one it acquired', () => {
  // Ryan holds his own 3rd and Derek's 3rd. Sending Derek's on must leave
  // Ryan's alone.
  const moved = datasetWithTransfers(dataset, [transfer(3, 'Derek', 'Ryan', 'Amy')]);
  assert.equal(ownerOf(moved, 3, 'Derek'), 'Amy');
  assert.equal(ownerOf(moved, 3, 'Ryan'), 'Ryan');
});

/* ─── What may be traded ───────────────────────────────────────────────── */

test('before the draft every pick a team holds in a tradeable round can move', () => {
  const picks = tradablePicksFor(dataset, state(), 'Amy');
  assert.equal(picks.length, dataset.draftRounds, 'every pick is still listed');
  for (const entry of picks) {
    const allowed = entry.ref.round >= 3 && entry.ref.round <= dataset.keeperRounds;
    assert.equal(entry.tradable, allowed, `round ${entry.ref.round}`);
    if (!allowed) assert.equal(entry.blockedBy, 'round-protected');
  }
});

test('the 1st and 2nd rounds never move, whoever asks', () => {
  for (const round of [1, 2]) {
    const check = checkProposalShape(dataset, input({ offer: [ref(round, 'Amy')] }));
    assert.equal(check.reason, 'round-protected');
  }
  // Rounds past the keeper tiers were never tradeable either.
  assert.equal(
    checkProposalShape(dataset, input({ offer: [ref(14, 'Amy')] })).reason,
    'round-protected',
  );
});

test('during the draft a used pick cannot move but the pick on the clock can', () => {
  // Rounds 1 and 2 are already in the books, so the clock is in a round that
  // can still be traded.
  const live = state({
    keepersRevealed: true,
    draft: { picks: midDraftPicks(), startedAt: '2026-10-18T21:00:00.000Z' },
  });
  const board = buildDraftBoard(dataset, live);
  const onClock = board.find((cell) => cell.onClock);
  assert.ok(onClock, 'a pick should be on the clock');
  assert.equal(onClock.pick.round, 3);

  const owner = onClock.pick.currentOwner;
  const entry = tradablePicksFor(dataset, live, owner).find(
    (candidate) => candidate.pick.overall === onClock.pick.overall,
  );
  assert.ok(entry?.tradable, 'an empty on-clock pick may still be traded');
  assert.equal(entry?.onClock, true);

  const used = state({
    keepersRevealed: true,
    draft: {
      picks: {
        ...midDraftPicks(),
        [String(onClock.pick.overall)]: { playerKey: 'x', playerName: 'X' },
      },
      startedAt: '2026-10-18T21:00:00.000Z',
    },
  });
  const blocked = tradablePicksFor(dataset, used, owner).find(
    (candidate) => candidate.pick.overall === onClock.pick.overall,
  );
  assert.equal(blocked?.tradable, false);
  assert.equal(blocked?.blockedBy, 'drafted');
});

/* ─── Validation ───────────────────────────────────────────────────────── */

test('a proposal needs two teams, two even non-empty sides, and no repeats', () => {
  assert.equal(checkProposalShape(dataset, input({ recipient: 'Amy' })).reason, 'same-owner');
  assert.equal(checkProposalShape(dataset, input({ offer: [] })).reason, 'empty-side');
  assert.equal(checkProposalShape(dataset, input({ recipient: 'Nobody' })).reason, 'unknown-owner');
  assert.equal(
    checkProposalShape(dataset, input({ offer: [ref(7, 'Amy'), ref(8, 'Amy')] })).reason,
    'unequal-sides',
    'the rule book wants the same number of picks each way',
  );
  assert.equal(
    checkProposalShape(
      dataset,
      input({ offer: [ref(7, 'Amy'), ref(7, 'Amy')], request: [ref(7, 'Kyle'), ref(6, 'Kyle')] }),
    ).reason,
    'duplicate-pick',
  );
  assert.equal(
    checkProposalShape(dataset, input({ offer: [ref(99, 'Amy')] })).reason,
    'unknown-pick',
  );
  assert.equal(checkProposalShape(dataset, input()).ok, true);
});

test('offering a pick you no longer own is refused, and refused for good', () => {
  const moved = state({ pickTransfers: [transfer(7, 'Amy', 'Amy', 'Joel')] });
  const data = datasetWithTransfers(dataset, moved.pickTransfers ?? []);
  const check = checkProposalAgainstState(data, moved, input());

  assert.equal(check.ok, false);
  assert.equal(check.reason, 'not-yours');
  assert.equal(check.fatal, true, 'this can never come back, so the offer is dead');
  assert.match(check.message ?? '', /Joel owns it/);
});

test('asking for a pick the other team no longer owns is refused', () => {
  const moved = state({ pickTransfers: [transfer(7, 'Kyle', 'Kyle', 'Joel')] });
  const data = datasetWithTransfers(dataset, moved.pickTransfers ?? []);
  assert.equal(checkProposalAgainstState(data, moved, input()).reason, 'not-theirs');
});

test('a pick already used in the draft cannot be traded', () => {
  const live = state({
    keepersRevealed: true,
    draft: { picks: midDraftPicks(), startedAt: '2026-10-18T21:00:00.000Z' },
  });
  const onClock = buildDraftBoard(dataset, live).find((cell) => cell.onClock);
  assert.ok(onClock);
  const owner = onClock.pick.currentOwner;
  const other = dataset.teams.map((t) => t.owner).find((o) => o !== owner && o !== 'Joel');
  assert.ok(other);

  const used = state({
    keepersRevealed: true,
    draft: {
      picks: {
        ...midDraftPicks(),
        [String(onClock.pick.overall)]: { playerKey: 'x', playerName: 'X' },
      },
      startedAt: '2026-10-18T21:00:00.000Z',
    },
  });
  const check = checkProposalAgainstState(
    dataset,
    used,
    input({
      proposer: owner,
      recipient: other,
      offer: [ref(onClock.pick.round, onClock.pick.originalOwner)],
      request: [ref(4, other)],
    }),
  );
  assert.equal(check.reason, 'pick-used');
  assert.equal(check.fatal, true);
});

/* ─── Keeper costs ─────────────────────────────────────────────────────── */

test('the preview shows a keeper paying a different pick after a trade', () => {
  // Give Amy a keeper, then trade away the pick that keeper would use.
  const player = dataset.players.find(
    (candidate) =>
      candidate.fantasyTeam === 'Amy'
      && candidate.keeper.eligible
      && candidate.keeper.round !== null
      && candidate.keeper.round >= 3
      && candidate.keeper.round <= 6
      && candidate.keeper.contract === null,
  );
  assert.ok(player, 'fixture needs a keepable Amy player in rounds 3-6');
  const round = player.keeper.round as number;

  const selections = [{ playerKey: player.key, playerName: player.name }];
  const before = resolveTeamKeepers(dataset, 'Amy', selections);
  assert.equal(before.keepers[0].pick?.round, round);

  // Amy sends the pick the keeper would use and gets back a worse one, so the
  // keeper has to bump to a better pick she already owns.
  const live = state({ keepers: { Amy: selections }, keepersRevealed: true });
  const preview = previewProposal(
    dataset,
    live,
    input({
      recipient: 'Bryan',
      offer: [ref(round, 'Amy')],
      request: [ref(round + 1, 'Bryan')],
    }),
    { owner: 'Amy', isCommissioner: false, revealed: true },
  );

  assert.equal(preview.check.ok, true);
  const amy = preview.sides.find((side) => side.owner === 'Amy');
  assert.ok(amy);
  assert.equal(amy.changes.length, 1, 'one keeper changes what it costs');
  assert.equal(amy.changes[0].beforePick, pickLabel(before.keepers[0].pick!));
  assert.notEqual(amy.changes[0].afterPick, amy.changes[0].beforePick);
  assert.equal(amy.changes[0].afterBump, 'traded');
});

test('keeper names stay hidden from the other side before the reveal', () => {
  const player = dataset.players.find(
    (candidate) => candidate.fantasyTeam === 'Kyle' && candidate.keeper.eligible,
  );
  assert.ok(player);
  const live = state({
    keepers: { Kyle: [{ playerKey: player.key, playerName: player.name }] },
    keepersRevealed: false,
  });

  const preview = previewProposal(dataset, live, input(), {
    owner: 'Amy',
    isCommissioner: false,
    revealed: false,
  });
  const kyle = preview.sides.find((side) => side.owner === 'Kyle');
  assert.ok(kyle);
  assert.equal(kyle.detailed, false);
  assert.equal(kyle.changes.length, 0, 'no player names leak');
  assert.ok(kyle.summary.length > 0, 'the other side still gets a plain answer');
});

test('a round-1 keeper cannot be stranded, because the 1st never moves', () => {
  // The only pick that pays for a round-1 keeper is the round-1 pick, and the
  // rule book keeps that off the table. Trying it is refused on the round, not
  // on the keeper.
  const player = dataset.players.find(
    (candidate) =>
      candidate.fantasyTeam === 'Amy' && candidate.keeper.eligible && candidate.keeper.round === 1,
  );
  assert.ok(player, 'fixture needs a round-1 keeper on Amy');
  const selections = [{ playerKey: player.key, playerName: player.name }];
  assert.equal(resolveTeamKeepers(dataset, 'Amy', selections).valid, true);

  const locked = state({
    keepers: { Amy: selections },
    keepersRevealed: true,
    locks: { keepersLocked: true },
  });
  const check = checkProposalAgainstState(
    dataset,
    locked,
    input({ offer: [ref(1, 'Amy')], request: [ref(7, 'Kyle')] }),
  );
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'round-protected');

  // A trade of picks she may trade leaves the keeper intact and goes through.
  assert.equal(checkProposalAgainstState(dataset, locked, input()).ok, true);
});

/* ─── Lifecycle and privacy ────────────────────────────────────────────── */

test('only the recipient may accept, and only the proposer or a commissioner may pull', () => {
  const offer = proposal();
  assert.equal(canAnswer(offer, 'Kyle', 'accept', false).ok, true);
  assert.equal(canAnswer(offer, 'Amy', 'accept', false).ok, false);
  assert.equal(
    canAnswer(offer, 'Brey', 'accept', true).ok,
    false,
    'a commissioner never accepts for a member',
  );
  assert.equal(canAnswer(offer, 'Kyle', 'reject', false).ok, true);
  assert.equal(canAnswer(offer, 'Amy', 'cancel', false).ok, true);
  assert.equal(canAnswer(offer, 'Brey', 'cancel', true).ok, true);
  assert.equal(canAnswer(offer, 'Joel', 'cancel', false).ok, false);
});

test('a settled offer takes no further answer', () => {
  for (const status of ['accepted', 'rejected', 'cancelled', 'expired', 'invalidated'] as const) {
    const settled = proposal({ status });
    assert.equal(canAnswer(settled, 'Kyle', 'accept', false).reason, 'not-pending');
    assert.equal(canAnswer(settled, 'Amy', 'cancel', false).reason, 'not-pending');
  }
});

test('a pending offer is visible only to the two members, accepted ones to everyone', () => {
  const pending = proposal();
  const done = proposal({ id: 'trade-b', status: 'accepted' });
  const all = [pending, done];

  assert.deepEqual(
    visibleProposals(all, 'Joel', false).map((p) => p.id),
    ['trade-b'],
    'an outsider sees only the settled trade',
  );
  assert.deepEqual(visibleProposals(all, 'Kyle', false).map((p) => p.id), ['trade-a', 'trade-b']);
  assert.deepEqual(visibleProposals(all, 'Amy', false).map((p) => p.id), ['trade-a', 'trade-b']);
  assert.deepEqual(visibleProposals(all, null, false).map((p) => p.id), ['trade-b']);

  const commish = visibleProposals(all, 'Brey', true);
  const seen = commish.find((p) => p.id === 'trade-a');
  assert.ok(seen, 'a commissioner sees that a pending offer exists');
  assert.deepEqual(seen.offer, [], 'but not which picks are in it');
  assert.deepEqual(seen.request, []);
  assert.equal(seen.note, '');
});

test('the inbox count only counts offers waiting on you', () => {
  const all = [proposal(), proposal({ id: 'trade-b', status: 'accepted' })];
  assert.equal(inboxCount(all, 'Kyle'), 1);
  assert.equal(inboxCount(all, 'Amy'), 0);
  assert.equal(inboxCount(all, null), 0);
});

test('a pending offer runs out on its own and keeps its history', () => {
  const old = proposal({ createdAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-08T00:00:00.000Z' });
  const { proposals, changed } = expireStale([old], '2026-09-01T00:00:00.000Z');
  assert.equal(changed, true);
  assert.equal(proposals[0].status, 'expired');
  assert.equal(proposals[0].version, old.version + 1, 'a stale tab cannot accept it now');
  assert.equal(proposals.length, 1, 'nothing is deleted');

  const fresh = expireStale([old], '2026-08-02T00:00:00.000Z');
  assert.equal(fresh.changed, false);
  assert.equal(fresh.proposals[0].status, 'pending');
});

test('an accepted offer writes one ledger row per pick, both ways', () => {
  const rows = transfersForProposal(
    input({
      offer: [ref(7, 'Amy'), ref(5, 'Amy')],
      request: [ref(4, 'Kyle')],
    }),
    '2026-09-01T00:00:00.000Z',
    'trade-x',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.to === 'Kyle').length, 2);
  assert.equal(rows.filter((row) => row.to === 'Amy').length, 1);
  assert.ok(rows.every((row) => row.proposalId === 'trade-x'));
});

test('a trade reads back as picks, never as free text', () => {
  assert.equal(describeTrade(proposal()), 'R7 for R7');
  assert.equal(
    describeTrade(proposal({ offer: [ref(3, 'Derek')] })),
    'R3 for R7',
  );
  assert.equal(describeTrade(proposal({ offer: [], request: [] })), 'Picks hidden');
});

test('a round on its own is ambiguous, so each row names the pick in full', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(14), '14th');
  assert.equal(pickTitle(ref(1, 'Kyle')), '1st Round Pick');
  assert.equal(pickTitle(ref(3, 'Amy')), '3rd Round Pick');

  assert.equal(
    assetOrigin({ ref: ref(1, 'Kyle'), from: 'Kyle', to: 'Amy' }),
    "Kyle's own pick",
  );
  assert.equal(
    assetOrigin({ ref: ref(1, 'Derek'), from: 'Kyle', to: 'Amy' }),
    "Originally Derek's",
  );
});

test('each side of a trade reads from the seat of whoever is looking', () => {
  const offered = proposal({
    offer: [ref(1, 'Amy'), ref(6, 'Derek')],
    request: [ref(1, 'Kyle')],
  });

  const forProposer = tradeSidesFor(offered, 'Amy');
  assert.deepEqual(forProposer.receives, [
    { ref: ref(1, 'Kyle'), from: 'Kyle', to: 'Amy' },
  ]);
  assert.equal(forProposer.sends.length, 2);
  assert.ok(forProposer.sends.every((asset) => asset.from === 'Amy' && asset.to === 'Kyle'));

  // The same trade from the other seat is the mirror image.
  const forRecipient = tradeSidesFor(offered, 'Kyle');
  assert.deepEqual(forRecipient.receives, forProposer.sends);
  assert.deepEqual(forRecipient.sends, forProposer.receives);

  // Two first round picks in one trade are different assets. Each keeps its own
  // original owner, which is the whole reason a row names it.
  assert.equal(forProposer.receives[0]?.ref.originalOwner, 'Kyle');
  assert.equal(forProposer.sends[0]?.ref.originalOwner, 'Amy');

  // A member outside the trade reads it from the proposer's seat.
  assert.deepEqual(tradeSidesFor(offered, 'Ryan'), forProposer);
});

test('a stripped offer leaves both columns with nothing to show', () => {
  const sides = tradeSidesFor(proposal({ offer: [], request: [] }), 'Amy');
  assert.deepEqual(sides, { receives: [], sends: [] });
});

/* ─── Which draft a pick belongs to ────────────────────────────────────── */

test('a pick saved before seasons existed is a pick in the current draft', () => {
  assert.equal(pickSeason({ round: 7, originalOwner: 'Amy' }, SEASON), SEASON);

  // Exactly what the store holds today: no season on the row.
  const stored = state({
    pickTransfers: [
      {
        round: 7,
        originalOwner: 'Amy',
        from: 'Amy',
        to: 'Kyle',
        at: '2026-09-01T00:00:00.000Z',
        proposalId: 'old',
      },
    ],
  });
  const read = transfersOf(stored, SEASON);
  assert.equal(read[0].season, SEASON, 'it reads as this draft, not as nothing');
  assert.equal(ownerOf(datasetWithTransfers(dataset, read), 7, 'Amy'), 'Kyle');
  assert.equal(
    stored.pickTransfers?.[0].season,
    undefined,
    'and the stored row itself is left alone',
  );
});

test('an offer saved before seasons existed still names this draft on every pick', () => {
  const stored = state({
    pickTradeProposals: [
      {
        ...proposal(),
        offer: [{ round: 7, originalOwner: 'Amy' }],
        request: [{ round: 7, originalOwner: 'Kyle' }],
      },
    ],
  });
  const [read] = proposalsOf(stored, SEASON);
  assert.equal(read.offer[0].season, SEASON);
  assert.equal(read.request[0].season, SEASON);

  const check = checkProposalAgainstState(dataset, state(), {
    proposer: 'Amy',
    recipient: 'Kyle',
    offer: read.offer,
    request: read.request,
    note: '',
  });
  assert.equal(check.ok, true, 'so an old offer still means what it meant');
});

test('closing the draft opens next season, and reopening it puts things back', () => {
  const open = state();
  assert.equal(tradeableSeason(open, dataset), SEASON);

  const closed = state({
    draft: {
      picks: {},
      startedAt: '2026-10-18T21:00:00.000Z',
      closedAt: '2026-10-18T23:30:00.000Z',
    },
  });
  assert.equal(tradeableSeason(closed, dataset), NEXT);

  const reopened = state({
    draft: { picks: {}, startedAt: '2026-10-18T21:00:00.000Z', closedAt: null },
  });
  assert.equal(tradeableSeason(reopened, dataset), SEASON, 'a mistake costs nobody a window');
});

test('a pick in this draft and the same pick next year are two different assets', () => {
  const thisYear = ref(7, 'Amy');
  const nextYear = ref(7, 'Amy', NEXT);
  assert.notEqual(pickRefKey(thisYear), pickRefKey(nextYear));
  assert.equal(sameRef(thisYear, nextYear), false);

  // Moving next year's leaves this year's exactly where it was.
  const moved = datasetWithTransfers(dataset, [
    transfer(7, 'Amy', 'Amy', 'Kyle', '2026-10-19T00:00:00.000Z', 'trade-next', NEXT),
  ]);
  assert.equal(ownerOf(moved, 7, 'Amy'), 'Amy', 'this draft is untouched');
  assert.equal(
    seasonPicks(moved, NEXT).find((p) => p.ref.round === 7 && p.ref.originalOwner === 'Amy')
      ?.currentOwner,
    'Kyle',
  );
});

test('next season every team owns its own rounds again, with no slot', () => {
  const picks = seasonPicks(dataset, NEXT);
  assert.equal(picks.length, dataset.teams.length * dataset.draftRounds);
  assert.ok(picks.every((pick) => pick.slot === null), 'that draft has no order yet');
  assert.ok(
    picks.every((pick) => pick.currentOwner === pick.ref.originalOwner),
    'the seed trades were for this draft, not the next one',
  );

  const amy = tradableSeasonPicksFor(dataset, state(), 'Amy', NEXT);
  assert.equal(amy.length, dataset.draftRounds);
  assert.equal(amy.filter((pick) => pick.tradable).length, 8, 'rounds 3 to 10');
  assert.equal(amy.find((pick) => pick.ref.round === 5)?.label, `Round 5, Oct ${NEXT - 1} draft`);
});

test('a draft is named by the year it happens, not by the season it belongs to', () => {
  assert.equal(draftCalendarYear(2027), 2026);
  assert.equal(draftCalendarYear(2028), 2027);
  assert.equal(draftYearLabel(2027), 'Oct 2026 draft');
  assert.equal(draftYearLabel(2028), 'Oct 2027 draft');
  assert.equal(futurePickLabel(ref(5, 'Amy', 2028)), 'Round 5, Oct 2027 draft');
});

test('only the open draft can be traded, and the wrong one is refused', () => {
  const open = state();
  assert.equal(checkProposalAgainstState(dataset, open, input()).ok, true);

  const early = checkProposalAgainstState(
    dataset,
    open,
    input({ offer: [ref(7, 'Amy', NEXT)], request: [ref(7, 'Kyle', NEXT)] }),
  );
  assert.equal(early.reason, 'wrong-season');
  assert.match(early.message ?? '', /Oct 2026 draft/);

  const closed = state({
    draft: {
      picks: {},
      startedAt: '2026-10-18T21:00:00.000Z',
      closedAt: '2026-10-19T00:00:00.000Z',
    },
  });
  assert.equal(
    checkProposalAgainstState(
      dataset,
      closed,
      input({ offer: [ref(7, 'Amy', NEXT)], request: [ref(7, 'Kyle', NEXT)] }),
    ).ok,
    true,
  );
  assert.equal(checkProposalAgainstState(dataset, closed, input()).reason, 'wrong-season');
});

test('one trade cannot mix two drafts', () => {
  assert.equal(
    checkProposalShape(dataset, input({ request: [ref(7, 'Kyle', NEXT)] })).reason,
    'mixed-seasons',
  );
});

/* ─── The rule-book limits, counted inside one draft ───────────────────── */

test('a team may trade away two of its own picks in a draft, not three', () => {
  const twoGone = state({
    pickTransfers: [
      transfer(5, 'Amy', 'Amy', 'Joel', '2026-09-01T00:00:00.000Z', 'trade-1'),
      transfer(6, 'Amy', 'Amy', 'Joel', '2026-09-02T00:00:00.000Z', 'trade-2'),
    ],
  });
  const data = datasetWithTransfers(dataset, twoGone.pickTransfers ?? []);
  const third = checkProposalAgainstState(data, twoGone, input());
  assert.equal(third.reason, 'too-many-away');
  assert.match(third.message ?? '', /Oct 2026 draft/);

  // What Amy did with this draft does not limit the next one.
  const closed = state({
    pickTransfers: twoGone.pickTransfers,
    draft: {
      picks: {},
      startedAt: '2026-10-18T21:00:00.000Z',
      closedAt: '2026-10-19T00:00:00.000Z',
    },
  });
  assert.equal(
    checkProposalAgainstState(
      data,
      closed,
      input({ offer: [ref(7, 'Amy', NEXT)], request: [ref(7, 'Kyle', NEXT)] }),
    ).ok,
    true,
  );
});

test('a team may hold two picks in a round, not three', () => {
  // Ryan already holds his own 3rd and Derek's. A third round-3 pick is out.
  const check = checkProposalAgainstState(
    dataset,
    state(),
    input({
      proposer: 'Ryan',
      recipient: 'Amy',
      offer: [ref(8, 'Ryan')],
      request: [ref(3, 'Amy')],
    }),
  );
  assert.equal(check.reason, 'too-many-in-round');
  assert.match(check.message ?? '', /round-3/);

  // Next season Ryan holds only his own 3rd, so the same shape is fine there.
  const closed = state({
    draft: {
      picks: {},
      startedAt: '2026-10-18T21:00:00.000Z',
      closedAt: '2026-10-19T00:00:00.000Z',
    },
  });
  assert.equal(
    checkProposalAgainstState(
      dataset,
      closed,
      input({
        proposer: 'Ryan',
        recipient: 'Amy',
        offer: [ref(8, 'Ryan', NEXT)],
        request: [ref(3, 'Amy', NEXT)],
      }),
    ).ok,
    true,
  );
});

/* ─── Next season's trades never touch this season's keepers ───────────── */

test('trading next season picks leaves every keeper cost in this draft alone', () => {
  // One keeper per team, priced by the engine before anything moves.
  const selections: Record<string, Array<{ playerKey: string; playerName: string }>> = {};
  for (const team of dataset.teams) {
    const player = dataset.players.find(
      (candidate) => candidate.fantasyTeam === team.owner
        && candidate.keeper.eligible
        && candidate.keeper.round !== null,
    );
    if (player) selections[team.owner] = [{ playerKey: player.key, playerName: player.name }];
  }
  assert.ok(Object.keys(selections).length >= 8, 'fixture needs most teams keeping someone');

  const cost = (data: LeagueDataset, owner: string) =>
    resolveTeamKeepers(data, owner, selections[owner]).keepers.map(
      (k) => `${k.pick ? pickLabel(k.pick) : 'none'}/${k.bumpReason}`,
    );
  const before = Object.fromEntries(
    Object.keys(selections).map((owner) => [owner, cost(dataset, owner)]),
  );

  // Every team dumps a next-season pick on the team after it.
  const nextSeason = dataset.teams.map((team, i) => transfer(
    3 + (i % 8),
    team.owner,
    team.owner,
    dataset.teams[(i + 1) % dataset.teams.length].owner,
    '2026-10-19T00:00:00.000Z',
    `next-${i}`,
    NEXT,
  ));
  const after = datasetWithTransfers(dataset, nextSeason);

  for (const owner of Object.keys(selections)) {
    assert.deepEqual(cost(after, owner), before[owner], `${owner}'s keeper cost must not move`);
  }
  assert.deepEqual(buildAllPicks(after), buildAllPicks(dataset), 'the board is the board it was');
});

test('a next-season trade of the very pick a keeper needs changes nothing this year', () => {
  const player = dataset.players.find(
    (candidate) => candidate.fantasyTeam === 'Amy'
      && candidate.keeper.eligible
      && candidate.keeper.round !== null
      && candidate.keeper.round >= 3,
  );
  assert.ok(player);
  const round = player.keeper.round as number;
  const sels = [{ playerKey: player.key, playerName: player.name }];
  const before = resolveTeamKeepers(dataset, 'Amy', sels);

  const after = datasetWithTransfers(dataset, [
    transfer(round, 'Amy', 'Amy', 'Kyle', '2026-10-19T00:00:00.000Z', 'next-1', NEXT),
  ]);
  const now = resolveTeamKeepers(after, 'Amy', sels);

  assert.equal(now.keepers[0].pick?.overall, before.keepers[0].pick?.overall);
  assert.equal(now.keepers[0].bumpReason, before.keepers[0].bumpReason);
  assert.equal(now.keepers[0].bumped, false, 'no bump: this year she still owns it');
  assert.equal(now.capUsed, before.capUsed);
  assert.equal(now.pickStatusLine, before.pickStatusLine);

  // The same trade for THIS draft does move the cost, which is the control.
  const thisYear = datasetWithTransfers(dataset, [
    transfer(round, 'Amy', 'Amy', 'Kyle', '2026-09-01T00:00:00.000Z', 'now-1'),
  ]);
  const moved = resolveTeamKeepers(thisYear, 'Amy', sels);
  assert.notEqual(moved.keepers[0].pick?.overall, before.keepers[0].pick?.overall);
  assert.equal(moved.keepers[0].bumpReason, 'traded');
});

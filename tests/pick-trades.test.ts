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
  exactPickLabel,
  exactPickTitle,
  expireStale,
  expiresAtFrom,
  inboxCount,
  ordinal,
  pickSlotFor,
  pickTitle,
  previewProposal,
  refOf,
  provenanceFor,
  tradablePicksFor,
  tradeSidesFor,
  transfersForProposal,
  visibleProposals,
  type PickTradeProposal,
  type ProposalInput,
} from '../src/lib/league/pickTrades.ts';

const dataset = rawDataset as unknown as LeagueDataset;

function state(patch: Partial<LeagueDynamicState> = {}): LeagueDynamicState {
  return {
    season: dataset.season,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
    pickTransfers: [],
    pickTradeProposals: [],
    ...patch,
  };
}

function transfer(
  round: number,
  originalOwner: string,
  from: string,
  to: string,
  at = '2026-09-01T12:00:00.000Z',
  proposalId = 'trade-1',
): PickTransfer {
  return { round, originalOwner, from, to, at, proposalId };
}

function proposal(patch: Partial<PickTradeProposal> = {}): PickTradeProposal {
  const createdAt = '2026-09-01T12:00:00.000Z';
  return {
    id: 'trade-a',
    season: dataset.season,
    proposer: 'Amy',
    recipient: 'Kyle',
    offer: [{ round: 2, originalOwner: 'Amy' }],
    request: [{ round: 2, originalOwner: 'Kyle' }],
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
  offer: [{ round: 2, originalOwner: 'Amy' }],
  request: [{ round: 2, originalOwner: 'Kyle' }],
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
  const after = datasetWithTransfers(dataset, [transfer(2, 'Amy', 'Amy', 'Kyle')]);

  assert.equal(ownerOf(after, 2, 'Amy'), 'Kyle');
  assert.equal(ownerOf(dataset, 2, 'Amy'), 'Amy', 'the source dataset is untouched');
  assert.equal(dataset.pickTrades.length, before, 'the seed array is not mutated');
});

test('a pick traded twice keeps its whole chain of custody', () => {
  // Derek's 3rd went to Ryan in the seed. Ryan sends it on to Amy, Amy to Kyle.
  const moved = datasetWithTransfers(dataset, [
    transfer(3, 'Derek', 'Ryan', 'Amy', '2026-09-01T00:00:00.000Z', 'trade-1'),
    transfer(3, 'Derek', 'Amy', 'Kyle', '2026-09-02T00:00:00.000Z', 'trade-2'),
  ]);

  assert.equal(ownerOf(moved, 3, 'Derek'), 'Kyle');
  const chain = provenanceFor(moved, { round: 3, originalOwner: 'Derek' });
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

test('before the draft every pick a team holds can move', () => {
  const picks = tradablePicksFor(dataset, state(), 'Amy');
  assert.equal(picks.length, dataset.draftRounds);
  assert.ok(picks.every((entry) => entry.tradable));
});

test('during the draft a used pick cannot move but the pick on the clock can', () => {
  const live = state({
    keepersRevealed: true,
    draft: { picks: {}, startedAt: '2026-10-18T21:00:00.000Z' },
  });
  const board = buildDraftBoard(dataset, live);
  const onClock = board.find((cell) => cell.onClock);
  assert.ok(onClock, 'a pick should be on the clock');

  const owner = onClock.pick.currentOwner;
  const entry = tradablePicksFor(dataset, live, owner).find(
    (candidate) => candidate.pick.overall === onClock.pick.overall,
  );
  assert.ok(entry?.tradable, 'an empty on-clock pick may still be traded');
  assert.equal(entry?.onClock, true);

  const used = state({
    keepersRevealed: true,
    draft: {
      picks: { [String(onClock.pick.overall)]: { playerKey: 'x', playerName: 'X' } },
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

test('a proposal needs two teams, two non-empty sides, and no repeats', () => {
  assert.equal(checkProposalShape(dataset, input({ recipient: 'Amy' })).reason, 'same-owner');
  assert.equal(checkProposalShape(dataset, input({ offer: [] })).reason, 'empty-side');
  assert.equal(checkProposalShape(dataset, input({ recipient: 'Nobody' })).reason, 'unknown-owner');
  assert.equal(
    checkProposalShape(
      dataset,
      input({ offer: [{ round: 2, originalOwner: 'Amy' }, { round: 2, originalOwner: 'Amy' }] }),
    ).reason,
    'duplicate-pick',
  );
  assert.equal(
    checkProposalShape(dataset, input({ offer: [{ round: 99, originalOwner: 'Amy' }] })).reason,
    'unknown-pick',
  );
  assert.equal(checkProposalShape(dataset, input()).ok, true);
});

test('offering a pick you no longer own is refused, and refused for good', () => {
  const moved = state({ pickTransfers: [transfer(2, 'Amy', 'Amy', 'Joel')] });
  const data = datasetWithTransfers(dataset, moved.pickTransfers ?? []);
  const check = checkProposalAgainstState(data, moved, input());

  assert.equal(check.ok, false);
  assert.equal(check.reason, 'not-yours');
  assert.equal(check.fatal, true, 'this can never come back, so the offer is dead');
  assert.match(check.message ?? '', /Joel owns it/);
});

test('asking for a pick the other team no longer owns is refused', () => {
  const moved = state({ pickTransfers: [transfer(2, 'Kyle', 'Kyle', 'Joel')] });
  const data = datasetWithTransfers(dataset, moved.pickTransfers ?? []);
  assert.equal(checkProposalAgainstState(data, moved, input()).reason, 'not-theirs');
});

test('a pick already used in the draft cannot be traded', () => {
  const live = state({
    keepersRevealed: true,
    draft: { picks: {}, startedAt: '2026-10-18T21:00:00.000Z' },
  });
  const onClock = buildDraftBoard(dataset, live).find((cell) => cell.onClock);
  assert.ok(onClock);
  const owner = onClock.pick.currentOwner;
  const other = dataset.teams.map((t) => t.owner).find((o) => o !== owner);
  assert.ok(other);

  const used = state({
    keepersRevealed: true,
    draft: {
      picks: { [String(onClock.pick.overall)]: { playerKey: 'x', playerName: 'X' } },
      startedAt: '2026-10-18T21:00:00.000Z',
    },
  });
  const check = checkProposalAgainstState(
    dataset,
    used,
    input({
      proposer: owner,
      recipient: other,
      offer: [{ round: onClock.pick.round, originalOwner: onClock.pick.originalOwner }],
      request: [{ round: 14, originalOwner: other }],
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
      && candidate.keeper.contract === null,
  );
  assert.ok(player, 'fixture needs a keepable Amy player outside round 1-2');
  const round = player.keeper.round as number;

  const selections = [{ playerKey: player.key, playerName: player.name }];
  const before = resolveTeamKeepers(dataset, 'Amy', selections);
  assert.equal(before.keepers[0].pick?.round, round);

  const live = state({ keepers: { Amy: selections }, keepersRevealed: true });
  const preview = previewProposal(
    dataset,
    live,
    input({
      offer: [{ round, originalOwner: 'Amy' }],
      request: [{ round: 14, originalOwner: 'Kyle' }],
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

test('once keepers are locked a trade that breaks one is refused', () => {
  // A keeper in round 1 has nowhere better to go, so trading the 1st away
  // leaves the team unable to pay for it.
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
    input({
      offer: [{ round: 1, originalOwner: 'Amy' }],
      request: [{ round: 14, originalOwner: 'Kyle' }],
    }),
  );
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'keeper-broken');

  // The same trade is fine while keepers are still open.
  const open = state({ keepers: { Amy: selections }, keepersRevealed: true });
  assert.equal(
    checkProposalAgainstState(
      dataset,
      open,
      input({
        offer: [{ round: 1, originalOwner: 'Amy' }],
        request: [{ round: 14, originalOwner: 'Kyle' }],
      }),
    ).ok,
    true,
  );
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
      offer: [{ round: 2, originalOwner: 'Amy' }, { round: 5, originalOwner: 'Amy' }],
      request: [{ round: 1, originalOwner: 'Kyle' }],
    }),
    '2026-09-01T00:00:00.000Z',
    'trade-x',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((row) => row.to === 'Kyle').length, 2);
  assert.equal(rows.filter((row) => row.to === 'Amy').length, 1);
  assert.ok(rows.every((row) => row.proposalId === 'trade-x'));
});

test('a trade reads back as the exact picks, never as free text', () => {
  // Both sides put up a 2nd, so the old round-only line read "R2 for R2" and
  // said nothing. Amy drafts 10th, Kyle 5th, and round 2 runs backwards.
  assert.equal(describeTrade(proposal(), dataset), '2.1 for 2.6');
  assert.equal(
    describeTrade(proposal({ offer: [{ round: 3, originalOwner: 'Derek' }] }), dataset),
    '3.8 for 2.6',
  );
  assert.equal(
    describeTrade(
      proposal({
        offer: [{ round: 2, originalOwner: 'Amy' }, { round: 9, originalOwner: 'Brey' }],
      }),
      dataset,
    ),
    '2.1, 9.9 for 2.6',
  );
  assert.equal(describeTrade(proposal({ offer: [], request: [] }), dataset), 'Picks hidden');
});

test('without a dataset the summary still says which pick is which', () => {
  // The server calls this with the proposal alone. It can no longer print the
  // same words for two different picks.
  assert.equal(describeTrade(proposal()), 'R2 from Amy for R2 from Kyle');
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
  assert.equal(pickTitle({ round: 1, originalOwner: 'Kyle' }), '1st Round Pick');
  assert.equal(pickTitle({ round: 3, originalOwner: 'Amy' }), '3rd Round Pick');

  assert.equal(
    assetOrigin({ ref: { round: 1, originalOwner: 'Kyle' }, from: 'Kyle', to: 'Amy' }),
    "Kyle's own pick",
  );
  assert.equal(
    assetOrigin({ ref: { round: 1, originalOwner: 'Derek' }, from: 'Kyle', to: 'Amy' }),
    "Originally Derek's",
  );
});

/* ─── The exact pick behind a trade row ────────────────────────────────── */

test('the draft snakes, so an even round mirrors the draft order', () => {
  // Joel picks 1st, Kyle 5th, Brey 9th, Amy 10th.
  assert.equal(pickSlotFor(dataset, { round: 1, originalOwner: 'Joel' }), 1);
  assert.equal(pickSlotFor(dataset, { round: 1, originalOwner: 'Brey' }), 9);
  assert.equal(pickSlotFor(dataset, { round: 1, originalOwner: 'Amy' }), 10);

  // Round 2 runs the other way: 10th becomes 1st, 1st becomes 10th.
  assert.equal(pickSlotFor(dataset, { round: 2, originalOwner: 'Joel' }), 10);
  assert.equal(pickSlotFor(dataset, { round: 2, originalOwner: 'Kyle' }), 6);
  assert.equal(pickSlotFor(dataset, { round: 2, originalOwner: 'Amy' }), 1);

  // Odd rounds all read the same as round 1.
  assert.equal(pickSlotFor(dataset, { round: 7, originalOwner: 'Brey' }), 9);
  assert.equal(pickSlotFor(dataset, { round: 8, originalOwner: 'Brey' }), 2);

  assert.equal(pickSlotFor(dataset, { round: 1, originalOwner: 'Nobody' }), null);
});

test('a trade row shows the same pick number as the draft board', () => {
  // The proof. Every pick in the league, derived from a round plus the team it
  // came from, against the number the board itself hands out.
  const picks = buildAllPicks(dataset);
  assert.ok(picks.length > 100, 'the board has picks to check');
  for (const pick of picks) {
    assert.equal(
      exactPickLabel(dataset, refOf(pick)),
      pickLabel(pick),
      `pick ${pick.round} from ${pick.originalOwner}`,
    );
  }
});

test('trading a pick moves who holds it, never where it sits', () => {
  const moved = datasetWithTransfers(dataset, [transfer(1, 'Brey', 'Brey', 'Kyle')]);
  const ref = { round: 1, originalOwner: 'Brey' };
  assert.equal(ownerOf(moved, 1, 'Brey'), 'Kyle');
  assert.equal(exactPickLabel(moved, ref), '1.9');
  assert.equal(exactPickLabel(dataset, ref), '1.9');
});

test('a trade row names the exact pick, not just the round', () => {
  assert.equal(exactPickTitle(dataset, { round: 1, originalOwner: 'Brey' }), 'Pick 1.9');
  assert.equal(exactPickTitle(dataset, { round: 1, originalOwner: 'Kyle' }), 'Pick 1.5');
  assert.equal(exactPickTitle(dataset, { round: 7, originalOwner: 'Aaron' }), 'Pick 7.7');

  // Two first rounders in one trade must never read the same.
  assert.notEqual(
    exactPickTitle(dataset, { round: 1, originalOwner: 'Kyle' }),
    exactPickTitle(dataset, { round: 1, originalOwner: 'Derek' }),
  );

  // A team the league does not know still gets a title, just a vaguer one.
  assert.equal(exactPickTitle(dataset, { round: 3, originalOwner: 'Nobody' }), '3rd Round Pick');
  assert.equal(exactPickLabel(dataset, { round: 3, originalOwner: 'Nobody' }), 'R3');
});

test('each side of a trade reads from the seat of whoever is looking', () => {
  const offered = proposal({
    offer: [{ round: 1, originalOwner: 'Amy' }, { round: 6, originalOwner: 'Derek' }],
    request: [{ round: 1, originalOwner: 'Kyle' }],
  });

  const forProposer = tradeSidesFor(offered, 'Amy');
  assert.deepEqual(forProposer.receives, [
    { ref: { round: 1, originalOwner: 'Kyle' }, from: 'Kyle', to: 'Amy' },
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

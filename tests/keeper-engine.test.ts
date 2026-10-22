import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import {
  availablePlayers,
  buildDraftBoard,
  keeperCandidateError,
  resolveTeamKeepers,
} from '../src/lib/keeper/engine.ts';
import type {
  LeagueDataset,
  LeagueDynamicState,
} from '../src/lib/keeper/types.ts';

const dataset = rawDataset as unknown as LeagueDataset;

function state(
  patch: Partial<LeagueDynamicState> = {},
): LeagueDynamicState {
  return {
    season: dataset.season,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
    ...patch,
  };
}

test('rejects a keeper who did not finish the season on that owner roster', () => {
  const player = dataset.players.find((candidate) => candidate.fantasyTeam === 'Amy');
  assert.ok(player, 'fixture needs a player on Amy roster');

  const result = resolveTeamKeepers(dataset, 'Joel', [
    { playerKey: player.key, playerName: player.name },
  ]);

  assert.equal(result.valid, false);
  assert.match(result.errors[0] ?? '', /Amy's roster.*only they can keep him/);
});

test('rejects a keeper whose contract has expired', () => {
  const player = dataset.players.find(
    (candidate) =>
      candidate.fantasyTeam === 'Dustin' && candidate.keeper.contract?.expired === true,
  );
  assert.ok(player, 'fixture needs an expired contract on Dustin roster');

  const result = resolveTeamKeepers(dataset, 'Dustin', [
    { playerKey: player.key, playerName: player.name },
  ]);

  assert.equal(result.valid, false);
  assert.match(result.errors[0] ?? '', /contract has EXPIRED/);
});

test('assigns no on-clock pick before start and the first open pick after start', () => {
  const beforeStart = buildDraftBoard(dataset, state());
  assert.equal(beforeStart.some((cell) => cell.onClock), false);

  const afterStart = buildDraftBoard(
    dataset,
    state({ draft: { picks: {}, startedAt: '2026-10-18T21:00:00.000Z' } }),
  );
  const onClock = afterStart.find((cell) => cell.onClock);
  assert.equal(onClock?.pick.overall, 1);
  assert.equal(onClock?.pick.currentOwner, 'Joel');
});

test('removes valid keepers and drafted players from the available pool', () => {
  const keeper = dataset.players.find(
    (candidate) => candidate.fantasyTeam === 'Joel' && candidate.keeper.eligible,
  );
  const drafted = dataset.players.find(
    (candidate) => candidate.key !== keeper?.key && candidate.keeper.contract?.expired !== true,
  );
  assert.ok(keeper, 'fixture needs a valid Joel keeper');
  assert.ok(drafted, 'fixture needs a second player');

  const dynamic = state({
    keepers: {
      Joel: [{ playerKey: keeper.key, playerName: keeper.name }],
    },
    draft: {
      startedAt: '2026-10-18T21:00:00.000Z',
      picks: {
        '1': { playerKey: drafted.key, playerName: drafted.name },
      },
    },
  });
  const keys = new Set(availablePlayers(dataset, dynamic).map((player) => player.key));

  assert.equal(keys.has(keeper.key), false);
  assert.equal(keys.has(drafted.key), false);
});

test('does not reserve a player from an invalid keeper selection', () => {
  const amyPlayer = dataset.players.find(
    (candidate) => candidate.fantasyTeam === 'Amy' && candidate.keeper.eligible,
  );
  assert.ok(amyPlayer, 'fixture needs a player on Amy roster');

  const dynamic = state({
    keepers: {
      Joel: [{ playerKey: amyPlayer.key, playerName: amyPlayer.name }],
    },
  });
  const keys = new Set(availablePlayers(dataset, dynamic).map((player) => player.key));

  assert.equal(keys.has(amyPlayer.key), true);
});

test('an over-cap candidate blocks by default but taps through with allowOverCap', () => {
  // Two highest-value players on one roster are guaranteed to break the
  // 77.8 cap together (each decile-1 player runs ~40+ FPPG).
  const team = dataset.teams[0].owner;
  const [first, second] = dataset.players
    .filter((p) => p.fantasyTeam === team && p.keeper.eligible && p.keeper.round !== null)
    .sort((a, b) => (b.keeper.effectiveAvg ?? 0) - (a.keeper.effectiveAvg ?? 0));
  assert.ok(first && second, 'fixture needs two eligible players on one roster');

  const selections = [{ playerKey: first.key, playerName: first.name }];
  const overCap =
    resolveTeamKeepers(dataset, team, [
      ...selections,
      { playerKey: second.key, playerName: second.name },
    ]).capOk === false;
  assert.ok(overCap, 'fixture needs the top two players to break the cap');

  assert.match(
    keeperCandidateError(dataset, team, selections, second) ?? '',
    /Over cap by/,
  );
  assert.equal(
    keeperCandidateError(dataset, team, selections, second, { allowOverCap: true }),
    null,
  );

  // The full resolution still refuses the set, so it can be shown but not saved.
  const result = resolveTeamKeepers(dataset, team, [
    ...selections,
    { playerKey: second.key, playerName: second.name },
  ]);
  assert.equal(result.valid, false);
  assert.match(result.statusLine, /ILLEGAL KEEPERS/);
});

test('zero games is 25 or fewer: the season before sets the tier, and only no average at all means round 3', async () => {
  const { computeTiers } = await import('../src/lib/keeper/engine.ts');
  // A hundred ranked players from 60.0 down, half a point apart: round 2 is 55.0 to 49.6 and so on.
  const ranked = Array.from({ length: 100 }, (_, i) => ({
    key: `r${i}`, avg2026: 60 - i * 0.5, gp2026: 70, priorAvg: null, ranked: true,
  }));
  const tiers = computeTiers([
    ...ranked,
    { key: 'hurt-all-year', avg2026: null, gp2026: 0, priorAvg: 52, ranked: false },
    { key: 'hurt-most-of-year', avg2026: 30, gp2026: 20, priorAvg: 52, ranked: false },
    { key: 'never-played', avg2026: null, gp2026: 0, priorAvg: null, ranked: false },
  ], {});
  const hurtAllYear = tiers.assignments.get('hurt-all-year')!;
  assert.equal(hurtAllYear.round, 2);
  assert.equal(hurtAllYear.effectiveAvg, 52);
  assert.ok(hurtAllYear.usesPriorYear && hurtAllYear.zeroGp);
  assert.equal(tiers.assignments.get('hurt-most-of-year')!.round, 2);
  const neverPlayed = tiers.assignments.get('never-played')!;
  assert.equal(neverPlayed.round, 3);
  assert.equal(neverPlayed.effectiveAvg, null);
  // The committed dataset agrees: Haliburton sat out 2025-26 and keeps on his 2024-25 line.
  const haliburton = dataset.players.find((p) => p.fullName === 'Tyrese Haliburton')!;
  assert.equal(haliburton.keeper.round, 2);
  assert.ok(haliburton.keeper.zeroGp2026 && haliburton.keeper.usesPriorYear);
});


test('a closed draft keeps its board without assigning a new on-clock pick', () => {
  const draft = {
    startedAt: '2026-10-18T21:00:00Z',
    closedAt: '2026-10-19T03:00:00Z',
    picks: { '1': { owner: 'Joel', playerKey: 'camara', playerName: 'Toumani Camara', pickedAt: '2026-10-19T02:59:00Z' } },
  };
  const closed = buildDraftBoard(dataset, state({ draft }));
  assert.equal(closed[0].selection?.playerName, 'Toumani Camara');
  assert.equal(closed.some((cell) => cell.onClock), false);
  const reopened = buildDraftBoard(dataset, state({ draft: { ...draft, closedAt: null } }));
  assert.equal(reopened.find((cell) => cell.onClock)?.pick.overall, 2);
});

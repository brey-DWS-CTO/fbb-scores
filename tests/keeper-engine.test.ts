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

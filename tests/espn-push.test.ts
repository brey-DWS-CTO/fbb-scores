import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import { buildAllPicks, buildDraftBoard } from '../src/lib/keeper/engine.js';
import { espnPushPlan, espnPushText } from '../src/lib/league/espnPush.js';
import type { DraftPickState, LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.js';

const dataset = rawDataset as unknown as LeagueDataset;

function state(patch: Partial<LeagueDynamicState> = {}): LeagueDynamicState {
  return {
    season: dataset.season,
    keepers: {},
    keepersRevealed: true,
    draft: { picks: {}, startedAt: '2026-10-18T21:00:00.000Z' },
    locks: { keepersLocked: true },
    ...patch,
  };
}

/** Every pick filled from the dataset, in overall order. */
function fullDraft(skip: readonly number[] = []): Record<string, DraftPickState> {
  const picks: Record<string, DraftPickState> = {};
  const players = dataset.players.filter((player) => player.fullName);
  for (const slot of buildAllPicks(dataset)) {
    if (skip.includes(slot.overall)) continue;
    const player = players[slot.overall - 1];
    picks[String(slot.overall)] = {
      playerKey: player.key,
      playerName: player.fullName ?? player.name,
      proTeam: player.proTeam,
      positions: player.positions,
    };
  }
  return picks;
}

test('every team gets its ESPN id, its live name, and one row per pick', () => {
  const board = buildDraftBoard(dataset, state({ draft: { picks: fullDraft(), startedAt: 'x' } }));
  const plan = espnPushPlan(board, dataset.teams, { Bryan: 'Team Clown Baby' });

  assert.equal(plan.teams.length, 10);
  assert.equal(plan.total, 140);
  assert.equal(plan.filled, 140);
  assert.deepEqual(plan.problems, []);

  const bryan = plan.teams.find((team) => team.owner === 'Bryan');
  assert.ok(bryan);
  assert.equal(bryan.espnTeamId, 6);
  assert.equal(bryan.teamName, 'Team Clown Baby');

  for (const team of plan.teams) {
    assert.equal(team.rows.length, 14, `${team.owner} has 14 picks`);
    assert.deepEqual(team.rows.map((row) => row.row), Array.from({ length: 14 }, (_, i) => i + 1));
    for (let i = 1; i < team.rows.length; i++) {
      assert.ok(team.rows[i].overall > team.rows[i - 1].overall, 'rows follow draft order');
    }
  }
});

test('an empty pick is a problem that names the pick, and the text says EMPTY', () => {
  const board = buildDraftBoard(dataset, state({ draft: { picks: fullDraft([3, 17]), startedAt: 'x' } }));
  const plan = espnPushPlan(board, dataset.teams);

  assert.equal(plan.filled, 138);
  assert.equal(plan.problems.length, 2);
  assert.match(plan.problems.join('\n'), /Pick 1\.3 still empty/);
  assert.match(plan.problems.join('\n'), /Pick 2\.7 still empty/);

  const text = espnPushText(plan);
  assert.match(text, /138 of 140 picks filled/);
  assert.match(text, /Settle first:/);
  assert.match(text, /EMPTY/);
});

test('a keeper is a row like any other, marked keeper', () => {
  const keeper = dataset.players.find((player) => player.fantasyTeam === 'Amy' && player.keeper.eligible);
  assert.ok(keeper, 'fixture needs an eligible keeper on Amy roster');
  const picks = fullDraft();
  const board = buildDraftBoard(
    dataset,
    state({
      keepers: { Amy: [{ playerKey: keeper.key, playerName: keeper.fullName ?? keeper.name }] },
      draft: { picks, startedAt: 'x' },
    }),
  );
  const plan = espnPushPlan(board, dataset.teams);
  const amy = plan.teams.find((team) => team.owner === 'Amy');
  assert.ok(amy);
  const row = amy.rows.find((candidate) => candidate.keeper);
  assert.ok(row, 'Amy has a keeper row');
  assert.equal(row.playerName, keeper.fullName ?? keeper.name);
  assert.equal(row.proTeam, keeper.proTeam);
  assert.match(espnPushText(plan), new RegExp(`${row.playerName}.*\\(keeper, pick ${row.label.replace('.', '\\.')}\\)`));
});

test('a traded pick moves the row to the team that holds it', () => {
  const trade = dataset.pickTrades[0];
  assert.ok(trade, 'fixture needs a seed pick trade');
  const board = buildDraftBoard(dataset, state({ draft: { picks: fullDraft(), startedAt: 'x' } }));
  const plan = espnPushPlan(board, dataset.teams);
  const holder = plan.teams.find((team) => team.owner === trade.to);
  assert.ok(holder);
  const slot = buildAllPicks(dataset).find((pick) => pick.round === trade.round && pick.originalOwner === (trade.originalOwner ?? trade.from));
  assert.ok(slot);
  assert.ok(holder.rows.some((row) => row.overall === slot.overall), 'the holder lists the traded pick');
});

test('more picks than ESPN rows is flagged, never guessed', () => {
  const board = buildDraftBoard(dataset, state({ draft: { picks: fullDraft(), startedAt: 'x' } }));
  const plan = espnPushPlan(board, dataset.teams, null, 13);
  assert.ok(plan.problems.some((problem) => /14 picks, but ESPN has 13 rows/.test(problem)));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';
import { projectedFppg, projectedPerGame, type DraftRankingSnapshot } from '../src/lib/league/draftRankings.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import {
  SEED_EDITS,
  applyProjectionEdits,
  editedProjection,
  editsById,
  parseProjectionEdit,
  previewEdit,
  type ProjectionEdit,
} from '../src/lib/league/projectionEdits.ts';
import { buildProjections, editTitle, filterProjections } from '../src/lib/league/projections.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const snapshot = fixture as unknown as DraftRankingSnapshot;
const scoring = snapshot.scoringItems;
const espnOf = (name: string) => snapshot.players.find((player) => player.fullName === name)!;
const edit = (espnId: number, name: string, games: number | null, perGame: Record<string, number> = {}): ProjectionEdit => ({
  espnId, name, games, perGame, note: '', editedAt: '2026-10-01T00:00:00.000Z', editedBy: 'Brey',
});

test('games alone keep the per-game line and the FPPG, and cut the total', () => {
  const porzingis = espnOf('Kristaps Porzingis');
  const row = editedProjection(porzingis.projection, edit(porzingis.espnId, 'Kristaps Porzingis', 25))!;
  assert.equal(row.stats['42'], 25);
  const before = projectedPerGame(porzingis.projection)!;
  const after = projectedPerGame(row)!;
  for (const id of ['0', '6', '3', '13', '14']) assert.ok(Math.abs(before[id] - after[id]) < 1e-9, id);
  assert.equal(projectedFppg(row, scoring), projectedFppg(porzingis.projection, scoring));
  const preview = previewEdit(porzingis.projection, { games: 25, perGame: {} }, scoring);
  assert.equal(preview.total, Math.round(preview.fppg! * 25));
});

test('a per-game change rescores in league settings, missed shots included', () => {
  const jokic = espnOf('Nikola Jokic');
  const base = previewEdit(jokic.projection, { games: null, perGame: {} }, scoring);
  // Two more points a game is two more fantasy points (PTS scores 1).
  const morePoints = previewEdit(jokic.projection, { games: null, perGame: { '0': projectedPerGame(jokic.projection)!['0'] + 2 } }, scoring);
  assert.ok(Math.abs(morePoints.fppg! - base.fppg! - 2) < 0.15, `${base.fppg} -> ${morePoints.fppg}`);
  // One more field goal attempt, same makes: one more miss at -0.7.
  const line = projectedPerGame(jokic.projection)!;
  const moreMisses = previewEdit(jokic.projection, { games: null, perGame: { '14': line['14'] + 1, '13': line['13'] } }, scoring);
  assert.ok(Math.abs(base.fppg! - moreMisses.fppg! - 0.7) < 0.15, `${base.fppg} -> ${moreMisses.fppg}`);
  // Twelve rebounds and assists a game makes a double-double nearly certain.
  const dd = previewEdit(jokic.projection, { games: null, perGame: { '6': 3, '3': 3 } }, scoring);
  assert.ok(dd.bonus < base.bonus, 'fewer boards and assists, less bonus');
});

test('edits apply across the snapshot and reach the draft values', () => {
  const edits = editsById(SEED_EDITS.map((seed) => ({ ...seed, editedAt: 'x', editedBy: 'Brey' })));
  const edited = applyProjectionEdits(snapshot, edits);
  assert.notEqual(edited, snapshot);
  assert.equal(espnOf('Kristaps Porzingis').projection!.stats['42'], 59, 'the original is untouched');
  assert.equal(edited.players.find((player) => player.espnId === 3102531)!.projection!.stats['42'], 25);
  const before = valueBoard(dataset.players, snapshot, { projectionsOnly: true });
  const after = valueBoard(dataset.players, edited, { projectionsOnly: true });
  const rankOf = (board: typeof before, id: number) => board.entries.find((entry) => entry.player.espnId === id)!.rank;
  assert.ok(rankOf(after, 3102531) > rankOf(before, 3102531), 'Porzingis falls with 25 games');

  const rows = buildProjections(after, edited, { keepers: {}, status: {} }, edits, snapshot);
  const row = rows.find((entry) => entry.espnId === 3102531)!;
  assert.equal(row.games, 25);
  assert.equal(row.espn?.games, 59);
  assert.match(editTitle(row)!, /ESPN: .* over 59 games/);
  assert.deepEqual(filterProjections(rows, { editedOnly: true }).map((entry) => entry.espnId).sort(), [3102531, 3913176]);
  assert.equal(applyProjectionEdits(snapshot, new Map()), snapshot);
});

test('a bad edit is refused in plain words', () => {
  assert.deepEqual(
    parseProjectionEdit(7, { name: ' Kyle Guy ', games: 30.4, perGame: { '0': 12.34 }, note: ' hurt ' }),
    { espnId: 7, name: 'Kyle Guy', games: 30, perGame: { '0': 12.3 }, note: 'hurt' },
  );
  assert.throws(() => parseProjectionEdit(7, { name: 'X' }), /at least one/);
  assert.throws(() => parseProjectionEdit(7, { name: 'X', games: 90 }), /between 0 and 82/);
  assert.throws(() => parseProjectionEdit(7, { name: 'X', perGame: { '37': 1 } }), /cannot be edited/);
  assert.throws(() => parseProjectionEdit(7, { name: 'X', perGame: { '0': -1 } }), /between 0 and/);
  assert.throws(() => parseProjectionEdit(0, { name: 'X', games: 3 }), /not a player/);
  assert.throws(() => parseProjectionEdit(7, { games: 3 }), /player name/);
});

test('one cell at a time: a change is kept, typing ESPN back drops it, and an empty edit goes', async () => {
  const { withCellEdit, cellEdited } = await import('../src/lib/league/projectionEdits.ts');
  const jokic = espnOf('Nikola Jokic');
  const line = projectedPerGame(jokic.projection)!;
  const first = withCellEdit(null, jokic.projection, '0', 30);
  assert.deepEqual(first, { games: null, perGame: { '0': 30 }, note: '' });
  assert.ok(cellEdited(first, '0'));
  assert.ok(!cellEdited(first, '42'));
  const second = withCellEdit(first, jokic.projection, '42', 60);
  assert.deepEqual(second, { games: 60, perGame: { '0': 30 }, note: '' });
  // Typing ESPN's own number back takes that field out.
  const third = withCellEdit(second, jokic.projection, '0', line['0']);
  assert.deepEqual(third, { games: 60, perGame: {}, note: '' });
  assert.equal(withCellEdit(third, jokic.projection, '42', 72), null);
});

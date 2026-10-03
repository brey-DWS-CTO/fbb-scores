import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import { buildProjections } from '../src/lib/league/projections.ts';
import { leagueSchedule2027 } from '../src/lib/league/scheduleData.ts';
import {
  buildTierRows,
  labelSide,
  naturalBreaks,
  niceTicks,
  tierCountFor,
  tierPages,
  type TierRow,
} from '../src/lib/league/tierChart.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const values = valueBoard(dataset.players, fixture, { schedule: leagueSchedule2027, projectionsOnly: true });
const projections = buildProjections(values, fixture, { keepers: {}, status: {} });
const rows = buildTierRows(projections, dataset.players);
const find = (list: readonly TierRow[], name: string) => {
  const row = list.find((entry) => entry.name === name);
  assert.ok(row, `${name} is on the chart`);
  return row;
};

// ─── Natural breaks ─────────────────────────────────────────────────────────

test('natural breaks find the obvious gaps, best group first', () => {
  assert.deepEqual(naturalBreaks([10, 11, 50, 52, 30, 31], 3), [2, 2, 0, 0, 1, 1]);
});

test('equal values always share a group', () => {
  const groups = naturalBreaks([5, 5, 5, 1], 3);
  assert.equal(groups[0], groups[1]);
  assert.equal(groups[1], groups[2]);
  assert.notEqual(groups[2], groups[3]);
});

test('never more groups than distinct values, and none for nothing', () => {
  assert.deepEqual(naturalBreaks([7, 7, 3], 10), [0, 0, 1]);
  assert.deepEqual(naturalBreaks([4], 3), [0]);
  assert.deepEqual(naturalBreaks([], 3), []);
});

test('tier counts: about one per eight players, at least two', () => {
  assert.equal(tierCountFor(1), 1);
  assert.equal(tierCountFor(5), 2);
  assert.equal(tierCountFor(200), 25);
  assert.equal(tierCountFor(1000), 30);
});

// ─── Rows from the real ESPN projections ───────────────────────────────────

test('ranked by season total, tiers never go backwards', () => {
  assert.ok(rows.length > 200);
  assert.deepEqual(rows.slice(0, 3).map((row) => row.name), ['Nikola Jokic', 'Shai Gilgeous-Alexander', 'Luka Doncic']);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].total <= rows[i - 1].total, `${rows[i].name} is not above ${rows[i - 1].name}`);
    assert.ok(rows[i].tier >= rows[i - 1].tier, `${rows[i].name}'s tier`);
    assert.equal(rows[i].rank, i + 1);
  }
  assert.equal(rows[0].tier, 1);
});

test('every player on the chart has a projection and a season total', () => {
  for (const row of rows) {
    assert.ok(Number.isFinite(row.fppg) && Number.isFinite(row.total) && row.games > 0, row.name);
    assert.ok(row.fppgLow <= row.fppg && row.fppg <= row.fppgHigh, `${row.name}'s dot sits on his bar`);
  }
});

test('Jokic: a tight bar, ESPN and last season agree', () => {
  const jokic = find(rows, 'Nikola Jokic');
  assert.deepEqual(jokic.estimates.map((estimate) => estimate.label), ['ESPN projection', 'Last season']);
  assert.equal(jokic.fppgLow, 64.2);
  assert.equal(jokic.fppgHigh, 64.7);
});

test('last season\'s games come from ESPN\'s full count', () => {
  const giannis = find(rows, 'Giannis Antetokounmpo');
  assert.equal(giannis.lastGames, 36);
  assert.equal(find(rows, 'Nikola Jokic').lastGames, 65);
});

test('Tatum: the season before widens a short season', () => {
  const tatum = find(rows, 'Jayson Tatum');
  assert.deepEqual(tatum.estimates.map((estimate) => estimate.label), ['ESPN projection', 'Last season', 'Season before']);
  assert.equal(tatum.fppgLow, 37.1);
  assert.equal(tatum.fppgHigh, 46.6);
});

test('no history: the bar is just the dot', () => {
  const jokic = projections.find((row) => row.name === 'Nikola Jokic')!;
  const rookie = { ...jokic, key: 'rookie', name: 'A. Rookie', lastSeason: null };
  const [row] = buildTierRows([rookie], dataset.players);
  assert.equal(row.estimates.length, 1);
  assert.equal(row.lastGames, null);
  assert.equal(row.fppgLow, row.fppgHigh);
});

test('a commish edit puts ESPN\'s own number on the bar', () => {
  const jokic = projections.find((row) => row.name === 'Nikola Jokic')!;
  const edited = { ...jokic, fppg: 70, total: 70 * 72, edit: { espnId: jokic.espnId! } as never, espn: { fppg: jokic.fppg, games: 72 } };
  const [row] = buildTierRows([edited], dataset.players);
  assert.deepEqual(row.estimates.map((estimate) => estimate.label), ['Commish projection', 'ESPN projection', 'Last season']);
  assert.equal(row.fppgHigh, 70);
  assert.equal(row.fppgLow, 64.2);
});

test('position filter and hide keepers recut the tiers over what is left', () => {
  const centers = buildTierRows(projections, dataset.players, { position: 'C' });
  assert.ok(centers.length > 10);
  assert.ok(centers.every((row) => row.positions.includes('C')));
  assert.equal(centers[0].name, 'Nikola Jokic');
  assert.equal(centers[0].rank, 1);

  const jokicKey = projections.find((row) => row.name === 'Nikola Jokic')!.key;
  const kept = buildProjections(values, fixture, { keepers: { Joel: [{ playerKey: jokicKey, playerName: 'Nikola Jokic' }] }, status: { Joel: 'known' } });
  const open = buildTierRows(kept, dataset.players, { hideKept: true });
  assert.ok(!open.some((row) => row.name === 'Nikola Jokic'));
  assert.equal(open[0].rank, 1);
  assert.equal(open[0].tier, 1);
  const all = buildTierRows(kept, dataset.players);
  assert.equal(all[0].tag, 'keeper');
  assert.equal(all[0].keptBy, 'Joel');
});

// ─── Drawing helpers ───────────────────────────────────────────────────────

test('pages of fifty', () => {
  assert.deepEqual(tierPages(120), ['1–50', '51–100', '101–120']);
  assert.deepEqual(tierPages(0), []);
});

test('nice ticks: a range that hugs the data, round ticks inside it', () => {
  const fppg = niceTicks(31.2, 64.7, 4);
  assert.ok(fppg.min < 31.2 && fppg.min > 30);
  assert.ok(fppg.max > 64.7 && fppg.max < 66);
  assert.deepEqual(fppg.ticks, [40, 50, 60]);
  assert.deepEqual(niceTicks(734, 4658, 2).ticks, [2000, 4000]);
  const flat = niceTicks(40, 40);
  assert.ok(flat.min < 40 && flat.max > 40 && flat.ticks.length > 0);
});

test('names sit left of the bar unless they would fall off the plot', () => {
  assert.equal(labelSide(200, 220, 80, 30, 300), 'left');
  assert.equal(labelSide(60, 80, 80, 30, 300), 'right');
  // No room either side: the roomier one.
  assert.equal(labelSide(150, 160, 200, 30, 200), 'left');
  assert.equal(labelSide(100, 120, 200, 30, 220), 'right');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';
import { lastSeasonFppg, projectedFppg, previewDraftRankingRefresh } from '../src/lib/league/draftRankings.ts';
import { valueBoard, fitRankToPoints, pointsForRank } from '../src/lib/league/draftValue.ts';
import { applyPlayerPoolToDataset, playerPoolFromDataset } from '../src/lib/league/playerPool.ts';

const committed = rawDataset as unknown as LeagueDataset;
const known = new Set(committed.players.map((player) => player.espnId));
const dataset = applyPlayerPoolToDataset(committed, [
  ...playerPoolFromDataset(committed.players),
  ...fixture.players.filter((entry) => !known.has(entry.espnId)).map((entry) => ({
    key: `p${entry.espnId}`, espnId: entry.espnId, fullName: entry.fullName,
    proTeam: entry.proTeam, positions: entry.positions, sourceStatus: 'fetched' as const,
  })),
]);

test('real capture has full-season totals and games, including new rookies', () => {
  const projected = fixture.players.filter((player) => player.projection);
  assert.equal(projected.length, 349);
  for (const player of projected) {
    const row = player.projection!;
    assert.equal(row.id, '102027');
    assert.equal(row.statSourceId, 1);
    assert.equal(row.statSplitTypeId, 0);
    assert.equal(row.seasonId, 2027);
    assert.equal(row.scoringPeriodId, 0);
    if (player.fullName === 'Jordan Miller') {
      assert.deepEqual(row.stats, {}, 'ESPN publishes an empty row for this injured player');
      assert.equal(projectedFppg(row, fixture.scoringItems), null);
      continue;
    }
    assert.ok(row.stats['42'] > 0);
    assert.equal(row.averageStats, null);
    const points = projectedFppg(row, fixture.scoringItems)!;
    assert.ok(points > 0 && points < 80, `${player.fullName}: ${points}`);
  }
  for (const name of ['AJ Dybantsa', 'Darryn Peterson', 'Cameron Boozer']) {
    assert.ok(projected.some((player) => player.fullName === name), name);
  }
});

test('real projections are per-game numbers on the same scale as last season', () => {
  const comparisons = committed.players.flatMap((player) => {
    const row = fixture.players.find((entry) => entry.espnId === player.espnId)?.projection ?? null;
    const projected = projectedFppg(row, fixture.scoringItems);
    const last = lastSeasonFppg(player);
    return projected !== null && last !== null && last > 0
      ? [{ name: player.fullName, last, projected, ratio: projected / last }] : [];
  });
  assert.ok(comparisons.length > 200);
  const outliers = comparisons.filter((entry) => entry.ratio > 1.6 || entry.ratio < 1 / 1.6);
  assert.deepEqual(outliers.map((entry) => [entry.name, entry.last, entry.projected]), [
    ['Bradley Beal', 9.8, 23.2], ['Steven Adams', 18.2, 9.8],
    ['Gradey Dick', 10, 18.2], ['Jeremy Sochan', 8.3, 17.8],
  ], 'reviewed forecast changes outside the 1.6 band, never silently widen it');
  assert.ok(comparisons.every((entry) => entry.ratio < 10), 'season totals never masquerade as FPPG');
  const top = valueBoard(dataset.players, fixture).entries[0];
  assert.ok(top.fppg! >= 50 && top.fppg! <= 70);
});

test('the real board uses projections and fits missing ranks against projected points', () => {
  const board = valueBoard(dataset.players, fixture);
  assert.equal(board.primary, 'projection');
  assert.equal(board.counts.projection, 348);
  const expected = fitRankToPoints(fixture.players.flatMap((entry) => {
    const points = projectedFppg(entry.projection, fixture.scoringItems);
    return entry.standard && points !== null ? [{ rank: entry.standard.rank, points }] : [];
  }));
  assert.deepEqual(board.bridge, expected);
  for (const entry of board.entries.filter((entry) => entry.source === 'espn-rank')) {
    assert.equal(projectedFppg(fixture.players.find((player) => player.espnId === entry.player.espnId)?.projection ?? null, fixture.scoringItems), null);
    assert.ok(entry.fppg! > 0);
  }
  // Remove a rookie's projection to exercise a ranked player with no history.
  const rookie = fixture.players.find((player) => player.fullName === 'AJ Dybantsa')!;
  const without = { ...fixture, players: fixture.players.map((entry) => entry === rookie ? { ...entry, projection: null } : entry) };
  const missing = valueBoard(dataset.players, without);
  const entry = missing.entries.find((value) => value.player.espnId === rookie.espnId)!;
  assert.equal(entry.source, 'espn-rank');
  assert.equal(entry.fppg, Math.round(pointsForRank(missing.bridge!, rookie.standard!.rank) * 10) / 10);
});

test('games reduce value, including an explicit zero, without losing the player', () => {
  const player = dataset.players.find((entry) => entry.fullName === 'Nikola Jokic')!;
  const original = fixture.players.find((entry) => entry.espnId === player.espnId)!;
  const values = [82, 60, 0].map((games) => {
    const projection = { id: '102027', stats: { '0': games * 50, '42': games }, averageStats: null };
    const board = valueBoard([player], { players: [{ ...original, projection }], scoringItems: [{ statId: 0, points: 1 }] });
    return board.entries[0];
  });
  assert.equal(values[0].fppg, 50);
  assert.equal(values[1].fppg, 50);
  assert.ok(values[1].seasonValue! < values[0].seasonValue!);
  assert.equal(values[1].availability, 60 / 82);
  assert.equal(values[2].availability, 0);
  assert.equal(values[2].source, 'last-season');
  assert.ok(Number.isFinite(values[2].seasonValue));
});

test('real candidate announces projections, but cannot score them without league settings', () => {
  const preview = previewDraftRankingRefresh({ players: [], scoringItems: [] }, fixture.players, fixture.scoringItems);
  assert.equal(preview.projectionArrived, true);
  assert.equal(preview.counts.projected, 348);
  const noScoring = valueBoard(dataset.players, { players: preview.nextPlayers, scoringItems: [] });
  assert.equal(noScoring.counts.projection, 0);
  assert.equal(noScoring.primary, 'espn-rank');
});

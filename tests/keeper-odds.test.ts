/**
 * The commissioner's keeper odds: how often a player is gone by the pick
 * the keep would cost.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import { valueBoard } from '../src/lib/league/draftValue.ts';
import { keeperCostSlot, oddsTone, openOwnerBoard, shareGoneBefore, simulateTakenAt } from '../src/lib/league/keeperOdds.ts';
import { buildMockBoard, defaultMockSettings, prepareMock } from '../src/lib/league/mockDraft.ts';
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
const values = valueBoard(dataset.players, fixture);
const OWNERS = dataset.teams.map((team) => team.owner);
const select = (fullName: string) => {
  const found = dataset.players.find((player) => player.fullName === fullName);
  assert.ok(found, fullName);
  return { playerKey: found.key, playerName: found.name };
};
const cade = select('Cade Cunningham');
const state: LeagueDynamicState = {
  season: 2027, keepers: { Brey: [cade] }, keepersRevealed: false,
  draft: { picks: {}, startedAt: null }, locks: { keepersLocked: false },
};
const board = buildMockBoard(dataset, { viewer: 'Brey', state, scenario: { Joel: [select('Nikola Jokic')] } });

test('opening the owner\'s board frees his keeper slots and nobody else\'s', () => {
  const kept = board.slots.find((slot) => slot.pick.overall === 9);
  assert.equal(kept?.keeper?.playerKey, cade.playerKey);
  assert.ok(board.taken.includes(cade.playerKey));
  const open = openOwnerBoard(board, 'Brey');
  assert.equal(open.slots.find((slot) => slot.pick.overall === 9)?.keeper, null);
  assert.ok(!open.taken.includes(cade.playerKey));
  // Joel's projected Jokic stays put.
  assert.equal(open.slots.find((slot) => slot.pick.overall === 1)?.keeper?.playerName, 'N. Jokic');
  assert.equal(open.slots.length, board.slots.length);
});

test('a top player is almost always gone by 1.9; nobody is gone before 1.1', () => {
  const open = openOwnerBoard(board, 'Brey');
  const prepared = prepareMock({ board: open, values, settings: defaultMockSettings('sharp', OWNERS, 7) });
  const taken = simulateTakenAt(prepared, 7, 40);
  assert.equal(taken.runs, 40);
  const byNine = shareGoneBefore(taken, cade.playerKey, 9);
  assert.ok(byNine > 0.5, `Cade gone by 1.9: ${byNine}`);
  assert.equal(shareGoneBefore(taken, cade.playerKey, 1), 0);
  // By the end of the draft he is always gone; a nobody never is.
  assert.equal(shareGoneBefore(taken, cade.playerKey, 999), 1);
  assert.equal(shareGoneBefore(taken, 'nobody', 999), 0);
  // The same seed gives the same answer.
  assert.equal(shareGoneBefore(simulateTakenAt(prepared, 7, 40), cade.playerKey, 9), byNine);
});

test('the cost slot is the owner\'s pick in that round, skipping picks already charged', () => {
  const slot = keeperCostSlot(board.slots, 'Brey', 1);
  assert.equal(slot?.pick.overall, 9);
  assert.equal(keeperCostSlot(board.slots, 'Brey', 1, new Set([9])), null);
  assert.equal(keeperCostSlot(board.slots, 'Brey', 2)?.pick.round, 2);
  assert.equal(keeperCostSlot(board.slots, 'Brey', 99), null);
});

test('tone: keep him at 70 and up, maybe from 40, skip under 40', () => {
  assert.equal(oddsTone(0.1), 'skip');
  assert.equal(oddsTone(0.4), 'maybe');
  assert.equal(oddsTone(0.69), 'maybe');
  assert.equal(oddsTone(0.7), 'keep');
});

/**
 * The mock draft room around the live mock: who is up, your roster by slot,
 * the queue, the grid, and the saved draft.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import { DEFAULT_ROSTER, valueBoard } from '../src/lib/league/draftValue.ts';
import { replayLive } from '../src/lib/league/liveMock.ts';
import { buildMockBoard, defaultMockSettings, prepareMock } from '../src/lib/league/mockDraft.ts';
import {
  draftGrid,
  moveQueued,
  parseMockSave,
  picksUntilTurn,
  queuedPick,
  replaySaved,
  rosterBySlot,
  toggleQueued,
  upcomingPicks,
  type MockSave,
} from '../src/lib/league/draftRoom.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const values = valueBoard(dataset.players, fixture, { projectionsOnly: true });
const OWNERS = dataset.teams.map((team) => team.owner);
const select = (fullName: string) => {
  const found = dataset.players.find((player) => player.fullName === fullName);
  assert.ok(found, fullName);
  return { playerKey: found.key, playerName: found.name };
};
const state: LeagueDynamicState = {
  season: 2027, keepers: {}, keepersRevealed: false,
  draft: { picks: {}, startedAt: null }, locks: { keepersLocked: false },
};
const board = buildMockBoard(dataset, { viewer: 'Brey', state, scenario: { Joel: [select('Nikola Jokic')] } });
const prepared = prepareMock({ board, values, settings: defaultMockSettings('realistic', OWNERS, 7) });
const slots = board.slots;

test('upcoming picks run in draft order and mark keepers and the person', () => {
  const next = upcomingPicks(slots, 1, 'Brey', 12);
  assert.equal(next.length, 12);
  assert.deepEqual(next.slice(0, 2).map((pick) => [pick.overall, pick.owner, pick.fixed]), [[1, 'Joel', true], [2, 'Ryan', false]]);
  assert.ok(next.some((pick) => pick.mine && pick.overall === 9));
  // Snake: Amy picks 10 and 11.
  assert.deepEqual(next.slice(9, 11).map((pick) => pick.owner), ['Amy', 'Amy']);
});

test('picks until your turn counts only live slots before yours', () => {
  assert.equal(picksUntilTurn(slots, 9, 'Brey'), 0);
  const fromOne = picksUntilTurn(slots, 1, 'Brey');
  const fixedBefore = slots.filter((slot) => slot.pick.overall < 9 && (slot.keeper || slot.made)).length;
  assert.equal(fromOne, 8 - fixedBefore);
  // After the last of Brey's slots there is no next turn.
  const last = Math.max(...slots.filter((slot) => slot.pick.currentOwner === 'Brey').map((slot) => slot.pick.overall));
  assert.equal(picksUntilTurn(slots, last + 1, 'Brey'), null);
});

test('roster by slot fills the most fitting open slot, then the bench', () => {
  const fills = rosterBySlot([
    { playerKey: 'c1', positions: ['C'] },
    { playerKey: 'c2', positions: ['C'] },
    { playerKey: 'g1', positions: ['PG', 'SG'] },
    { playerKey: 'c3', positions: ['C'] },
    { playerKey: 'c4', positions: ['C'] },
    { playerKey: 'c5', positions: ['C'] },
  ], DEFAULT_ROSTER);
  const at = (key: string) => fills.find((fill) => fill.playerKey === key)?.slot;
  assert.equal(fills.length, 10 + DEFAULT_ROSTER.bench);
  assert.equal(at('c1'), 'C');
  assert.equal(at('c2'), 'FLEX');
  assert.equal(at('g1'), 'PG');
  assert.equal(at('c5'), 'BE');
  assert.deepEqual(fills.slice(0, 10).map((fill) => fill.slot), ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'FLEX', 'FLEX', 'FLEX']);
});

test('queue: add, remove, reorder, and the first one still on the board', () => {
  let queue = toggleQueued([], 'a');
  queue = toggleQueued(queue, 'b');
  queue = toggleQueued(queue, 'c');
  assert.deepEqual(moveQueued(queue, 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveQueued(queue, 'a', -1), ['a', 'b', 'c']);
  assert.deepEqual(toggleQueued(queue, 'b'), ['a', 'c']);
  const available = [
    { playerKey: 'x', playerName: 'X', positions: [], valueRank: 1, roomRank: null, source: 'projection' as const },
    { playerKey: 'c', playerName: 'C', positions: [], valueRank: 5, roomRank: null, source: 'projection' as const },
  ];
  assert.equal(queuedPick(queue, available)?.playerKey, 'c');
  assert.equal(queuedPick([], available)?.playerKey, 'x');
  assert.equal(queuedPick(['gone'], [])?.playerKey ?? null, null);
});

test('the grid is rounds by teams in first-round order, snake intact', () => {
  const live = replayLive(prepared, 7, 'Brey', {});
  const grid = draftGrid(slots, live.picks, live.waitingOn?.pick.overall ?? null);
  assert.deepEqual(grid.owners, ['Joel', 'Ryan', 'Patrick', 'Bryan', 'Kyle', 'Dustin', 'Aaron', 'Derek', 'Brey', 'Amy']);
  assert.ok(grid.rounds.every((row) => row.length === 10));
  // Round 2, Amy's column holds overall 11; Joel's holds 20.
  assert.equal(grid.rounds[1][9].overall, 11);
  assert.equal(grid.rounds[1][0].overall, 20);
  // Picks before Brey's are filled; his is on the clock.
  assert.ok(grid.rounds[0].slice(0, 8).every((cell) => cell.pick !== null));
  assert.equal(grid.rounds[0][0].pick?.how, 'keeper');
  assert.equal(grid.rounds[0][8].current, true);
  assert.equal(grid.rounds[0][8].pick, null);
});

const save: MockSave = {
  version: 1, seed: 7, mode: 'sharp', started: true, choices: { 9: 'k1' }, queue: ['k2'], clockLeft: 80,
  tradesOn: [], tryKeepers: false, tryPicks: ['', ''], useEntered: true, guessInstead: [], mockTrades: [],
};

test('a save reads back, and junk reads as nothing', () => {
  assert.deepEqual(parseMockSave(JSON.stringify(save)), save);
  assert.equal(parseMockSave(null), null);
  assert.equal(parseMockSave('not json'), null);
  assert.equal(parseMockSave(JSON.stringify({ ...save, version: 2 })), null);
  assert.equal(parseMockSave(JSON.stringify({ ...save, mode: 'wild' })), null);
  const cleaned = parseMockSave(JSON.stringify({ ...save, choices: { 9: 'k1', x: 'bad', 12: 5 }, queue: 'nope' }));
  assert.deepEqual(cleaned?.choices, { 9: 'k1' });
  assert.deepEqual(cleaned?.queue, []);
});

test('saved picks replay; one that no longer fits is dropped, not the draft', () => {
  const first = replayLive(prepared, 7, 'Brey', {});
  const mine = first.waitingOn!.pick.overall;
  const pickOne = first.run.available()[0].playerKey;
  const good = replaySaved(prepared, 7, 'Brey', { [mine]: pickOne });
  assert.equal(good.dropped, 0);
  assert.ok(good.live.picks.some((pick) => pick.playerKey === pickOne && pick.owner === 'Brey'));

  // Ask for Jokic, whom Joel keeps: that choice cannot stand.
  const jokic = select('Nikola Jokic').playerKey;
  const bad = replaySaved(prepared, 7, 'Brey', { [mine]: jokic });
  assert.equal(bad.dropped, 1);
  assert.deepEqual(bad.choices, {});
  assert.equal(bad.live.waitingOn?.pick.overall, mine);
});

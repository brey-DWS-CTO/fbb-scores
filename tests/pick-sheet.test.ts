import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatasetPlayer } from '../src/lib/keeper/types.js';
import {
  allowedSort,
  filterPool,
  pickNumber,
  sortPool,
  sortsFor,
  type PickNumbers,
} from '../src/lib/league/pickSheet.js';

function player(key: string, fullName: string, proTeam: string, positions: string[]): DatasetPlayer {
  return {
    key,
    espnId: null,
    name: fullName,
    fullName,
    positions,
    proTeam,
    fantasyTeam: null,
    stats2026: null,
    api2026: null,
    prior: null,
    keeper: { eligible: false } as DatasetPlayer['keeper'],
  };
}

const POOL = [
  player('jokic', 'Nikola Jokic', 'den', ['C']),
  player('murray', 'Jamal Murray', 'den', ['PG', 'SG']),
  player('tatum', 'Jayson Tatum', 'bos', ['SF', 'PF']),
  player('brown', 'Jaylen Brown', 'bos', ['SG', 'SF']),
  player('wemby', 'Victor Wembanyama', 'sa', ['PF', 'C']),
];

const keys = (rows: DatasetPlayer[]) => rows.map((row) => row.key);

test('members get name, team and position; the commissioner adds the numbers', () => {
  assert.deepEqual(sortsFor(false), ['name', 'team', 'position']);
  assert.deepEqual(sortsFor(true), ['name', 'team', 'position', 'fppg', 'adp', 'gone']);
  assert.equal(allowedSort('fppg', false), 'name');
  assert.equal(allowedSort('fppg', true), 'fppg');
  assert.equal(allowedSort('team', false), 'team');
});

test('name sorts A to Z on the full name', () => {
  assert.deepEqual(keys(sortPool(POOL, 'name')), ['murray', 'brown', 'tatum', 'jokic', 'wemby']);
});

test('team groups by NBA team, then name', () => {
  assert.deepEqual(keys(sortPool(POOL, 'team')), ['brown', 'tatum', 'murray', 'jokic', 'wemby']);
});

test('position follows PG, SG, SF, PF, C by the first listed position, then name', () => {
  assert.deepEqual(keys(sortPool(POOL, 'position')), ['murray', 'brown', 'tatum', 'wemby', 'jokic']);
});

test('fppg high to low, adp low to high, gone high to low; unknowns last', () => {
  const numbers = new Map<string, PickNumbers>([
    ['jokic', { fppg: 60.2, adp: 1.1, rank: 1, playIn: 2, playoff: 7, gone: 1 }],
    ['wemby', { fppg: 55.0, adp: 2.4, rank: 2, playIn: 3, playoff: 6, gone: 0.8 }],
    ['tatum', { fppg: 44.1, adp: 6.0, rank: 5, playIn: 2, playoff: 7, gone: 0.3 }],
    ['murray', { fppg: null, adp: null, rank: null, playIn: null, playoff: null, gone: null }],
  ]);
  assert.deepEqual(keys(sortPool(POOL, 'fppg', numbers)), ['jokic', 'wemby', 'tatum', 'murray', 'brown']);
  assert.deepEqual(keys(sortPool(POOL, 'adp', numbers)), ['jokic', 'wemby', 'tatum', 'murray', 'brown']);
  assert.deepEqual(keys(sortPool(POOL, 'gone', numbers)), ['jokic', 'wemby', 'tatum', 'murray', 'brown']);
});

test('a commissioner sort with no numbers still gives a stable name order', () => {
  assert.deepEqual(keys(sortPool(POOL, 'fppg')), keys(sortPool(POOL, 'name')));
});

test('sorting never changes the input', () => {
  const before = keys(POOL);
  sortPool(POOL, 'team');
  assert.deepEqual(keys(POOL), before);
});

test('position chip narrows first, then the search matches name, team or position', () => {
  assert.deepEqual(keys(filterPool(POOL, { query: '', position: 'C' })), ['jokic', 'wemby']);
  assert.deepEqual(keys(filterPool(POOL, { query: 'den', position: 'ALL' })), ['jokic', 'murray']);
  assert.deepEqual(keys(filterPool(POOL, { query: 'jay', position: 'SF' })), ['tatum', 'brown']);
  assert.deepEqual(keys(filterPool(POOL, { query: 'pg', position: 'C' })), []);
});

test('numbers print to one place, or a dash', () => {
  assert.equal(pickNumber(44.06), '44.1');
  assert.equal(pickNumber(null), '–');
  assert.equal(pickNumber(undefined), '–');
  assert.equal(pickNumber(3, 0), '3');
});

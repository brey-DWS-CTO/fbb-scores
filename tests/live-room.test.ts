import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardCell, DatasetPlayer } from '../src/lib/keeper/types.js';
import type { PlayerProjection } from '../src/lib/league/projections.js';
import { nextRoomSort, roomRows, takenOnBoard, DEFAULT_ROOM_SORT } from '../src/lib/league/liveRoom.js';

function player(key: string, positions: string[], proTeam = 'den'): DatasetPlayer {
  return { key, espnId: null, name: key, fullName: `${key} Full`, positions, proTeam, fantasyTeam: null, stats2026: null, api2026: null, prior: null, keeper: {} as never };
}

function projection(key: string, valueRank: number, fppg: number | null, adp: number | null = null): PlayerProjection {
  return { key, valueRank, fppg, adp, total: fppg === null ? null : fppg * 70 } as unknown as PlayerProjection;
}

const jokic = player('jokic', ['C']);
const luka = player('luka', ['PG', 'SG'], 'lal');
const sga = player('sga', ['PG'], 'okc');
const rookie = player('rookie', ['SF']);
const everyone = [jokic, luka, sga, rookie];
const projections = new Map([
  ['jokic', projection('jokic', 1, 62, 1.5)],
  ['luka', projection('luka', 2, 58, 2.1)],
  ['sga', projection('sga', 3, 60, 1.2)],
]);

function cell(overall: number, owner: string, extra: Partial<BoardCell> = {}): BoardCell {
  return {
    pick: { round: 1, slot: overall, overall, originalOwner: owner, currentOwner: owner } as BoardCell['pick'],
    selection: null,
    keeper: null,
    onClock: false,
    skipped: false,
    ...extra,
  };
}

const base = { everyone, projections, gone: null, position: 'ALL', search: '', showDrafted: false, sort: DEFAULT_ROOM_SORT };

test('board rank first, players with no numbers last', () => {
  const rows = roomRows({ ...base, available: [rookie, sga, luka, jokic], taken: new Map() });
  assert.deepEqual(rows.map((row) => row.player.key), ['jokic', 'luka', 'sga', 'rookie']);
});

test('sorting by FPPG starts high, a second tap flips it', () => {
  const sort = nextRoomSort(DEFAULT_ROOM_SORT, 'fppg');
  assert.deepEqual(sort, { key: 'fppg', dir: -1 });
  const high = roomRows({ ...base, sort, available: everyone, taken: new Map() });
  assert.deepEqual(high.map((row) => row.player.key), ['jokic', 'sga', 'luka', 'rookie']);
  const low = roomRows({ ...base, sort: nextRoomSort(sort, 'fppg'), available: everyone, taken: new Map() });
  assert.deepEqual(low.map((row) => row.player.key), ['luka', 'sga', 'jokic', 'rookie']);
});

test('gone sorts by the odds, and a player missing from them counts as zero', () => {
  const gone = new Map([['sga', 0.9], ['luka', 0.4]]);
  const rows = roomRows({ ...base, gone, sort: nextRoomSort(DEFAULT_ROOM_SORT, 'gone'), available: [jokic, luka, sga], taken: new Map() });
  assert.deepEqual(rows.map((row) => row.player.key), ['sga', 'luka', 'jokic']);
});

test('position filter and search; search also finds drafted players', () => {
  const board = [cell(1, 'Joel', { selection: { playerKey: 'jokic', playerName: 'jokic' } })];
  const taken = takenOnBoard(board);
  const guards = roomRows({ ...base, position: 'PG', available: [luka, sga, rookie], taken });
  assert.deepEqual(guards.map((row) => row.player.key), ['luka', 'sga']);
  const found = roomRows({ ...base, search: 'jok', available: [luka, sga, rookie], taken });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]?.taken, { label: '1.1', owner: 'Joel', keeper: false });
  const shown = roomRows({ ...base, showDrafted: true, available: [luka, sga, rookie], taken });
  assert.equal(shown.length, 4);
});

test('keepers count as taken', () => {
  const board = [cell(1, 'Kyle', { keeper: { selection: { playerKey: 'luka', playerName: 'luka' } } as BoardCell['keeper'] })];
  assert.deepEqual(takenOnBoard(board).get('luka'), { label: '1.1', owner: 'Kyle', keeper: true });
});

test('members sort by first name, team or position, with no numbers', () => {
  const byName = roomRows({ ...base, sort: { key: 'name', dir: 1 }, available: [player('a', ['C'], 'den'), player('b', ['PG'], 'bos')].map((p, i) => ({ ...p, fullName: i ? 'Jaylen Brown' : 'Aaron Gordon' })), taken: new Map() });
  assert.deepEqual(byName.map((row) => row.player.fullName), ['Aaron Gordon', 'Jaylen Brown']);
  const byTeam = roomRows({ ...base, sort: nextRoomSort({ key: 'name', dir: 1 }, 'team'), available: [jokic, sga, luka], taken: new Map() });
  assert.deepEqual(byTeam.map((row) => row.player.proTeam), ['den', 'lal', 'okc']);
});


test('all players remain browsable beyond 150, with sorting and filtering intact', () => {
  const players = Array.from({ length: 401 }, (_, i) => player(String(i).padStart(3, '0'), ['PG']));
  const rows = roomRows({ ...base, sort: { key: 'name', dir: 1 }, available: players, everyone: players, taken: new Map() });
  assert.equal(rows.length, 401);
  const pages = [rows.slice(0, 150), rows.slice(150, 300), rows.slice(300, 450)];
  assert.deepEqual(pages.flat().map((row) => row.player.key), players.map((entry) => entry.key));
  const found = roomRows({ ...base, search: '400', available: players, everyone: players, taken: new Map() });
  assert.equal(found[0]?.player.key, '400');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import sample from './fixtures/espn-transactions-sample.json' with { type: 'json' };
import {
  movesFor,
  movesOf,
  normalizeTransactions,
  transactionKey,
  type EspnTransactionsResponse,
  type NormalizeContext,
} from '../src/lib/league/transactions.ts';

const ctx: NormalizeContext = {
  season: 2027,
  teams: [
    { owner: 'Kyle', espnTeamId: 3 },
    { owner: 'Joel', espnTeamId: 5 },
    { owner: 'Ryan', espnTeamId: 7 },
    { owner: 'Dustin', espnTeamId: 9 },
  ],
  players: new Map([
    [4001, { name: 'Jalen Green', proTeam: 'PHX' }],
    [4002, { name: 'Talen Horton-Tucker', proTeam: 'CHI' }],
    [4003, { name: 'Bub Carrington', proTeam: 'WAS' }],
    [4004, { name: 'Trae Young', proTeam: 'ATL' }],
    [4005, { name: 'Devin Vassell', proTeam: 'SAS' }],
    [4006, { name: 'Keldon Johnson', proTeam: 'SAS' }],
    [4007, { name: 'Cam Thomas', proTeam: 'BKN' }],
  ]),
};

const raw = sample as EspnTransactionsResponse;

test('only executed moves become rows, one per player', () => {
  const rows = normalizeTransactions(raw, ctx);
  assert.deepEqual(
    rows.map((row) => [row.espnId, row.kind, row.owner, row.playerName]),
    [
      ['aaa-1', 'add', 'Kyle', 'Jalen Green'],
      ['aaa-1', 'drop', 'Kyle', 'Talen Horton-Tucker'],
      ['bbb-2', 'waiver', 'Joel', 'Bub Carrington'],
      ['ddd-4', 'trade', 'Kyle', 'Trae Young'],
      ['ddd-4', 'trade', 'Joel', 'Devin Vassell'],
      ['ddd-4', 'trade', 'Joel', 'Keldon Johnson'],
      ['fff-6', 'add', 'Dustin', 'Player 9999999'],
    ],
  );
});

test('a waiver claim keeps its bid, a free-agent add has none', () => {
  const rows = normalizeTransactions(raw, ctx);
  assert.equal(rows.find((row) => row.kind === 'waiver')?.bid, 12);
  assert.equal(rows.find((row) => row.kind === 'add')?.bid, null);
});

test('a trade row knows where the player went', () => {
  const trade = normalizeTransactions(raw, ctx).filter((row) => row.kind === 'trade');
  assert.deepEqual(trade.map((row) => [row.owner, row.toOwner]), [['Kyle', 'Joel'], ['Joel', 'Kyle'], ['Joel', 'Kyle']]);
});

test('a league manager add is marked', () => {
  const rows = normalizeTransactions(raw, ctx);
  assert.equal(rows.find((row) => row.espnId === 'fff-6')?.byLeagueManager, true);
  assert.equal(rows.find((row) => row.espnId === 'aaa-1')?.byLeagueManager, false);
});

test('dates come from processDate as ISO', () => {
  const rows = normalizeTransactions(raw, ctx);
  assert.equal(rows[0].at, '2025-10-27T21:20:00.000Z');
});

test('a row without a date, an id or a known team is left out', () => {
  const rows = normalizeTransactions(raw, ctx);
  assert.ok(!rows.some((row) => row.espnId === 'ggg-7'), 'no date');
  assert.ok(!rows.some((row) => row.owner === '' || row.teamId === 42), 'unknown team');
});

test('an empty or odd payload is no rows, not a crash', () => {
  assert.deepEqual(normalizeTransactions({}, ctx), []);
  assert.deepEqual(normalizeTransactions({ transactions: [{ id: 'x', status: 'EXECUTED', type: 'FREEAGENT' }] }, ctx), []);
});

test('the store key names the transaction, the player and the kind', () => {
  assert.equal(transactionKey({ espnId: 'aaa-1', playerId: 4001, kind: 'add' }), 'aaa-1:4001:add');
});

test('rows fold into moves, newest first, in words', () => {
  const moves = movesOf(normalizeTransactions(raw, ctx));
  assert.deepEqual(moves.map((move) => move.title), [
    'Dustin added Player 9999999',
    'Kyle and Joel traded',
    'Joel claimed Bub Carrington (WAS) ($12)',
    'Kyle added Jalen Green (PHX), dropped Talen Horton-Tucker (CHI)',
  ]);
  const trade = moves[1];
  assert.deepEqual(trade.lines, ['Kyle gets Devin Vassell (SAS), Keldon Johnson (SAS).', 'Joel gets Trae Young (ATL).']);
  assert.deepEqual(trade.owners, ['Kyle', 'Joel']);
  assert.deepEqual(moves[0].lines, ['LM add']);
});

test('a drop on its own reads as a drop', () => {
  const moves = movesOf([{
    espnId: 'z', season: 2027, kind: 'drop', teamId: 3, owner: 'Kyle', playerId: 1, playerName: 'Cam Thomas', proTeam: 'BKN',
    bid: null, toTeamId: null, toOwner: null, at: '2026-11-01T00:00:00.000Z', scoringPeriodId: 10, byLeagueManager: false,
  }]);
  assert.equal(moves[0].kind, 'drop');
  assert.equal(moves[0].title, 'Kyle dropped Cam Thomas (BKN)');
});

test('a team filter keeps the moves that owner was in, trades included', () => {
  const moves = movesOf(normalizeTransactions(raw, ctx));
  assert.deepEqual(movesFor(moves, 'Joel').map((move) => move.id), ['ddd-4', 'bbb-2']);
  assert.equal(movesFor(moves, null).length, moves.length);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import fixture from './fixtures/espn-draft-rankings-2027-2026-09-25.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import { DEFAULT_ROSTER, valueBoard } from '../src/lib/league/draftValue.ts';
import { autoPick, replayLive } from '../src/lib/league/liveMock.ts';
import { buildMockBoard, defaultMockSettings, prepareMock } from '../src/lib/league/mockDraft.ts';
import { buildProjections } from '../src/lib/league/projections.ts';
import {
  MEMBER_MOCK_LIMIT,
  bestLineup,
  gradeForRank,
  gradeMock,
  mockResultId,
  parseMockResult,
  type GradePlayer,
} from '../src/lib/league/mockGrade.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const values = valueBoard(dataset.players, fixture, { projectionsOnly: true });
const OWNERS = dataset.teams.map((team) => team.owner);
const state: LeagueDynamicState = {
  season: 2027, keepers: {}, keepersRevealed: false,
  draft: { picks: {}, startedAt: null }, locks: { keepersLocked: false },
};
const board = buildMockBoard(dataset, { viewer: 'Brey', state, scenario: {} });
const prepared = prepareMock({ board, values, settings: defaultMockSettings('realistic', OWNERS, 7) });
const players = new Map<string, GradePlayer>(
  buildProjections(values, fixture, { keepers: {}, status: {} }).map((row) => [row.key, { name: row.name, positions: row.positions, total: row.total, adp: row.adp }]),
);

function finishedDraft() {
  const choices: Record<number, string> = {};
  let live = replayLive(prepared, 7, 'Brey', choices);
  while (live.waitingOn) {
    choices[live.waitingOn.pick.overall] = autoPick(live)!.playerKey;
    live = replayLive(prepared, 7, 'Brey', choices);
  }
  return { live, choices };
}

test('grades run A+ for first down to F for last', () => {
  assert.equal(gradeForRank(1, 10), 'A+');
  assert.equal(gradeForRank(5, 10), 'B');
  assert.equal(gradeForRank(10, 10), 'F');
  assert.equal(gradeForRank(1, 1), 'A+');
});

test('the best lineup seats the biggest totals in slots they fit, the rest on the bench', () => {
  const pool = new Map<string, GradePlayer>([
    ['c1', { name: 'C1', positions: ['C'], total: 3000, adp: null }],
    ['c2', { name: 'C2', positions: ['C'], total: 2900, adp: null }],
    ['c3', { name: 'C3', positions: ['C'], total: 2800, adp: null }],
    ['c4', { name: 'C4', positions: ['C'], total: 2700, adp: null }],
    ['c5', { name: 'C5', positions: ['C'], total: 2600, adp: null }],
    ['g1', { name: 'G1', positions: ['PG'], total: 100, adp: null }],
  ]);
  const lineup = bestLineup([...pool.keys()], pool, DEFAULT_ROSTER);
  // One C and three FLEX take centres; the fifth centre sits.
  assert.equal(lineup.seats.find((seat) => seat.playerKey === 'c5')?.slot, 'BE');
  assert.equal(lineup.seats.find((seat) => seat.playerKey === 'g1')?.slot, 'PG');
  assert.equal(lineup.points, 3000 + 2900 + 2800 + 2700 + 100);
  assert.deepEqual(lineup.open, ['SG', 'SF', 'PF', 'G', 'F']);
});

test('a finished mock is ranked against the room and graded', () => {
  const { live } = finishedDraft();
  const grade = gradeMock(live.picks, 'Brey', players, DEFAULT_ROSTER);
  assert.equal(grade.teams, 10);
  assert.ok(grade.rank >= 1 && grade.rank <= 10);
  assert.equal(grade.grade, gradeForRank(grade.rank, 10));
  assert.deepEqual(grade.standings.map((team) => team.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(grade.standings.every((team, index, all) => index === 0 || all[index - 1].points >= team.points));
  assert.equal(grade.roster.length, live.picks.filter((pick) => pick.owner === 'Brey').length);
  assert.equal(grade.roster.filter((pick) => pick.slot !== 'BE').length, 10 - grade.openSlots.length);
  assert.ok(grade.points > grade.average * 0.5);
  if (grade.steal) assert.ok(grade.steal.by > 0);
  if (grade.reach) assert.ok(grade.reach.by > 0);
});

test('a result id is stable for the same draft and checked before saving', () => {
  const { choices } = finishedDraft();
  const id = mockResultId('Brey', 7, 'realistic', choices);
  assert.equal(id, mockResultId('Brey', 7, 'realistic', { ...choices }));
  assert.notEqual(id, mockResultId('Brey', 8, 'realistic', choices));
  const { live } = finishedDraft();
  const grade = gradeMock(live.picks, 'Brey', players, DEFAULT_ROSTER);
  const record = parseMockResult('Brey', { id, seed: 7, mode: 'realistic', grade });
  assert.equal(record.owner, 'Brey');
  assert.throws(() => parseMockResult('Brey', { id: 'nope', seed: 7, mode: 'realistic', grade }), /id/);
  assert.throws(() => parseMockResult('Brey', { id, seed: 7, mode: 'wild', grade }), /room/);
  assert.equal(MEMBER_MOCK_LIMIT, 10);
});

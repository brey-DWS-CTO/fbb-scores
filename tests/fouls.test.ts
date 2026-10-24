import assert from 'node:assert/strict';
import test from 'node:test';
import { courtReads, foulRead, foulsByPeriod, foulTitle, troubleAt } from '../src/lib/league/fouls.js';
import { parseBoxScore, type BoxScore } from '../src/lib/league/partyScore.js';

const play = (kind: string, period: number, athleteId = '1') => ({
  type: { text: kind },
  period: { number: period },
  participants: [{ athlete: { id: athleteId } }],
});

test('the bar rises one foul a quarter and stops at five', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(troubleAt), [2, 3, 4, 5, 5, 5]);
});

test('counts personal fouls by period, not technicals or the offensive-foul turnover', () => {
  const fouls = foulsByPeriod({ plays: [
    play('Shooting Foul', 1),
    play('Offensive Foul', 1),
    play('Offensive Foul Turnover', 1),
    play('Technical Foul', 2),
    play('Personal Foul', 3),
    play('Offensive Charge', 3, '2'),
    play('Flagrant Foul Type 1', 3, '2'),
    play('Jump Shot', 3, '2'),
  ] });
  assert.deepEqual(fouls.get('1'), [2, 0, 1]);
  assert.deepEqual(fouls.get('2'), [0, 0, 2]);
});

test('two in the 1st is trouble', () => {
  assert.deepEqual(foulRead([2], 1), { state: 'trouble', fouls: 2, since: 1 });
});

test('the same two in the 2nd is out of trouble', () => {
  assert.deepEqual(foulRead([2], 2), { state: 'cleared', fouls: 2, since: 1 });
});

test('a third in the 2nd puts him back in', () => {
  assert.deepEqual(foulRead([2, 1], 2), { state: 'trouble', fouls: 3, since: 1 });
});

test('never at the bar is nothing to show', () => {
  assert.equal(foulRead([1, 1, 1], 3), null);
  assert.equal(foulRead([], 4), null);
});

test('four in the 3rd is trouble, the same four in the 4th is not', () => {
  assert.equal(foulRead([1, 1, 2], 3)?.state, 'trouble');
  assert.equal(foulRead([1, 1, 2], 4)?.state, 'cleared');
});

test('five in the 4th or overtime is trouble, six is gone', () => {
  assert.equal(foulRead([1, 1, 1, 2], 4)?.state, 'trouble');
  assert.equal(foulRead([1, 1, 1, 2], 5)?.state, 'trouble');
  assert.equal(foulRead([1, 1, 1, 2, 1], 5)?.state, 'fouled-out');
});

test('the badge title says how many and since when', () => {
  assert.equal(foulTitle({ state: 'trouble', fouls: 3, since: 2 }), 'Foul trouble: 3 fouls, since the 2nd');
  assert.equal(foulTitle({ state: 'trouble', fouls: 5, since: 5 }), 'Foul trouble: 5 fouls, since OT');
});

const summary = (state: string, period: number) => ({
  header: { competitions: [{
    status: { period, type: { state, shortDetail: '5:00 - 2nd' } },
    competitors: [
      { homeAway: 'home', score: '50', team: { abbreviation: 'ORL' } },
      { homeAway: 'away', score: '48', team: { abbreviation: 'MIN' } },
    ],
  }] },
  boxscore: { players: [{
    team: { abbreviation: 'MIN' },
    statistics: [{ keys: ['minutes', 'fouls'], athletes: [
      { active: true, athlete: { id: '1', displayName: 'On Court' }, stats: ['12', '2'] },
      { active: false, athlete: { id: '2', displayName: 'On Bench' }, stats: ['8', '0'] },
    ] }],
  }] },
  plays: [play('Personal Foul', 1), play('Shooting Foul', 1)],
});

test('the box score knows who is on the floor and the period', () => {
  const box = parseBoxScore(summary('in', 2), 'g1')!;
  assert.equal(box.period, 2);
  assert.deepEqual(box.lines.map((line) => line.onCourt), [true, false]);
  assert.deepEqual(box.lines[0].foulsByPeriod, [2]);
  assert.equal(box.lines[1].foulsByPeriod, undefined);
});

test('nobody is on the floor once the game is over', () => {
  const live = courtReads([parseBoxScore(summary('in', 2), 'g1')!]);
  assert.equal(live.get('1')?.onCourt, true);
  assert.equal(live.get('1')?.foul?.state, 'cleared');
  assert.equal(live.get('2')?.onCourt, false);
  const final = courtReads([parseBoxScore(summary('post', 4), 'g1')!]);
  assert.equal(final.get('1')?.onCourt, false);
  assert.equal(final.get('1')?.final, true);
});

test('a final game with no period still reads the whole game', () => {
  const raw = summary('post', 4);
  delete (raw.header.competitions[0].status as { period?: number }).period;
  const box = parseBoxScore(raw, 'g1')!;
  assert.equal(box.period, 0);
  assert.equal(courtReads([box]).get('1')?.foul?.state, 'cleared');
});

test('a game not yet tipped reads as nothing', () => {
  const pre: BoxScore = { gameId: 'g', state: 'pre', detail: '', home: 'A', away: 'B', homeScore: null, awayScore: null, lines: [
    { athleteId: '1', name: 'X', shortName: 'X', team: 'A', played: false, stats: {}, onCourt: true },
  ] };
  assert.equal(courtReads([pre]).size, 0);
});

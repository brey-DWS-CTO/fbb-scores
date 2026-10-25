import assert from 'node:assert/strict';
import test from 'node:test';
import { castMatchesTeams, castPoints, parseCastPlays, reconcileCastPlays, sortCastPlays } from '../src/lib/league/fantasyCast.js';
import { LEAGUE_SCORING, type BoxLine } from '../src/lib/league/partyScore.js';

const players: BoxLine[] = [
  { athleteId: '1', name: 'Test Scorer', shortName: 'T. Scorer', team: 'BOS', played: true, stats: {} },
  { athleteId: '2', name: 'Test Helper', shortName: 'T. Helper', team: 'NY', played: true, stats: {} },
];
const parse = (texts: string[]) => parseCastPlays({ plays: texts.map((text, i) => ({ id: String(i), sequenceNumber: String(i), text, wallclock: `2026-10-22T01:00:${String(i).padStart(2, '0')}Z`, period: { number: 1 }, clock: { displayValue: '4:00' } })) }, 'g1', 'BOS @ NY', players);

test('credits shooter and assist separately using league weights', () => {
  const [play] = parse(['Test Scorer makes 26-foot three point jumper (Test Helper assists)']);
  assert.deepEqual(play.changes.map(change => [change.athleteId, castPoints(change.stats, LEAGUE_SCORING)]), [['1', 4.5], ['2', 1.4]]);
});
test('negative plays, steals, free throws, rebounds and blocks', () => {
  const plays = parse(['Test Scorer misses two point shot', 'Test Scorer misses free throw 1 of 2', 'Test Scorer bad pass turnover (Test Helper steals)', 'Test Scorer makes free throw 2 of 2', 'Test Scorer defensive rebound', 'Test Helper blocks Test Scorer layup']);
  assert.deepEqual(plays.map(play => play.changes.map(change => castPoints(change.stats, LEAGUE_SCORING))), [[-0.7], [-0.5], [-1.8, 2.5], [1], [1], [2.5]]);
});
test('milestone is added only on the crossing play, and non-stat events survive', () => {
  const plays = parse([...Array<string>(5).fill('Test Scorer makes two point shot'), ...Array<string>(11).fill('Test Scorer defensive rebound'), 'End of the 1st Quarter']);
  assert.equal(castPoints(plays[14].changes[0].stats, LEAGUE_SCORING), 2.8);
  assert.equal(castPoints(plays[15].changes[0].stats, LEAGUE_SCORING), 1);
  assert.equal(plays[16].changes.length, 0);
});
test('interleaves games by real timestamp and reverses chronology', () => {
  const plays = parse(['Test Scorer defensive rebound', 'Test Helper defensive rebound']);
  const otherGame = { ...plays[0], id: 'g2:0', gameId: 'g2', timestamp: '2026-10-22T01:00:00.500Z' };
  assert.deepEqual(sortCastPlays([...plays, otherGame], false).map(play => play.id), ['g1:0', 'g2:0', 'g1:1']);
  assert.deepEqual(sortCastPlays([...plays, otherGame], true).map(play => play.id), ['g1:1', 'g2:0', 'g1:0']);
  assert.deepEqual(parseCastPlays({}, 'g1', '', players), []);
});

test('uses numeric shot value when the description omits three-pointer wording', () => {
  const [play] = parseCastPlays({ plays: [{ id: '1', text: 'Test Scorer makes 25-foot running jump shot', scoreValue: 3, pointsAttempted: 3 }] }, 'g', '', players);
  assert.equal(castPoints(play.changes[0].stats, LEAGUE_SCORING), 4.5);
});

test('a blocked shot credits the block and charges the shooter a miss', () => {
  const [play] = parse(["Test Helper blocks Test Scorer 's 8-foot running layup"]);
  assert.deepEqual(play.changes.map(change => [change.athleteId, castPoints(change.stats, LEAGUE_SCORING)]), [['1', -0.7], ['2', 2.5]]);
});

test('official final corrections reconcile changes absent from the play descriptions', () => {
  const plays = parse(['Test Scorer defensive rebound']);
  const reconciled = reconcileCastPlays(plays, [{ ...players[0], stats: { '6': 2 } }]);
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[1].changes[0].stat, 'Official stat correction');
  assert.equal(castPoints(reconciled[1].changes[0].stats, LEAGUE_SCORING), 1);
  assert.equal(sortCastPlays(reconciled, true)[0].id, 'g1:corrections');
});

test('team and matchup filters count active scoring players, excluding bench and free agents', () => {
  const [play] = parse(['Test Scorer makes two point shot (Test Helper assists)']);
  const rosters = new Map([['1', { team: { teamId: 10 }, started: false }], ['2', { team: { teamId: 20 }, started: true }]]);
  assert.equal(castMatchesTeams(play, [10], rosters, LEAGUE_SCORING), false);
  assert.equal(castMatchesTeams(play, [20], rosters, LEAGUE_SCORING), true);
  assert.equal(castMatchesTeams(play, [10, 20], rosters, LEAGUE_SCORING), true);
  assert.equal(castMatchesTeams(play, [30], rosters, LEAGUE_SCORING), false);
  assert.equal(castMatchesTeams(play, [20], new Map(), LEAGUE_SCORING), false);
});

test('a single team counts its bench too', () => {
  const [play] = parse(['Test Scorer makes two point shot (Test Helper assists)']);
  const rosters = new Map([['1', { team: { teamId: 10 }, started: false }]]);
  assert.equal(castMatchesTeams(play, [10], rosters, LEAGUE_SCORING, false), true);
  assert.equal(castMatchesTeams(play, [30], rosters, LEAGUE_SCORING, false), false);
});

test('a missed end-of-quarter heave costs the shooter nothing', () => {
  const heave = (text: string, period: number, clock: string) => parseCastPlays({ plays: [{ id: '1', text, period: { number: period }, clock: { displayValue: clock } }] }, 'g1', 'BOS @ NY', players)[0];
  assert.equal(heave('Test Scorer misses 61-foot three point shot', 2, '0.8').changes.length, 0);
  assert.equal(heave('Test Scorer misses 40-foot three point jumper', 3, '0:02').changes.length, 0);
  // Still a real miss: the 4th quarter, too short, or too early.
  assert.equal(heave('Test Scorer misses 61-foot three point shot', 4, '0.8').changes.length, 1);
  assert.equal(heave('Test Scorer misses 28-foot three point jumper', 2, '0.8').changes.length, 1);
  assert.equal(heave('Test Scorer misses 61-foot three point shot', 2, '5.2').changes.length, 1);
  // A made heave still counts.
  assert.equal(castPoints(heave('Test Scorer makes 61-foot three point shot', 2, '0.8').changes[0].stats, LEAGUE_SCORING), 4.5);
});

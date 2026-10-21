import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeLine,
  espnIdOf,
  findLine,
  LEAGUE_SCORING,
  lineStats,
  nameKey,
  parseBoxScore,
  partyScores,
  partyStarted,
  scoreLine,
  statLine,
  type BoxLine,
  type BoxScore,
} from '../src/lib/league/partyScore.js';
import type { HouseParty, RostersByOwner } from '../src/lib/league/houseParty.js';

/** ESPN's box score columns, in the order the summary sends them. */
const KEYS = [
  'minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted',
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted',
  'rebounds', 'assists', 'turnovers', 'steals', 'blocks', 'offensiveRebounds', 'defensiveRebounds',
  'fouls', 'plusMinus',
];

/** One athlete row the way the summary shapes it. */
function athlete(id: number, name: string, shortName: string, stats: string[], didNotPlay = false) {
  return { athlete: { id: String(id), displayName: name, shortName }, stats, didNotPlay, starter: true };
}

/** A whole summary: the header with state and score, and a box score per team. */
function summary(state: 'pre' | 'in' | 'post', detail: string, teams: Array<{ code: string; score: string; homeAway: 'home' | 'away'; athletes: unknown[] }>) {
  return {
    header: {
      competitions: [{
        status: { type: { state, shortDetail: detail, detail } },
        competitors: teams.map((team) => ({ homeAway: team.homeAway, score: team.score, team: { abbreviation: team.code } })),
      }],
    },
    boxscore: {
      players: teams.map((team) => ({
        team: { abbreviation: team.code },
        statistics: [{ keys: KEYS, athletes: team.athletes }],
      })),
    },
  };
}

const JOKIC = athlete(3112335, 'Nikola Jokić', 'N. Jokić', ['36', '27', '11-18', '1-3', '4-6', '14', '10', '3', '1', '1', '3', '11', '2', '+15']);
const LEBRON = athlete(1966, 'LeBron James', 'L. James', ['34', '24', '9-20', '2-7', '4-4', '8', '9', '4', '1', '0', '1', '7', '1', '-12']);
const BENCH = athlete(4433137, 'Ziaire Williams', 'Z. Williams', ['0', '0', '0-0', '0-0', '0-0', '0', '0', '0', '0', '0', '0', '0', '0', '0'], true);

const FINAL = summary('post', 'Final', [
  { code: 'DEN', score: '121', homeAway: 'away', athletes: [JOKIC] },
  { code: 'LAL', score: '106', homeAway: 'home', athletes: [LEBRON, BENCH] },
]);

// ─── Parsing ─────────────────────────────────────────────────────────────────

test('a box score line lands on ESPN stat ids, pairs split, misses filled in', () => {
  const stats = lineStats(KEYS, JOKIC.stats);
  assert.equal(stats['0'], 27, 'points');
  assert.equal(stats['40'], 36, 'minutes');
  assert.equal(stats['13'], 11, 'field goals made');
  assert.equal(stats['14'], 18, 'field goals tried');
  assert.equal(stats['23'], 7, 'field goals missed');
  assert.equal(stats['15'], 4, 'free throws made');
  assert.equal(stats['24'], 2, 'free throws missed');
  assert.equal(stats['17'], 1, 'threes');
  assert.equal(stats['6'], 14, 'rebounds');
  assert.equal(stats['3'], 10, 'assists');
  assert.equal(stats['11'], 3, 'turnovers');
  assert.equal(stats['2'], 1, 'steals');
  assert.equal(stats['1'], 1, 'blocks');
});

test('double-doubles are counted, and a triple-double is also a double-double', () => {
  const triple = completeLine({ '0': 27, '6': 14, '3': 10 });
  assert.equal(triple['37'], 1);
  assert.equal(triple['38'], 1);
  assert.equal(triple['39'], 0);
  const single = completeLine({ '0': 30, '6': 9, '3': 9 });
  assert.equal(single['37'], 0);
  assert.equal(single['38'], 0);
  const quad = completeLine({ '0': 10, '6': 10, '3': 10, '2': 10 });
  assert.equal(quad['39'], 1);
});

test('the summary parses into one plain box score with the game state and both teams', () => {
  const box = parseBoxScore(FINAL, '401898719');
  assert.ok(box);
  assert.equal(box.gameId, '401898719');
  assert.equal(box.state, 'post');
  assert.equal(box.detail, 'Final');
  assert.equal(box.home, 'LAL');
  assert.equal(box.away, 'DEN');
  assert.equal(box.homeScore, 106);
  assert.equal(box.awayScore, 121);
  assert.equal(box.lines.length, 3);
  const jokic = box.lines.find((line) => line.athleteId === '3112335');
  assert.ok(jokic);
  assert.equal(jokic.team, 'DEN');
  assert.equal(jokic.played, true);
  const bench = box.lines.find((line) => line.athleteId === '4433137');
  assert.ok(bench);
  assert.equal(bench.played, false, 'a coach\'s decision never played');
});

test('a game before tip-off parses with no lines; junk parses to null', () => {
  const pre = parseBoxScore({
    header: { competitions: [{ status: { type: { state: 'pre', shortDetail: '7:30 PM PDT' } }, competitors: [{ homeAway: 'home', team: { abbreviation: 'GS' } }, { homeAway: 'away', team: { abbreviation: 'LAL' } }] }] },
    boxscore: { players: [] },
  }, 'g1');
  assert.ok(pre);
  assert.equal(pre.state, 'pre');
  assert.equal(pre.home, 'GSW', 'codes are normalized');
  assert.deepEqual(pre.lines, []);
  assert.equal(parseBoxScore(null, 'g1'), null);
  assert.equal(parseBoxScore({ error: 'nope' }, 'g1'), null);
  assert.equal(parseBoxScore('text', 'g1'), null);
});

test('a line shorter than its keys, or with odd values, does not throw', () => {
  const stats = lineStats(KEYS, ['12', '--', 'x-y']);
  assert.equal(stats['40'], 12);
  assert.equal(stats['0'], 0);
  assert.equal(stats['13'], 0);
  assert.equal(stats['6'], undefined, 'nothing past the end');
});

// ─── Scoring ─────────────────────────────────────────────────────────────────

test('a line scores in the league\'s points', () => {
  // Jokic: 27 + 14 + 10*1.4 + 2.5 + 2.5 + 11 - 7*0.7 - 2*0.5 + 0.5 - 3*1.8 + 1.8 + 6.2 = 68.2
  const line: Pick<BoxLine, 'stats'> = { stats: lineStats(KEYS, JOKIC.stats) };
  assert.equal(scoreLine(line, LEAGUE_SCORING), 68.2);
  // A different scoring changes the answer, so the snapshot's items are what count.
  assert.equal(scoreLine(line, [{ statId: 0, points: 2 }]), 54);
});

test('the stat line reads as words and skips zeros', () => {
  assert.equal(statLine(lineStats(KEYS, JOKIC.stats)), '27 pts, 14 reb, 10 ast, 1 stl, 1 blk, 1 3pm, 3 to, triple-double');
  assert.equal(statLine(lineStats(KEYS, BENCH.stats)), '');
});

// ─── Matching ────────────────────────────────────────────────────────────────

const box = parseBoxScore(FINAL, 'g1') as BoxScore;

test('a roster player finds his line by ESPN id, from the field or the key', () => {
  assert.equal(espnIdOf({ key: 'p3112335', espnId: null }), '3112335');
  assert.equal(espnIdOf({ key: 'p3112335', espnId: 99 }), '99', 'the field wins');
  assert.equal(espnIdOf({ key: 'hand-entered', espnId: null }), null);
  const byField = findLine({ key: 'x', name: 'Someone Else', proTeam: 'DEN', espnId: 3112335 }, box.lines);
  assert.equal(byField?.name, 'Nikola Jokić');
  const byKey = findLine({ key: 'p1966', name: 'Someone Else', proTeam: 'LAL' }, box.lines);
  assert.equal(byKey?.name, 'LeBron James');
});

test('with no id, the name matches loosely, on the same team only', () => {
  assert.equal(nameKey('Nikola Jokić Jr.'), 'nikola jokic');
  const full = findLine({ key: 'a', name: 'nikola jokic', proTeam: 'Den' }, box.lines);
  assert.equal(full?.athleteId, '3112335');
  const short = findLine({ key: 'b', name: 'N. Jokic', proTeam: 'DEN' }, box.lines);
  assert.equal(short?.athleteId, '3112335');
  const wrongTeam = findLine({ key: 'c', name: 'N. Jokic', proTeam: 'LAL' }, box.lines);
  assert.equal(wrongTeam, null, 'a name never crosses teams');
  const unknown = findLine({ key: 'd', name: 'Nobody Here', proTeam: 'DEN' }, box.lines);
  assert.equal(unknown, null);
});

// ─── The party ───────────────────────────────────────────────────────────────

const rosters: RostersByOwner = {
  Joel: [{ key: 'p3112335', name: 'Nikola Jokic', proTeam: 'DEN' }, { key: 'p9', name: 'Stephen Curry', proTeam: 'GSW' }],
  Kyle: [{ key: 'p1966', name: 'LeBron James', proTeam: 'LAL' }, { key: 'p4433137', name: 'Ziaire Williams', proTeam: 'LAL' }],
  Amy: [{ key: 'p5', name: 'Luka Doncic', proTeam: 'DAL' }],
};

const party: Pick<HouseParty, 'games' | 'rsvps'> = {
  games: [
    { id: 'g1', tipoff: '2026-10-20T02:30:00.000Z', home: 'LAL', away: 'DEN', tv: 'TNT' },
    { id: 'g2', tipoff: '2026-10-20T03:00:00.000Z', home: 'GSW', away: 'SAC', tv: null },
  ],
  rsvps: [
    { owner: 'Joel', answer: 'in', at: '' },
    { owner: 'Kyle', answer: 'in', at: '' },
    { owner: 'Amy', answer: 'in', at: '' },
    { owner: 'Brey', answer: 'out', at: '' },
  ],
};

test('every guest who is in gets a total and a line per player, most points first', () => {
  const scores = partyScores(party, rosters, [box], LEAGUE_SCORING);
  assert.deepEqual(scores.map((guest) => guest.owner), ['Joel', 'Kyle', 'Amy'], 'outs are not scored');
  const joel = scores[0];
  assert.equal(joel.total, 68.2);
  assert.equal(joel.players.length, 2, 'Curry is in the second game');
  assert.equal(joel.players[0].name, 'Nikola Jokic');
  assert.equal(joel.players[0].fpts, 68.2);
  assert.equal(joel.players[1].name, 'Stephen Curry');
  assert.equal(joel.players[1].fpts, null, 'no box score for that game yet');
  assert.equal(joel.players[1].gameId, 'g2');
  const kyle = scores[1];
  assert.equal(kyle.players.find((player) => player.key === 'p4433137')?.played, false);
  assert.equal(kyle.players.find((player) => player.key === 'p4433137')?.fpts, 0);
  assert.equal(scores[2].owner, 'Amy');
  assert.deepEqual(scores[2].players, [], 'no players in these games');
  assert.equal(scores[2].total, 0);
});

test('a game before tip-off scores nobody, even with lines', () => {
  const pre: BoxScore = { ...box, state: 'pre' };
  const scores = partyScores(party, rosters, [pre], LEAGUE_SCORING);
  assert.equal(scores.find((guest) => guest.owner === 'Joel')?.players[0].fpts, null);
});

test('a party has started once any game has tipped off', () => {
  assert.equal(partyStarted(party, new Date('2026-10-20T02:29:00.000Z')), false);
  assert.equal(partyStarted(party, new Date('2026-10-20T02:30:00.000Z')), true);
  assert.equal(partyStarted({ games: [] }, new Date()), false);
});


test('ESPN MM:SS minutes distinguish a short appearance from a DNP', () => {
  const raw = summary('in', '1st 11:30', [
    { code: 'DEN', score: '2', homeAway: 'away', athletes: [
      athlete(1, 'Short Appearance', 'S. Appearance', ['0:30', '2']),
      athlete(2, 'No Appearance', 'N. Appearance', ['0:00', '0'], true),
    ] },
    { code: 'LAL', score: '0', homeAway: 'home', athletes: [] },
  ]);
  const parsed = parseBoxScore(raw, 'g');
  assert.ok(parsed);
  assert.equal(parsed.lines[0].stats['40'], 0.5);
  assert.equal(parsed.lines[0].played, true);
  assert.equal(parsed.lines[1].played, false);
});

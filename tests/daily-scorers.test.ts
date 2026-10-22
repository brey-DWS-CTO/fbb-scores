import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyScorers, filterScorers, nbaGameHref, scorerRosters, performerDates, topPerformers, type DailyNbaScores } from '../src/lib/league/dailyScorers.js';
import { demoWeek } from '../src/lib/league/scoresDemo.js';
import { LEAGUE_SCORING, completeLine, type BoxLine, type BoxScore } from '../src/lib/league/partyScore.js';
import { getDailyNbaScores, validScoreDate } from '../server/lib/dailyScorersService.js';
import { pinBoxScores, forgetBoxScores } from '../server/lib/boxScoreService.js';

const line = (id: string, team: string, stats: Record<string, number>, played = true): BoxLine => ({
  athleteId: id, name: `Player ${id}`, shortName: `P. ${id}`, team, played, stats: completeLine(stats),
});
const box = (lines: BoxLine[], gameId = '100'): BoxScore => ({ gameId, state: 'in', detail: '2nd 4:12', home: 'LAL', away: 'DEN', homeScore: 45, awayScore: 48, lines });

test('Top Performers defaults to today; weekly dates stop at today and follow fantasy weeks', () => {
  assert.deepEqual(performerDates('2026-11-05', false), ['2026-11-05']);
  const week = demoWeek();
  assert.deepEqual(performerDates('2026-11-05', true, week), week.days.filter(day => day.date <= '2026-11-05').map(day => day.date));
  assert.deepEqual(performerDates('2026-10-21', true), ['2026-10-19', '2026-10-20', '2026-10-21']);
  assert.deepEqual(performerDates('2026-10-19', true), ['2026-10-19']);
});

test('weekly totals sum per-game bonuses and retain the latest game for each player', () => {
  const day = (date: string, gameId: string, stats: Record<string, number>): DailyNbaScores => ({ date, fetchedAt: '', games: [], error: null, boxScores: [box([line('1', 'DEN', stats)], gameId)] });
  const first = day('2026-10-19', '100', { '0': 12, '6': 10, '3': 2 });
  const last = day('2026-10-21', '101', { '0': 14, '6': 11, '3': 3 });
  const rows = topPerformers([last, first, first], LEAGUE_SCORING, new Map([['1', { teamId: 7, name: 'A' }]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fpts, 57.6);
  assert.equal(rows[0].gamesPlayed, 2);
  assert.equal(rows[0].stats['0'], 26);
  assert.equal(rows[0].stats['37'], 2);
  assert.equal(rows[0].gameId, '101');
  assert.equal(rows[0].date, '2026-10-21');
  assert.equal(filterScorers(rows, 'rostered', '7')[0].gamesPlayed, 2);
});

test('daily leaders include free agents, exclude DNPs, deduplicate lines, and use league scoring', () => {
  const a = line('1', 'DEN', { '0': 20, '6': 10, '3': 10 });
  const b = line('2', 'LAL', { '0': 32 });
  const rows = dailyScorers([box([a, b, a, line('3', 'DEN', { '0': 0 }, false)])], LEAGUE_SCORING, new Map([['1', { teamId: 7, name: 'Nerds' }]]));
  assert.deepEqual(rows.map(row => row.athleteId), ['1', '2']);
  assert.equal(rows[0].fpts, 52); // 20 + 10 + 14 + DD 1.8 + TD 6.2
  assert.equal(rows[1].roster, null);
  assert.equal(rows[0].gameId, '100');
  assert.equal(dailyScorers([box([b])], [{ statId: 0, points: 2 }], null)[0].fpts, 64);
});

test('roster and fantasy-team filters combine without altering the full game list', () => {
  const rows = dailyScorers([box([line('1', 'DEN', { '0': 10 }), line('2', 'LAL', { '0': 15 }), line('3', 'DEN', { '0': 8 })])], LEAGUE_SCORING,
    new Map([['1', { teamId: 7, name: 'A' }], ['2', { teamId: 8, name: 'B' }]]));
  assert.deepEqual(filterScorers(rows, 'free', 'all').map(row => row.athleteId), ['3']);
  assert.equal(filterScorers(rows, 'rostered', 'all').length, 2);
  assert.deepEqual(filterScorers(rows, 'all', '7').map(row => row.athleteId), ['1']);
  assert.equal(filterScorers(rows, 'free', '7').length, 0);
  assert.equal(rows.length, 3);
});

test('current rosters use the requested day and include bench and injured slots', () => {
  const week = demoWeek();
  const first = week.days[0];
  const last = week.days.at(-1)!;
  const side = week.matchups[0].home;
  const player = side.players[0];
  player.days = { [String(first.scoringPeriodId)]: { ...player.days[String(first.scoringPeriodId)], lineupSlotId: 12 } };
  assert.equal(scorerRosters(week, first.date)?.get(String(player.id))?.teamId, side.teamId);
  assert.equal(scorerRosters(week, last.date)?.has(String(player.id)), false);
  assert.equal(scorerRosters(week, '2000-01-01'), null);
});

test('links keep game, date, and selected athlete; invalid dates are rejected', () => {
  const url = new URL(nbaGameHref('2026-10-21', { gameId: '100', player: '2' }), 'http://localhost');
  assert.equal(url.pathname, '/scores/nba/100');
  assert.equal(url.searchParams.get('date'), '2026-10-21');
  assert.equal(url.searchParams.get('player'), '2');
  assert.equal(validScoreDate('2026-02-30'), false);
  assert.equal(validScoreDate('2026-2-01'), false);
  assert.equal(validScoreDate('2026-10-21'), true);
});

test('daily service coalesces reads, fetches only started games, and reports missing stats', async () => {
  const originalFetch = globalThis.fetch;
  let reads = 0;
  const event = (id: string, state: string) => ({ id, date: '2026-10-21T23:00:00Z', competitions: [{
    competitors: [{ homeAway: 'home', team: { abbreviation: 'LAL' } }, { homeAway: 'away', team: { abbreviation: 'DEN' } }],
    status: { type: { state } },
  }] });
  pinBoxScores([box([line('1', 'DEN', { '0': 10 })])]);
  globalThis.fetch = async () => { reads++; return new Response(JSON.stringify({ events: [event('100', 'in'), event('101', 'pre'), event('102', 'post')] }), { status: 200 }); };
  try {
    const [a, b] = await Promise.all([getDailyNbaScores('2026-10-21'), getDailyNbaScores('2026-10-21')]);
    assert.equal(reads, 1);
    assert.deepEqual(a, b);
    assert.equal(a.games.length, 3);
    assert.deepEqual(a.boxScores.map(entry => entry.gameId), ['100']);
    assert.match(a.error ?? '', /incomplete/);
    assert.equal(a.date, '2026-10-21');
  } finally { globalThis.fetch = originalFetch; forgetBoxScores(); }
});

test('failed scoreboard reads are retried rather than cached as empty days', async () => {
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => { reads++; return reads === 1 ? new Response('', { status: 503 }) : new Response('{"events":[]}', { status: 200 }); };
  try {
    await assert.rejects(getDailyNbaScores('2026-10-22'), /503/);
    const data = await getDailyNbaScores('2026-10-22');
    assert.equal(reads, 2);
    assert.deepEqual(data.games, []);
    assert.equal(data.error, null);
  } finally { globalThis.fetch = originalFetch; }
});

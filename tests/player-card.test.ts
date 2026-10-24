import assert from 'node:assert/strict';
import test from 'node:test';
import { cardGame, playerNewsUrl, readPlayerNews } from '../src/lib/league/playerCard.js';
import { demoWeek } from '../src/lib/league/scoresDemo.js';
import type { GameLine, GameStatus, ScorePlayer } from '../src/lib/league/scores.js';

const week = demoWeek();
const [first, second, third] = week.days;
const game = (status: GameStatus): GameLine => ({ status, opponent: 'BOS', home: true, teamScore: null, oppScore: null, clock: null, tipoff: null, minutesLeft: null });
const base = week.matchups[0].home.players[0];
const withGames = (games: Record<number, GameStatus | null>): ScorePlayer => ({
  ...base,
  proTeam: 'DEN',
  days: Object.fromEntries(Object.entries(games).map(([period, status]) => [period, {
    lineupSlotId: 0, started: true, points: 0, stats: null, played: false, game: status ? game(status) : null,
  }])),
});

test('a day card opens that day\'s game, or nothing on an off day', () => {
  const player = withGames({ [first.scoringPeriodId]: 'final', [second.scoringPeriodId]: null });
  assert.deepEqual(cardGame(player, week, first.scoringPeriodId), { date: first.date, team: 'DEN' });
  assert.equal(cardGame(player, week, second.scoringPeriodId), null);
});

test('a week card opens the game he is playing or last played, else his next one', () => {
  const played = withGames({ [first.scoringPeriodId]: 'final', [second.scoringPeriodId]: 'live', [third.scoringPeriodId]: 'upcoming' });
  assert.equal(cardGame(played, week)?.date, second.date);
  const notYet = withGames({ [first.scoringPeriodId]: 'off', [second.scoringPeriodId]: 'upcoming', [third.scoringPeriodId]: 'upcoming' });
  assert.equal(cardGame(notYet, week)?.date, second.date);
  assert.equal(cardGame(withGames({}), week), null);
});

test('player news keeps RotoWire notes, newest first, five at most', () => {
  const note = (id: number, published: string, story?: string) => ({ id, type: 'Rotowire', headline: ` Note ${id} `, story, published });
  const body = { feed: [
    note(1, '2026-10-20T00:00:00Z', 'Take one'),
    { id: 2, type: 'Media', headline: 'Highlights', published: '2026-10-24T00:00:00Z' },
    note(3, '2026-10-23T00:00:00Z', '  '),
    note(4, '2026-10-01T00:00:00Z'),
    note(5, '2026-10-02T00:00:00Z'),
    note(6, '2026-10-03T00:00:00Z'),
    note(7, '2026-10-04T00:00:00Z'),
    { id: 8, type: 'Rotowire', headline: '', published: '2026-10-24T00:00:00Z' },
  ] };
  const news = readPlayerNews(body);
  assert.deepEqual(news.map(item => item.id), [3, 1, 7, 6, 5]);
  assert.equal(news[0].headline, 'Note 3');
  assert.equal(news[0].story, null);
  assert.equal(news[1].story, 'Take one');
  assert.deepEqual(readPlayerNews(null), []);
  assert.deepEqual(readPlayerNews({ feed: 'nope' }), []);
  assert.match(playerNewsUrl(3112335), /playerId=3112335/);
});

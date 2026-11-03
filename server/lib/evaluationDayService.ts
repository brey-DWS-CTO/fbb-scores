import { parseScoreboard, type NbaGame } from '../../src/lib/league/houseParty.js';
import { EVALUATION_MAX_RESULT_GAMES } from '../../src/lib/league/projectionComputePolicy.js';
import { getBoxScores } from './boxScoreService.js';
import { validScoreDate } from './dailyScorersService.js';
import type { DailyNbaScores } from '../../src/lib/league/dailyScorers.js';
async function readBoard(date: string): Promise<NbaGame[]> {
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.replace(/-/g, '')}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Scoreboard unavailable');
  return parseScoreboard(await response.json());
}
/** One scoreboard and at most 15 final summaries, never a live-game polling loop. */
export async function readEvaluationDay(date: string, board = readBoard, boxes = getBoxScores): Promise<DailyNbaScores> {
  if (!validScoreDate(date)) throw new Error('Invalid result date');
  const games = await board(date);
  const ids = [...new Set(games.filter(game => game.state === 'post').map(game => game.id))].slice(0, EVALUATION_MAX_RESULT_GAMES);
  const result = await boxes(ids);
  return { date, games, boxScores: result.boxScores, error: result.error, fetchedAt: new Date().toISOString() };
}

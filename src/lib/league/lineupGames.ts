import { lineupGamesLeft, gamesPlayed, type ScoreSide, type ScoresWeek } from './scores.js';

export interface LineupGames {
  played: number;
  remaining: number;
  projected: number;
  cap: number | null;
  difference: number | null;
  estimated: boolean;
}

/** Count lineup games before any overage deductions. */
export function lineupGames(side: ScoreSide, week: ScoresWeek): LineupGames {
  const played = gamesPlayed(side, week);
  const rosterDays = new Set(side.players.flatMap((player) => Object.keys(player.days)));
  const remaining = lineupGamesLeft(side, week).filter(({ game }) => !game.live)
    .reduce((sum, { game }) => sum + game.share, 0);
  const projected = Math.round((played + remaining) * 10) / 10;
  return {
    played, remaining: Math.round(remaining * 10) / 10, projected, cap: week.gamesCap,
    difference: week.gamesCap === null ? null : Math.round((projected - week.gamesCap) * 10) / 10,
    estimated: week.days.some((day) => day.scoringPeriodId >= week.currentScoringPeriodId
      && (day.games === null || !rosterDays.has(String(day.scoringPeriodId)))),
  };
}

export function gamesCapStatus(games: LineupGames): string {
  if (games.difference === null) return 'Cap unavailable';
  if (games.difference === 0) return 'At cap';
  return `${Math.abs(games.difference)} ${games.difference > 0 ? 'over' : 'under'} cap`;
}

/** Pacific clock, including daylight saving time. No late catch-up after tip-off. */
export function gamesWarningDate(now: Date): string | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  if (!['Fri', 'Sun'].includes(part('weekday') ?? '') || part('hour') !== '07') return null;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function gamesWarningKey(season: number, week: number, date: string, teamId: number): string {
  return `lineup-games:${season}:${week}:${date}:${teamId}`;
}

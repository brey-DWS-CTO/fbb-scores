import type { ExpectedPoints, ScoresWeek, ScorePlayer } from './scores.js';
import type { PlannedStart } from './weeklyLineup.js';

/** A player's games in chronological order, without off-day placeholders. */
export function weeklyPlayerGames(player: ScorePlayer, week: ScoresWeek, expected: ExpectedPoints, starts: readonly PlannedStart[], now = Date.now()) {
  const recommended = new Map(starts.filter(s => s.playerId === player.id).map(s => [s.period, s.slot]));
  return [...week.days].sort((a, b) => a.date.localeCompare(b.date) || a.scoringPeriodId - b.scoringPeriodId).flatMap(day => {
    const game = day.games?.[player.proTeam];
    if (!game || game.status === 'off') return [];
    const value = expected(player, day.scoringPeriodId);
    const record = player.days[String(day.scoringPeriodId)];
    const locked = game.status !== 'upcoming' || (game.tipoff !== null && Date.parse(game.tipoff) <= now);
    return [{ period: day.scoringPeriodId, date: day.date, opponent: game.opponent, home: game.home,
      projected: Number.isFinite(value) ? Math.max(0, value) : null,
      status: game.status, actual: record?.played ? record.points : null, played: record?.played ?? null,
      locked, started: record?.started === true, recommended: !locked && recommended.has(day.scoringPeriodId),
      slot: recommended.get(day.scoringPeriodId) ?? null }];
  });
}
export type WeeklyPlayerGame = ReturnType<typeof weeklyPlayerGames>[number];

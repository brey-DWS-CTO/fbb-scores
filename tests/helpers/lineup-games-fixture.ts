import type { GameLine, ScorePlayer, ScoreSide, ScoresWeek } from '../../src/lib/league/scores.js';

export function warningWeek(): ScoresWeek {
  const game = (status: GameLine['status']): GameLine => ({
    status, opponent: 'LAL', home: true, teamScore: null, oppScore: null,
    clock: null, tipoff: null, minutesLeft: status === 'live' ? 24 : null,
  });
  const days = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map((date, i) => ({
    scoringPeriodId: 17 + i, date, games: { DEN: game(i === 0 ? 'final' : 'upcoming') },
  }));
  const player = (id: number, started = true, injuryStatus: string | null = null): ScorePlayer => ({
    id, name: `Player ${id}`, position: 'C', proTeamId: 7, proTeam: 'DEN', injuryStatus,
    seasonAvg: 30, last7: null, last15: null, last30: null, projByDay: {},
    days: Object.fromEntries(days.map((day, i) => [String(day.scoringPeriodId), {
      lineupSlotId: started ? 0 : 12, started, points: i === 0 ? 30 : 0,
      stats: null, played: i === 0, game: day.games.DEN,
    }])),
  });
  const side = (teamId: number, players: ScorePlayer[]): ScoreSide => ({
    teamId, name: `Team ${teamId}`, abbrev: `T${teamId}`, total: 0, pointsByDay: {},
    record: { wins: 0, losses: 0, ties: 0 }, players,
  });
  return {
    season: 2027, matchupPeriodId: 500, currentMatchupPeriodId: 500, currentScoringPeriodId: 18,
    days, weeks: [], gamesCap: 6, anchor: { scoringPeriodId: 18, date: '2026-11-06', source: 'scoring-period' },
    fetchedAt: '2026-11-06T15:00:00Z',
    matchups: [{ id: 900, winner: 'UNDECIDED', home: side(7, [player(1), player(2), player(3, false), player(4, true, 'OUT')]), away: side(2, [player(5)]) }],
  };
}

import { useQuery } from '@tanstack/react-query';
import { fetchDailyScorers } from '../lib/league/api.js';
import { dailyScorers, scorerRosters } from '../lib/league/dailyScorers.js';
import { LEAGUE_SCORING } from '../lib/league/partyScore.js';
import { localDateIso } from '../lib/league/scores.js';
import { useScoresWeek } from './useScores.js';

export function useDailyScorers(date: string) {
  const query = useQuery({
    queryKey: ['daily-scorers', date],
    queryFn: () => fetchDailyScorers(date),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  // This is always the current roster, even when the fantasy week picker shows history.
  const rosterQuery = useScoresWeek(null, false);
  const week = rosterQuery.data;
  const rosters = week ? scorerRosters(week, localDateIso(new Date())) : null;
  const scoring = week?.scoringItems?.length ? week.scoringItems : LEAGUE_SCORING;
  const rows = dailyScorers(query.data?.boxScores ?? [], scoring, rosters);
  const teams = week?.matchups.flatMap(matchup => [matchup.home, matchup.away]) ?? [];
  return { query, rows, rosters, teams, rosterQuery, scoring };
}

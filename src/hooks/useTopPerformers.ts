import { useQueries } from '@tanstack/react-query';
import { fetchDailyScorers } from '../lib/league/api.js';
import { performerDates, scorerRosters, topPerformers, type DailyNbaScores } from '../lib/league/dailyScorers.js';
import { LEAGUE_SCORING } from '../lib/league/partyScore.js';
import { localDateIso } from '../lib/league/scores.js';
import { useScoresWeek } from './useScores.js';

export function useTopPerformers(weekly: boolean) {
  const today = localDateIso(new Date());
  const rosterQuery = useScoresWeek(null, false);
  const week = rosterQuery.data;
  const dates = performerDates(today, weekly, week);
  const queries = useQueries({ queries: dates.map(date => ({
    queryKey: ['daily-scorers', date],
    queryFn: () => fetchDailyScorers(date),
    staleTime: date === today ? 30_000 : 5 * 60_000,
    refetchInterval: date === today ? 60_000 : false as const,
    retry: 1,
  })) });
  const days = queries.flatMap(query => query.data ? [query.data] : []);
  const rosters = week ? scorerRosters(week, today) : null;
  const scoring = week?.scoringItems?.length ? week.scoringItems : LEAGUE_SCORING;
  const errors = days.flatMap(day => day.error ? [day.error] : []);
  if (queries.some(query => query.isError)) errors.push('Some dates could not be loaded. Totals may be incomplete. Try Refresh.');
  const data: DailyNbaScores | undefined = days.length ? {
    date: today, fetchedAt: days[0].fetchedAt, games: days.flatMap(day => day.games),
    boxScores: days.flatMap(day => day.boxScores), error: [...new Set(errors)].join(' ') || null,
  } : undefined;
  return {
    today, dates, rosterQuery, rosters,
    gameDates: new Map(days.flatMap(day => day.games.map(game => [game.id, day.date] as const))),
    rows: topPerformers(days, scoring, rosters),
    teams: week?.matchups.flatMap(matchup => [matchup.home, matchup.away]) ?? [],
    query: {
      data,
      isFetching: queries.some(query => query.isFetching),
      isLoading: queries.some(query => query.isPending),
      isError: queries.every(query => query.isError),
      refetch: () => Promise.all(queries.map(query => query.refetch())),
    },
  };
}

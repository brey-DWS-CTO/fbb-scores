import { useMemo } from 'react';
import { useMatchupEnvironment } from './useMatchupEnvironment.js';
import { matchupGameProjection } from '../lib/league/matchupProjection.js';
import { LEAGUE_SCORING } from '../lib/league/partyScore.js';
import type { ScorePlayer, ScoresWeek } from '../lib/league/scores.js';
import { useExpectedPoints } from './useScores.js';
import { useProjectionData } from './useProjectionData.js';

/** Planner pilot: other score and win-probability pages retain their existing forecasts. */
export function useMatchupProjection(week: ScoresWeek | undefined) {
  const baseline = useExpectedPoints();
  const { snapshot } = useProjectionData();
  const query = useMatchupEnvironment(week?.season);
  const scoring = week?.scoringItems ?? snapshot?.scoringItems ?? LEAGUE_SCORING;
  const environment = query.data?.environment;
  const project = useMemo(() => (player: ScorePlayer, period: number) =>
    matchupGameProjection(player, period, baseline(player, period), week, environment, scoring), [baseline, week, environment, scoring]);
  const expected = useMemo(() => (player: ScorePlayer, period: number) => project(player, period).points, [project]);
  return { expected, project, loading: query.isPending && !!week, available: !!environment, error: query.isError || !!query.data?.error };
}

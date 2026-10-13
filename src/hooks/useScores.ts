import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchScoresWeek } from '../lib/league/api.js';
import { projectedFppg } from '../lib/league/draftRankings.js';
import type { ExpectedPoints, ScorePlayer, ScoresWeek } from '../lib/league/scores.js';
import { useProjectionData } from './useProjectionData.js';

/** How often the current week asks ESPN again while someone is looking. */
export const SCORES_POLL_MS = 60_000;

/**
 * One fantasy week of scores. The current week keeps asking while the tab
 * is open; a past week is read once. `demo` swaps ESPN for the seeded fake
 * week, loaded only when asked for so it never weighs on the real page.
 */
export function useScoresWeek(matchupPeriod: number | null, demo: boolean, enabled = true) {
  return useQuery<ScoresWeek>({
    queryKey: ['scores-week', demo ? 'demo' : (matchupPeriod ?? 'current')],
    queryFn: demo
      ? async () => (await import('../lib/league/scoresDemo.js')).demoWeek()
      : () => fetchScoresWeek(matchupPeriod),
    enabled,
    staleTime: 30_000,
    retry: demo ? false : 1,
    refetchInterval: (query) => {
      if (demo) return false;
      const week = query.state.data;
      return week && week.matchupPeriodId === week.currentMatchupPeriodId ? SCORES_POLL_MS : false;
    },
  });
}

/**
 * Expected points a game for a player: the commissioner's edited
 * projection, else ESPN's season average so far, else nothing.
 */
export function useExpectedPoints(): ExpectedPoints {
  const { snapshot } = useProjectionData();
  return useMemo(() => {
    const byId = new Map<number, number>();
    if (snapshot) {
      for (const player of snapshot.players) {
        const value = projectedFppg(player.projection, snapshot.scoringItems);
        if (value !== null) byId.set(player.espnId, value);
      }
    }
    return (player: ScorePlayer) => byId.get(player.id) ?? player.seasonAvg ?? 0;
  }, [snapshot]);
}

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSchedule } from '../lib/league/api.js';
import { leagueSchedule2027 } from '../lib/league/scheduleData.js';
import { nbaTeamIdForProTeam, summarizeAllTeamSchedules } from '../lib/league/schedule.js';
import { useIdentity, useLeagueState } from './useLeague.js';

export interface PostseasonGames {
  playIn: number;
  playoffs: number;
}

/** Returns null when the player has no NBA team, or no schedule covers it. */
export type PostseasonGamesLookup = (proTeam: string) => PostseasonGames | null;

/**
 * How many play-in and playoff games each player's NBA team is down for.
 *
 * Only the commissioner may read the schedule, so everyone else gets a lookup
 * that answers null and the player listings stay exactly as they were. One
 * hook per page, not per row: the lookup is a plain function, so a long roster
 * costs one query, not one per player.
 */
export function usePostseasonGames(): PostseasonGamesLookup {
  const { identity } = useIdentity();
  const { state } = useLeagueState();
  const isCommissioner = identity?.isCommissioner === true;
  // Same key and same fixture fallback as the schedule admin page, so the two
  // never disagree about which snapshot is live.
  const scheduleQuery = useQuery({
    queryKey: [
      'admin-schedule',
      state.schedule?.activeSnapshotId ?? 'schedule-fixture-2027',
    ],
    queryFn: () => fetchSchedule(identity!),
    enabled: isCommissioner,
    staleTime: 30_000,
  });
  const periods = scheduleQuery.data?.snapshot.leaguePeriods ?? leagueSchedule2027;
  const gamesByTeamId = useMemo(
    () => new Map(
      summarizeAllTeamSchedules(periods).map((summary) => [
        summary.teamId,
        { playIn: summary.playIn.total, playoffs: summary.playoffs.total },
      ]),
    ),
    [periods],
  );

  return useCallback(
    (proTeam: string) => {
      if (!isCommissioner) return null;
      const teamId = nbaTeamIdForProTeam(proTeam);
      if (teamId === null) return null;
      return gamesByTeamId.get(teamId) ?? null;
    },
    [gamesByTeamId, isCommissioner],
  );
}

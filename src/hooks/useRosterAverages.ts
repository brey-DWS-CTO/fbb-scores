import { useQueries } from '@tanstack/react-query';
import { gameLogUrl, readGameLog } from '../lib/league/gameLog.js';
import { playerGameAverages } from '../lib/league/playerGameAverages.js';
import type { ScoringItem } from '../lib/league/partyScore.js';
import type { LineupPlayer } from '../lib/league/lineup.js';
export function useRosterAverages(players: readonly LineupPlayer[], season: number, scoring: readonly ScoringItem[], enabled: boolean) {
  const queries = useQueries({ queries: players.map(player => ({ queryKey: ['game-log', player.id, season], enabled,
    queryFn: async () => {
      const response = await fetch(gameLogUrl(player.id, season));
      if (!response.ok) throw new Error('Game log unavailable');
      return readGameLog(await response.json());
    }, staleTime: 10 * 60_000, retry: 1 })) });
  return new Map(players.map((player, index) => [player.id, { loading: queries[index].isLoading,
    error: queries[index].isError, retry: queries[index].refetch, averages: queries[index].data ? playerGameAverages(queries[index].data, season, scoring) : null }]));
}

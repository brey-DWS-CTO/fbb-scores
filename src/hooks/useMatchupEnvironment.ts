import { useQuery } from '@tanstack/react-query';
import { fetchMatchupEnvironment } from '../lib/league/api.js';

/** The same cached source snapshot feeds the planner and its reference tables. */
export function useMatchupEnvironment(season: number | undefined, enabled = true) {
  return useQuery({ queryKey: ['matchup-environment', season],
    queryFn: () => fetchMatchupEnvironment(season!), enabled: enabled && season !== undefined,
    staleTime: 60 * 60 * 1000, retry: false });
}

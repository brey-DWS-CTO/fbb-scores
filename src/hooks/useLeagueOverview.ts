import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import type { LeagueOverview } from '../lib/league/leagueOverview.js';
export function useLeagueOverview() {
  return useQuery({ queryKey: ['league-overview'], queryFn: async () => (await axios.get<LeagueOverview>('/api/league/overview')).data, staleTime: 300_000, retry: 1 });
}

import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { LeagueInfo } from '../types/index.js'

export function useLeagueInfo() {
  return useQuery({
    queryKey: ['league-info'],
    queryFn: async (): Promise<LeagueInfo> => {
      const { data } = await axios.get<LeagueInfo>('/api/espn/league-info')
      return data
    },
    staleTime: 5 * 60 * 1000, // cache for 5 minutes — league settings rarely change
    retry: 2,
  })
}

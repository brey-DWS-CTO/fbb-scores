import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { LeagueScoreboard } from '../types/index.js'

export function useScoreboard() {
  return useQuery({
    queryKey: ['scoreboard'],
    queryFn: async (): Promise<LeagueScoreboard> => {
      const { data } = await axios.get<LeagueScoreboard>('/api/espn/scoreboard')
      return data
    },
    refetchInterval: 30 * 1000, // refresh every 30 seconds
    staleTime: 15 * 1000,
    retry: 2,
  })
}

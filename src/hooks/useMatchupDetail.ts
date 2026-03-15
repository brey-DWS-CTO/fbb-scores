import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { MatchupDetail } from '../types/index.js'

export function useMatchupDetail(matchupId: number) {
  return useQuery({
    queryKey: ['matchupDetail', matchupId],
    queryFn: async (): Promise<MatchupDetail> => {
      const { data } = await axios.get<MatchupDetail>(`/api/espn/matchup/${matchupId}`)
      return data
    },
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
    retry: 2,
  })
}

import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { DailyMatchup } from '../types/index.js'

export function useDailyView(matchupId: number) {
  return useQuery({
    queryKey: ['daily', matchupId],
    queryFn: async (): Promise<DailyMatchup> => {
      const { data } = await axios.get<DailyMatchup>(`/api/espn/daily/${matchupId}`)
      return data
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 2,
  })
}

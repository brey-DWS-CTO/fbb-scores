import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

export interface PlayerTrendData {
  playerId: number
  playerName: string
  dataPoints: Array<{
    scoringPeriodId: number
    fpts: number
    rollingAvg7: number
    rollingAvg15: number
    rollingAvg30: number
    capturedAt: string
  }>
}

export function usePlayerTrend(playerId: number, enabled = true) {
  return useQuery({
    queryKey: ['playerTrend', playerId],
    queryFn: async (): Promise<PlayerTrendData> => {
      const { data } = await axios.get<PlayerTrendData>(`/api/espn/trends/player/${playerId}`)
      return data
    },
    enabled: enabled && playerId > 0,
    staleTime: 5 * 60 * 1000, // 5 min — trend data doesn't change rapidly
    retry: 1,
  })
}

export interface TeamTrendData {
  teamId: number
  teamName: string
  dataPoints: Array<{
    scoringPeriodId: number
    totalScore: number
    avgPointsPerGame: number
    gamesPlayed: number
    capturedAt: string
  }>
}

export function useTeamTrend(teamId: number, enabled = true) {
  return useQuery({
    queryKey: ['teamTrend', teamId],
    queryFn: async (): Promise<TeamTrendData> => {
      const { data } = await axios.get<TeamTrendData>(`/api/espn/trends/team/${teamId}`)
      return data
    },
    enabled: enabled && teamId > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}

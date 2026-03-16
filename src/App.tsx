import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Header from './components/Header.js'
import Scoreboard from './components/Scoreboard.js'
import WeekSelector from './components/WeekSelector.js'
import LoadingState from './components/LoadingState.js'
import ErrorState from './components/ErrorState.js'
import MatchupDetailPage from './components/MatchupDetailPage.js'
import { useScoreboard } from './hooks/useScoreboard.js'
import { useLeagueInfo } from './hooks/useLeagueInfo.js'

function App() {
  const [selectedPeriod, setSelectedPeriod] = useState<number | undefined>(undefined)
  const { data: leagueInfo } = useLeagueInfo()
  const effectivePeriod = selectedPeriod ?? leagueInfo?.currentMatchupPeriod
  const { data, isLoading, isError, error, refetch, isFetching } = useScoreboard(effectivePeriod)

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f' }}>
      {isLoading && <LoadingState />}
      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'An error occurred'}
          onRetry={refetch}
        />
      )}
      {data && (
        <>
          <Header
            leagueName={data.leagueName}
            playoff={data.playoff}
            fetchedAt={data.fetchedAt}
            onRefresh={() => refetch()}
            isRefreshing={isFetching}
          />
          {leagueInfo && effectivePeriod != null && (
            <WeekSelector
              leagueInfo={leagueInfo}
              selectedPeriod={effectivePeriod}
              onSelectPeriod={setSelectedPeriod}
            />
          )}
          <Routes>
            <Route path="/" element={<Scoreboard data={data} selectedPeriod={effectivePeriod} />} />
            <Route path="/matchup/:matchupId" element={<MatchupDetailPage />} />
          </Routes>
        </>
      )}
    </div>
  )
}

export default App

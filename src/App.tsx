import { useState } from 'react'
import { Routes, Route, useParams, useLocation } from 'react-router-dom'
import Header from './components/Header.js'
import Scoreboard from './components/Scoreboard.js'
import WeekSelector from './components/WeekSelector.js'
import LoadingState from './components/LoadingState.js'
import ErrorState from './components/ErrorState.js'
import MatchupDetailPage from './components/MatchupDetailPage.js'
import SettingsPanel from './components/SettingsPanel.js'
import BottomNav from './components/league/BottomNav.js'
import KeepersPage from './components/keepers/KeepersPage.js'
import TeamKeeperPage from './components/keepers/TeamKeeperPage.js'
import DraftPage from './components/draft/DraftPage.js'
import DraftTvPage from './components/draft/DraftTvPage.js'
import LeaguePage from './components/league/LeaguePage.js'
import { useScoreboard } from './hooks/useScoreboard.js'
import { useLeagueInfo } from './hooks/useLeagueInfo.js'

/** The original live-scores app (ESPN scoreboard + matchup detail). */
function ScoresApp() {
  const { matchupId } = useParams()
  const [selectedPeriod, setSelectedPeriod] = useState<number | undefined>(undefined)
  const [showSettings, setShowSettings] = useState(false)
  const { data: leagueInfo } = useLeagueInfo()
  const effectivePeriod = selectedPeriod ?? leagueInfo?.currentMatchupPeriod
  const { data, isLoading, isError, error, refetch, isFetching } = useScoreboard(effectivePeriod)

  return (
    <>
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
            onOpenSettings={() => setShowSettings(true)}
          />
          {leagueInfo && effectivePeriod != null && (
            <WeekSelector
              leagueInfo={leagueInfo}
              selectedPeriod={effectivePeriod}
              onSelectPeriod={setSelectedPeriod}
            />
          )}
          {matchupId ? (
            <MatchupDetailPage />
          ) : (
            <Scoreboard data={data} selectedPeriod={effectivePeriod} />
          )}
        </>
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </>
  )
}

function App() {
  const location = useLocation()
  const tvMode = location.pathname.startsWith('/draft/tv')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', paddingBottom: tvMode ? 0 : 64 }}>
      <Routes>
        <Route path="/" element={<ScoresApp />} />
        <Route path="/matchup/:matchupId" element={<ScoresApp />} />
        <Route path="/keepers" element={<KeepersPage />} />
        <Route path="/keepers/:owner" element={<TeamKeeperPage />} />
        <Route path="/draft" element={<DraftPage />} />
        <Route path="/draft/tv" element={<DraftTvPage />} />
        <Route path="/league" element={<LeaguePage />} />
      </Routes>
      {!tvMode && <BottomNav />}
    </div>
  )
}

export default App

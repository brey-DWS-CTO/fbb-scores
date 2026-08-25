import { Routes, Route, useLocation } from 'react-router-dom'
import BottomNav from './components/league/BottomNav.js'
import SplashPage from './components/league/SplashPage.js'
import KeepersPage from './components/keepers/KeepersPage.js'
import TeamKeeperPage from './components/keepers/TeamKeeperPage.js'
import DraftPage from './components/draft/DraftPage.js'
import DraftTvPage from './components/draft/DraftTvPage.js'
import LeaguePage from './components/league/LeaguePage.js'
import AdminPage from './components/league/AdminPage.js'

function App() {
  const location = useLocation()
  const bareMode =
    location.pathname.startsWith('/draft/tv') || location.pathname === '/'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--dark-bg)', paddingBottom: bareMode ? 0 : 64 }}>
      <Routes>
        <Route path="/" element={<SplashPage />} />
        <Route path="/keepers" element={<KeepersPage />} />
        <Route path="/keepers/:owner" element={<TeamKeeperPage />} />
        <Route path="/draft" element={<DraftPage />} />
        <Route path="/draft/tv" element={<DraftTvPage />} />
        <Route path="/league" element={<LeaguePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<SplashPage />} />
      </Routes>
      {!bareMode && <BottomNav />}
    </div>
  )
}

export default App

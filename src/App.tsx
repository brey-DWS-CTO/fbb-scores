import { Routes, Route, useLocation, Link } from 'react-router-dom'
import { sandboxActive } from './lib/league/api.js'
import BottomNav from './components/league/BottomNav.js'
import SplashPage from './components/league/SplashPage.js'
import KeepersPage from './components/keepers/KeepersPage.js'
import TeamKeeperPage from './components/keepers/TeamKeeperPage.js'
import DraftPage from './components/draft/DraftPage.js'
import DraftTvPage from './components/draft/DraftTvPage.js'
import LeaguePage from './components/league/LeaguePage.js'
import TeamsPage from './components/league/TeamsPage.js'
import AdminPage from './components/league/AdminPage.js'
import SchedulePage from './components/league/SchedulePage.js'

function App() {
  const location = useLocation()
  const bareMode =
    location.pathname.startsWith('/draft/tv') || location.pathname === '/'

  const sandbox = sandboxActive()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--dark-bg)', paddingBottom: bareMode ? 0 : 64 }}>
      {sandbox && (
        <Link
          to="/admin"
          style={{
            display: 'block',
            background: 'rgba(255,230,0,0.12)',
            borderBottom: '2px solid var(--neon-yellow)',
            color: 'var(--neon-yellow)',
            textAlign: 'center',
            fontSize: '0.75rem',
            fontWeight: 800,
            letterSpacing: '0.05em',
            padding: '6px 10px',
            textDecoration: 'none',
          }}
        >
          🧪 TEST MODE — sandbox only, nothing is saved · tap to exit in Commish Mode
        </Link>
      )}
      <Routes>
        <Route path="/" element={<SplashPage />} />
        <Route path="/keepers" element={<KeepersPage />} />
        <Route path="/keepers/:owner" element={<TeamKeeperPage />} />
        <Route path="/draft" element={<DraftPage />} />
        <Route path="/draft/tv" element={<DraftTvPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/league" element={<LeaguePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="*" element={<SplashPage />} />
      </Routes>
      {!bareMode && <BottomNav />}
    </div>
  )
}

export default App

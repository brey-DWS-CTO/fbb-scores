import { Routes, Route, useLocation, Link } from 'react-router-dom'
import { useLeagueState } from './hooks/useLeague.js';
import { sandboxActive, testDraftJoined } from './lib/league/api.js'
import AppNav from './components/league/AppNav.js'
import NavIcon from './components/league/NavIcon.js'
import ActingAsBanner from './components/league/ActingAsBanner.js';
import SectionTabs from './components/league/SectionTabs.js'
import SplashPage from './components/league/SplashPage.js'
import SignInLinkPage from './components/league/SignInLinkPage.js'
import KeepersPage from './components/keepers/KeepersPage.js'
import TeamKeeperPage from './components/keepers/TeamKeeperPage.js'
import DraftPage from './components/draft/DraftPage.js'
import DraftTvPage from './components/draft/DraftTvPage.js'
import LeaguePage from './components/league/LeaguePage.js'
import HistoryPage from './components/league/HistoryPage.js'
import TeamsPage from './components/league/TeamsPage.js'
import AdminPage from './components/league/AdminPage.js'
import SchedulePage from './components/league/SchedulePage.js'
import NbaWatchPage from './components/league/NbaWatchPage.js'
import RulesPage from './components/league/RulesPage.js'
import PaperPage from './components/league/PaperPage.js'
import VotesPage from './components/league/VotesPage.js'
import DuesPage from './components/league/DuesPage.js'
import ActivityPage from './components/league/ActivityPage.js'
import TradesPage from './components/league/TradesPage.js'
import MockDraftPage from './components/league/MockDraftPage.js'
import ProjectionsPage from './components/league/ProjectionsPage.js'
import TiersPage from './components/league/TiersPage.js'
import DraftStartPage from './components/league/DraftStartPage.js'
import MockResultPage from './components/league/MockResultPage.js'
import ScoresPage from './components/league/ScoresPage.js'
import TopPerformersPage from './components/league/TopPerformersPage.js'
import NbaScoreboardPage from './components/league/NbaScoreboardPage.js'
import LeagueOffseasonPage from './components/league/LeagueOffseasonPage.js'
import WaiverCalendarPage from './components/league/WaiverCalendarPage.js'
import LmAddsPage from './components/league/LmAddsPage.js'
import NbaGameScoresPage from './components/league/NbaGameScoresPage.js'
import WeeklyPpgPage from './components/league/WeeklyPpgPage.js'
import MatchupPage from './components/league/MatchupPage.js'
import SharedMockPage from './components/league/SharedMockPage.js'
import AchievementsPage from './components/league/AchievementsPage.js'
import AchievementToast from './components/league/AchievementToast.js'
import RevealPage from './components/league/RevealPage.js'
import RevealedPage from './components/league/RevealedPage.js'
import PropBetsPage from './components/league/PropBetsPage.js'
import StatsGate from './components/league/StatsGate.js'
import MyRankingsPage from './components/draft/MyRankingsPage.js'
import WatchPage from './components/league/WatchPage.js'
import PartyPage from './components/league/PartyPage.js'
import FavoritesPrompt from './components/league/FavoritesPrompt.js'
import InviteToast from './components/league/InviteToast.js'
import DraftRecapPage from './components/draft/DraftRecapPage.js'
import FantasyCastPage from './components/league/FantasyCastPage.js'
import FantasyCastBubble from './components/league/FantasyCastBubble.js'

function App() {
  const location = useLocation()
  const { seasonMode } = useLeagueState()
  // The sign-in link page is bare too: nobody is signed in to navigate with.
  const bareMode =
    location.pathname.startsWith('/draft/tv') ||
    location.pathname.startsWith('/sign-in/') ||
    location.pathname === '/'

  const sandbox = sandboxActive()

  return (
    <div
      className={bareMode ? undefined : 'app-shell-nav'}
      style={{ minHeight: '100vh', backgroundColor: 'var(--dark-bg)' }}
    >
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
          <NavIcon name="flask" size={14} className="icon-in-heading" />
          TEST MODE. Sandbox only, nothing is saved. Tap to exit in Commish Mode.
        </Link>
      )}
      {!sandbox && testDraftJoined() && (
        <Link
          to="/draft"
          className="test-draft-strip"
        >
          <NavIcon name="flask" size={14} className="icon-in-heading" />
          TEST DRAFT. Picks here do not count. Tap to open the draft.
        </Link>
      )}
      {!bareMode && <AppNav />}
      {!bareMode && !sandbox && seasonMode === 'off-season' && <AchievementToast />}
      {!bareMode && !sandbox && <FavoritesPrompt />}
      {!bareMode && !sandbox && <InviteToast />}
      <ActingAsBanner />
      {!bareMode && <SectionTabs />}
      <Routes>
        <Route path="/" element={<SplashPage />} />
        <Route path="/sign-in/:token" element={<SignInLinkPage />} />
        <Route path="/keepers" element={<KeepersPage />} />
        <Route path="/keepers/:owner" element={<TeamKeeperPage />} />
        <Route path="/draft" element={<DraftPage />} />
        <Route path="/draft/start" element={<DraftStartPage />} />
        <Route path="/draft/tv" element={<DraftTvPage />} />
        <Route path="/draft/recap" element={<StatsGate><DraftRecapPage /></StatsGate>} />
        <Route path="/my-rankings" element={<MyRankingsPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/league" element={<LeaguePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/dues" element={<DuesPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/achievements/reveal" element={<RevealPage />} />
        <Route path="/revealed" element={<RevealedPage />} />
        <Route path="/props" element={<PropBetsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/rules/paper" element={<PaperPage />} />
        <Route path="/votes" element={<VotesPage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/mock" element={<StatsGate><MockDraftPage /></StatsGate>} />
        <Route path="/mock/result/:id" element={<StatsGate><MockResultPage /></StatsGate>} />
        <Route path="/mock/with/:id" element={<StatsGate><SharedMockPage /></StatsGate>} />
        <Route path="/projections" element={<StatsGate><ProjectionsPage /></StatsGate>} />
        <Route path="/tiers" element={<StatsGate><TiersPage /></StatsGate>} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/watch" element={<WatchPage />} />
        <Route path="/party/:id" element={<PartyPage />} />
        <Route path="/scores" element={<ScoresPage />} />
        <Route path="/scores/cast" element={<FantasyCastPage />} />
        <Route path="/league/offseason" element={<LeagueOffseasonPage />} />
        <Route path="/waivers" element={<WaiverCalendarPage />} />
        <Route path="/lm-adds" element={<LmAddsPage />} />
        <Route path="/scores/performers" element={<TopPerformersPage />} />
        <Route path="/scores/nba-scoreboard" element={<NbaScoreboardPage />} />
        <Route path="/scores/nba" element={<NbaGameScoresPage />} />
        <Route path="/scores/nba/:gameId" element={<NbaGameScoresPage />} />
        <Route path="/scores/ppg" element={<WeeklyPpgPage />} />
        <Route path="/scores/:matchupId" element={<MatchupPage />} />
        <Route path="/awards" element={<NbaWatchPage view="awards" />} />
        <Route path="/depth" element={<NbaWatchPage view="depth" />} />
        <Route path="*" element={<SplashPage />} />
      </Routes>
      <FantasyCastBubble />
    </div>
  )
}

export default App

import { Navigate, useNavigate } from 'react-router-dom';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import { leagueDataset } from '../../lib/league/data.js';
import { seasonHome } from '../../lib/league/seasonMode.js';
import NavIcon from './NavIcon.js';
import TeamPickerForm from './TeamPickerForm.js';

/** / — a focused sign-in page. Signed-in owners open scores in season and keepers off season. */
export default function SplashPage() {
  const { identity } = useIdentity();
  const { seasonMode, isPending } = useLeagueState();
  const navigate = useNavigate();

  if (identity) {
    if (isPending) return <main className="splash-page"><p role="status">Opening your league...</p></main>;
    return <Navigate to={identity.isGuest ? '/scores' : seasonHome(seasonMode)} replace />;
  }

  return (
    <main className="splash-page">
      <div className="splash-orb splash-orb-teal" aria-hidden="true" />
      <div className="splash-orb splash-orb-purple" aria-hidden="true" />

      <div className="splash-shell">
        <header className="splash-hero">
          <div className="splash-season">FBB SCORES · THE NERDS · SEASON {leagueDataset.season}</div>
          <img className="splash-logo" src="/logo.png" alt="FBB Scores — The Nerds fantasy basketball league" />
          <h1>The home of the best fantasy basketball league on the planet.</h1>
          <p>Set your keepers, check the draft board, and search ALL the many rules.</p>

          <div className="splash-feature-row" aria-label="League hub features">
            <span><NavIcon name="lock" size={14} />Keepers</span>
            <span><NavIcon name="target" size={14} />Draft</span>
            <span><NavIcon name="book" size={14} />League HQ</span>
          </div>
        </header>

        <section className="panel splash-login-card" aria-labelledby="sign-in-title">
          <div className="splash-login-heading">
            <div>
              <h2 id="sign-in-title">Sign in</h2>
            </div>
            <div className="splash-lock"><NavIcon name="lock" size={20} /></div>
          </div>

          <TeamPickerForm onDone={() => navigate('/')} />
        </section>

        <footer className="splash-footer">
          <span>EST. 2010</span>
          <span aria-hidden="true">•</span>
          <span>10 OWNERS</span>
          <span aria-hidden="true">•</span>
          <span>1 CHAMPION</span>
        </footer>
      </div>
    </main>
  );
}

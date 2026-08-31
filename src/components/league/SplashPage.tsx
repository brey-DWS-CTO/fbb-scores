import { Navigate, useNavigate } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { leagueDataset } from '../../lib/league/data.js';
import TeamPickerForm from './TeamPickerForm.js';

/** / — a focused sign-in page. Signed-in owners go straight to their worksheet. */
export default function SplashPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();

  if (identity) return <Navigate to="/keepers" replace />;

  return (
    <main className="splash-page">
      <div className="splash-orb splash-orb-teal" aria-hidden="true" />
      <div className="splash-orb splash-orb-purple" aria-hidden="true" />

      <div className="splash-shell">
        <header className="splash-hero">
          <div className="splash-season">THE NERDS · SEASON {leagueDataset.season}</div>
          <img className="splash-logo" src="/logo.png" alt="The Nerds fantasy basketball" />
          <h1>The home of the best fantasy basketball league on the planet.</h1>
          <p>Set your keepers, check the draft board, and search ALL the many rules.</p>

          <div className="splash-feature-row" aria-label="League hub features">
            <span>🔒 Keepers</span>
            <span>🎯 Draft</span>
            <span>📖 League HQ</span>
          </div>
        </header>

        <section className="panel splash-login-card" aria-labelledby="sign-in-title">
          <div className="splash-login-heading">
            <div>
              <div className="splash-step">OWNER ACCESS</div>
              <h2 id="sign-in-title">Who are you?</h2>
            </div>
            <div className="splash-lock" aria-hidden="true">🔐</div>
          </div>

          <TeamPickerForm onDone={() => navigate('/keepers')} />
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

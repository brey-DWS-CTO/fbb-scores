import { Navigate, useNavigate } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { leagueDataset } from '../../lib/league/data.js';
import TeamPickerForm from './TeamPickerForm.js';

/** / — splash + login. Already signed in? Straight to the keeper worksheet. */
export default function SplashPage() {
  const { identity } = useIdentity();
  const navigate = useNavigate();

  if (identity) return <Navigate to="/keepers" replace />;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px 90px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ fontSize: '2.6rem', lineHeight: 1 }}>🏀</div>
          <h1
            className="hub-heading glow-teal"
            style={{
              fontSize: 'clamp(1.3rem, 7vw, 2rem)',
              color: 'var(--neon-teal)',
              margin: '12px 0 6px',
              lineHeight: 1.3,
            }}
          >
            THE NERDS
          </h1>
          <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)' }}>
            FANTASY BASKETBALL · SEASON {leagueDataset.season}
          </div>
          <div style={{ color: 'var(--text-mid)', fontSize: '0.85rem', marginTop: 10 }}>
            Keepers · Draft board · League HQ
          </div>
        </div>

        <div className="panel" style={{ padding: '18px 16px', borderRadius: 12 }}>
          <div className="hub-heading glow-yellow" style={{ fontSize: '0.72rem', color: 'var(--neon-yellow)', marginBottom: 14 }}>
            WHO ARE YOU?
          </div>
          <TeamPickerForm onDone={() => navigate('/keepers')} />
        </div>

        <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.72rem', marginTop: 18 }}>
          Est. 2010 · 16 seasons of bad decisions
        </div>
      </div>
    </div>
  );
}

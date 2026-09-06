import { Link } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import ScheduleAdmin from './ScheduleAdmin.js';

/** /schedule — commissioner-only NBA schedule workspace. */
export default function SchedulePage() {
  const { identity } = useIdentity();

  if (!identity?.isCommissioner) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>
            COMMISH ONLY
          </div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Sign in as the commish to view or update the schedule grid.
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="schedule-page">
      <header className="schedule-page-header">
        <div>
          <Link className="schedule-back-link" to="/admin">← COMMISH MODE</Link>
          <h1 className="hub-heading glow-orange">
            <NavIcon name="calendar" size={18} className="icon-in-heading" />
            SCHEDULE
          </h1>
          <p>NBA games by fantasy period, plus Play-In and playoff totals.</p>
        </div>
        <IdentityChip />
      </header>
      <ScheduleAdmin />
    </main>
  );
}

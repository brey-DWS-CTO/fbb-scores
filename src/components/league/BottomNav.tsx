import { NavLink } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';

const TABS = [
  { to: '/keepers', label: 'KEEPERS', icon: '🔒' },
  { to: '/draft', label: 'DRAFT', icon: '🎯' },
  { to: '/teams', label: 'TEAMS', icon: '👥' },
  { to: '/league', label: 'LEAGUE', icon: '📖' },
];

export default function BottomNav() {
  const { identity } = useIdentity();
  const tabs = identity?.isCommissioner
    ? [...TABS, { to: '/admin', label: 'COMMISH', icon: '👑' }]
    : TABS;

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        background: 'var(--nav-bg)',
        borderTop: '2px solid var(--panel-border)',
        backdropFilter: 'blur(8px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          style={({ isActive }) => ({
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '8px 0 10px',
            textDecoration: 'none',
            color: isActive ? 'var(--neon-teal)' : 'var(--text-mid)',
            borderTop: isActive ? '2px solid var(--neon-teal)' : '2px solid transparent',
            marginTop: -2,
            transition: 'color 0.15s',
          })}
        >
          <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{t.icon}</span>
          <span className="hub-heading" style={{ fontSize: '0.62rem' }}>
            {t.label}
          </span>
        </NavLink>
      ))}
    </nav>
  );
}

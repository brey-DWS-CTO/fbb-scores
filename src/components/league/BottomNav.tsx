import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', label: 'SCORES', icon: '🏀', end: true },
  { to: '/keepers', label: 'KEEPERS', icon: '🔒', end: false },
  { to: '/draft', label: 'DRAFT', icon: '🎯', end: false },
  { to: '/league', label: 'LEAGUE', icon: '📖', end: false },
];

export default function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        background: 'rgba(10, 10, 18, 0.96)',
        borderTop: '2px solid var(--panel-border)',
        backdropFilter: 'blur(8px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          style={({ isActive }) => ({
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '8px 0 10px',
            textDecoration: 'none',
            color: isActive ? 'var(--neon-teal)' : '#8888aa',
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

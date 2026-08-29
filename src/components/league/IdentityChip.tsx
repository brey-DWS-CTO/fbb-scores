import { useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { useSettings } from '../../hooks/useSettings.js';
import TeamPickerModal from './TeamPickerModal.js';

/** "Signed in as" chip + theme toggle — lives top-right on every page. */
export default function IdentityChip() {
  const { identity } = useIdentity();
  const { theme, setTheme } = useSettings();
  const [open, setOpen] = useState(false);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        className="tap-btn"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label="Toggle light/dark theme"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: '2px solid var(--panel-border)',
          background: 'transparent',
          fontSize: '1rem',
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <button
        className="tap-btn"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          background: identity ? 'rgba(0,255,204,0.08)' : 'rgba(255,230,0,0.08)',
          border: `2px solid ${identity ? 'var(--neon-teal)' : 'var(--neon-yellow)'}`,
          borderRadius: 999,
          color: identity ? 'var(--neon-teal)' : 'var(--neon-yellow)',
          fontSize: '0.8rem',
          fontWeight: 700,
        }}
      >
        {identity ? (
          <>
            <span>{identity.owner}</span>
            {identity.isCommissioner && <span title="Commish">👑</span>}
          </>
        ) : (
          <span>Who are you?</span>
        )}
      </button>
      {open && <TeamPickerModal onClose={() => setOpen(false)} />}
    </span>
  );
}

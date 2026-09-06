import { useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { useSettings } from '../../hooks/useSettings.js';
import NavIcon from './NavIcon.js';
import TeamPickerModal from './TeamPickerModal.js';

interface Props {
  placement?: 'page' | 'nav';
}

/** "Signed in as" chip + theme toggle. Desktop uses the global nav placement. */
export default function IdentityChip({ placement = 'page' }: Props) {
  const { identity } = useIdentity();
  const { theme, setTheme } = useSettings();
  const [open, setOpen] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<DOMRect | null>(null);

  return (
    <span className={`identity-chip identity-chip-${placement}`}>
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
        <NavIcon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
      <button
        className="tap-btn"
        onClick={(event) => {
          setAccountAnchor(event.currentTarget.getBoundingClientRect());
          setOpen(true);
        }}
        aria-label={identity ? `Open account menu for ${identity.owner}` : 'Sign in'}
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
            {identity.isCommissioner && <NavIcon name="crown" size={15} label="Commish" />}
            <span aria-hidden="true" style={{ fontSize: '0.65rem', opacity: 0.75 }}>▼</span>
          </>
        ) : (
          <span>Who are you?</span>
        )}
      </button>
      {open && (
        <TeamPickerModal
          {...(accountAnchor ? { anchor: accountAnchor } : {})}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

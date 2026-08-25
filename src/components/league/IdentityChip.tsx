import { useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import TeamPickerModal from './TeamPickerModal.js';

/** Small "signed in as" chip; tap to sign in / switch teams. */
export default function IdentityChip() {
  const { identity } = useIdentity();
  const [open, setOpen] = useState(false);

  return (
    <>
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
            {identity.isCommissioner && <span title="Commissioner">👑</span>}
          </>
        ) : (
          <span>Who are you?</span>
        )}
      </button>
      {open && <TeamPickerModal onClose={() => setOpen(false)} />}
    </>
  );
}

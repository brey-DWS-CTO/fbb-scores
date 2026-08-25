import { useState } from 'react';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';

interface Props {
  onClose: () => void;
}

/** "Who are you?" — pick your team + enter your PIN. */
export default function TeamPickerModal({ onClose }: Props) {
  const { signIn } = useIdentity();
  const [owner, setOwner] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!owner || pin.length < 4) return;
    setBusy(true);
    setError(null);
    const res = await signIn(owner, pin);
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.error ?? 'Sign-in failed');
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '20px 16px calc(20px + env(safe-area-inset-bottom))',
          borderRadius: '12px 12px 0 0',
        }}
      >
        <div className="hub-heading glow-teal" style={{ fontSize: '0.8rem', marginBottom: 14 }}>
          WHO ARE YOU?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {OWNERS.map((o) => {
            const team = teamByOwner.get(o);
            const active = owner === o;
            return (
              <button
                key={o}
                onClick={() => setOwner(o)}
                style={{
                  padding: '10px 8px',
                  background: active ? 'rgba(0,255,204,0.12)' : 'var(--panel-bg)',
                  border: `2px solid ${active ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                  borderRadius: 8,
                  color: active ? 'var(--neon-teal)' : '#e0e0e0',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{o}</div>
                <div style={{ fontSize: '0.7rem', color: '#8888aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {team?.espnTeamName}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input
            type="tel"
            inputMode="numeric"
            placeholder="PIN"
            value={pin}
            maxLength={8}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={{
              flex: 1,
              padding: '12px 14px',
              background: '#07070d',
              border: '2px solid var(--panel-border)',
              borderRadius: 8,
              color: '#fff',
              fontSize: '1.1rem',
              letterSpacing: '0.3em',
              outline: 'none',
            }}
          />
          <button
            onClick={submit}
            disabled={!owner || pin.length < 4 || busy}
            style={{
              padding: '12px 22px',
              background: !owner || pin.length < 4 ? '#1a1a33' : 'var(--neon-teal)',
              color: !owner || pin.length < 4 ? '#666688' : '#001a14',
              border: 'none',
              borderRadius: 8,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {busy ? '...' : "LET'S GO"}
          </button>
        </div>
        {error && (
          <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.85rem' }}>{error}</div>
        )}
        <div style={{ color: '#666688', marginTop: 10, fontSize: '0.75rem' }}>
          PINs were dealt by the commissioner. Lost yours? Yell at Brey in the group chat.
        </div>
      </div>
    </div>
  );
}

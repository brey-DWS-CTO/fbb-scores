import { useEffect, useState } from 'react';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';
import { changePin, claimPin, fetchPinStatus, apiErrorMessage } from '../../lib/league/api.js';

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '12px 14px',
  background: 'var(--input-bg)',
  border: '2px solid var(--panel-border)',
  borderRadius: 8,
  color: 'var(--text-max)',
  fontSize: '1.1rem',
  letterSpacing: '0.3em',
  outline: 'none',
};

/**
 * The "who are you?" form: pick your team, set a PIN on first entry, then use
 * it. Shared by the splash page and the in-app modal.
 */
export default function TeamPickerForm({ onDone }: { onDone: () => void }) {
  const { signIn } = useIdentity();
  const [owner, setOwner] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Record<string, boolean> | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when a temporary (commissioner-assigned) PIN was accepted: the owner
  // must now choose their own PIN before they're signed in.
  const [tempPin, setTempPin] = useState<string | null>(null);

  useEffect(() => {
    fetchPinStatus()
      .then((rows) => setClaimed(Object.fromEntries(rows.map((r) => [r.owner, r.claimed]))))
      .catch(() => setClaimed(null));
  }, []);

  const isFirstTime = owner !== null && claimed !== null && claimed[owner] === false;
  const changing = tempPin !== null;
  const needsRepeat = isFirstTime || changing;

  const submit = async () => {
    if (!owner || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      if (needsRepeat && pin !== pin2) {
        setError("PINs don't match — type the same one twice.");
        setBusy(false);
        return;
      }
      if (changing) {
        // Forced change: replace the temp PIN, then sign in with the new one
        await changePin({ owner, pin: tempPin! }, pin);
        const res = await signIn(owner, pin);
        if (res.ok) onDone();
        else setError(res.error ?? 'Sign-in failed');
        return;
      }
      if (isFirstTime) {
        await claimPin(owner, pin);
      }
      const res = await signIn(owner, pin);
      if (res.ok) onDone();
      else if (res.mustChangePin) {
        setTempPin(pin);
        setPin('');
        setPin2('');
      } else setError(res.error ?? 'Sign-in failed');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = owner && pin.length >= 4 && (!needsRepeat || pin2.length >= 4);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {OWNERS.map((o) => {
          const team = teamByOwner.get(o);
          const active = owner === o;
          const unclaimed = claimed !== null && claimed[o] === false;
          return (
            <button
              key={o}
              onClick={() => {
                setOwner(o);
                setError(null);
                setTempPin(null);
              }}
              style={{
                padding: '10px 8px',
                background: active ? 'rgba(0,255,204,0.12)' : 'var(--panel-bg)',
                border: `2px solid ${active ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                borderRadius: 8,
                color: active ? 'var(--neon-teal)' : 'var(--text-hi)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                {o}
                {unclaimed && (
                  <span style={{ color: 'var(--neon-yellow)', fontSize: '0.65rem', marginLeft: 6 }}>
                    NEW
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-mid)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {team?.espnTeamName}
              </div>
            </button>
          );
        })}
      </div>

      {changing ? (
        <div style={{ color: 'var(--neon-teal)', marginTop: 12, fontSize: '0.8rem', fontWeight: 700 }}>
          ✓ Temporary PIN accepted — now pick your OWN 4-8 digit PIN. You'll use it from here on.
        </div>
      ) : isFirstTime ? (
        <div style={{ color: 'var(--neon-yellow)', marginTop: 12, fontSize: '0.8rem', fontWeight: 700 }}>
          First time in — pick a 4-8 digit PIN. You'll use it every time, so remember it.
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          type="tel"
          inputMode="numeric"
          placeholder={needsRepeat ? 'New PIN' : 'PIN'}
          value={pin}
          maxLength={8}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={inputStyle}
        />
        {needsRepeat && (
          <input
            type="tel"
            inputMode="numeric"
            placeholder="Repeat it"
            value={pin2}
            maxLength={8}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            style={inputStyle}
          />
        )}
        <button
          onClick={submit}
          disabled={!ready || busy}
          style={{
            padding: '12px 22px',
            background: !ready ? 'var(--panel-border)' : 'var(--neon-teal)',
            color: !ready ? 'var(--text-dim)' : '#001a14',
            border: 'none',
            borderRadius: 8,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {busy ? '...' : needsRepeat ? 'SET & GO' : "LET'S GO"}
        </button>
      </div>
      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.85rem' }}>{error}</div>
      )}
      <div style={{ color: 'var(--text-dim)', marginTop: 10, fontSize: '0.75rem' }}>
        {isFirstTime
          ? 'Your keeper names stay secret until the commissioner reveals them.'
          : 'Forgot your PIN? Yell at Brey in the group chat and he can reset it.'}
      </div>
    </div>
  );
}

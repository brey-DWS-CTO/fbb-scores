import { useEffect, useState, type FormEvent } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchPins, setPin, type PinState } from '../../lib/league/api.js';

const STATE_LABEL: Record<PinState, string> = { set: 'PIN SET', temp: 'TEMP PIN', none: 'NO PIN' };

const smallBtn = (color: string) => ({
  minHeight: 40,
  padding: '0 12px',
  borderRadius: 8,
  border: `2px solid ${color}`,
  background: 'transparent',
  color,
  fontSize: '0.7rem',
  fontWeight: 800,
  flexShrink: 0,
});

/**
 * Owner PINs, commissioner only. The commissioner can set or clear a PIN but
 * never read one. A new PIN goes to the owner's saved address with a sign-in
 * link, so nobody has to pass it on by hand.
 */
export default function PinAdmin() {
  const { identity } = useIdentity();
  const [rows, setRows] = useState<Array<{ owner: string; state: PinState }> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [clearArm, setClearArm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ owner: string; text: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    fetchPins(identity)
      .then(setRows)
      .catch((caught: unknown) => setError(apiErrorMessage(caught)));
  }, [identity]);

  if (!identity) return null;

  const run = async (owner: string, pin: string) => {
    setBusy(owner);
    setError(null);
    setNote(null);
    try {
      const result = await setPin(identity, owner, pin);
      setRows(await fetchPins(identity));
      setEditing(null);
      setDraft('');
      if (pin === '') setNote({ owner, text: 'CLEARED', ok: true });
      else if (result.emailed) setNote({ owner, text: result.logged ? 'SET, MAIL LOGGED' : 'SET AND EMAILED', ok: true });
      else setNote({ owner, text: `Saved. ${result.reason ?? 'No email went out.'}`, ok: false });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent, owner: string) => {
    event.preventDefault();
    if (/^\d{4,8}$/.test(draft)) void run(owner, draft);
  };

  return (
    <div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: 10 }}>
        Set a PIN and it goes to that owner&apos;s sign-in email with a sign-in link. You
        will not see it again.
      </div>

      {rows === null && !error ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {(rows ?? []).map(({ owner, state }) => (
            <div key={owner} style={{ display: 'grid', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-hi)', fontSize: '0.8rem' }}>
                  {owner}
                </span>
                <span
                  style={{
                    color: state === 'set' ? 'var(--neon-teal)' : 'var(--neon-yellow)',
                    fontSize: '0.6rem',
                    fontWeight: 800,
                  }}
                >
                  {STATE_LABEL[state]}
                </span>
                {editing !== owner && (
                  <>
                    <button
                      className="tap-btn"
                      type="button"
                      onClick={() => {
                        setEditing(owner);
                        setDraft('');
                        setClearArm(null);
                        setNote(null);
                      }}
                      disabled={busy !== null}
                      style={smallBtn('var(--neon-teal)')}
                    >
                      SET
                    </button>
                    <button
                      className="tap-btn"
                      type="button"
                      onClick={() => (clearArm === owner ? void run(owner, '') : setClearArm(owner))}
                      disabled={busy !== null || state === 'none'}
                      style={smallBtn(
                        state === 'none'
                          ? 'var(--text-ghost)'
                          : clearArm === owner
                            ? 'var(--neon-red)'
                            : 'var(--text-mid)',
                      )}
                    >
                      {busy === owner && editing === null ? '…' : clearArm === owner ? 'SURE?' : 'CLEAR'}
                    </button>
                  </>
                )}
              </div>
              {editing === owner && (
                <form style={{ display: 'flex', gap: 8 }} onSubmit={(event) => submit(event, owner)}>
                  <input
                    className="identity-email-input"
                    style={{ flex: 1, height: 44, fontSize: '0.85rem' }}
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    placeholder="4 to 8 digits"
                    aria-label={`New PIN for ${owner}`}
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))}
                  />
                  <button
                    className="tap-btn"
                    type="submit"
                    disabled={busy !== null || !/^\d{4,8}$/.test(draft)}
                    style={smallBtn('var(--neon-teal)')}
                  >
                    {busy === owner ? '…' : 'SAVE + EMAIL'}
                  </button>
                  <button
                    className="tap-btn"
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setDraft('');
                    }}
                    style={smallBtn('var(--panel-border)')}
                  >
                    <span style={{ color: 'var(--text-mid)' }}>CANCEL</span>
                  </button>
                </form>
              )}
              {note?.owner === owner && (
                <div
                  style={{
                    color: note.ok ? 'var(--neon-teal)' : 'var(--neon-yellow)',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                  }}
                >
                  {note.text}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.78rem' }}>{error}</div>
      )}
    </div>
  );
}

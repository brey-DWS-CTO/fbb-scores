import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { OWNERS } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchOwnerEmails,
  fetchPins,
  saveOwnerEmail,
  sendOwnerLink,
  setPin,
  type OwnerEmail,
  type PinState,
} from '../../lib/league/api.js';

/** Local time, short. The commissioner only needs to know it happened. */
function usedOn(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? 'used'
    : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const PIN_LABEL: Record<PinState, string> = { set: 'PIN SET', temp: 'TEMP PIN', none: 'NO PIN' };

const badge = (color: string): CSSProperties => ({ color, fontSize: '0.6rem', fontWeight: 800 });

const smallBtn = (color: string, text = color): CSSProperties => ({
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 8,
  border: `2px solid ${color}`,
  background: 'transparent',
  color: text,
  fontSize: '0.7rem',
  fontWeight: 800,
  flexShrink: 0,
});

/**
 * How each owner signs in, commissioner only: their email and their PIN, one
 * row each.
 *
 * Sign-in links go to the address typed here, so a typo locks somebody out.
 * NOT USED YET is the tell: until an owner has signed in through a link, treat
 * the address as a guess.
 *
 * The commissioner can set or clear a PIN but never read one. A new PIN goes
 * to the owner's address with a sign-in link, so nobody passes it on by hand.
 */
export default function SignInAdmin() {
  const { identity } = useIdentity();
  const [emails, setEmails] = useState<OwnerEmail[] | null>(null);
  const [pins, setPins] = useState<Array<{ owner: string; state: PinState }> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState('');
  const [clearArm, setClearArm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** What last happened on each row, kept until that row does something else. */
  const [notes, setNotes] = useState<Record<string, { text: string; ok: boolean }>>({});
  /** Whose action menu is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    Promise.all([fetchOwnerEmails(identity), fetchPins(identity)])
      .then(([emailList, pinList]) => {
        setEmails(emailList);
        setDrafts(Object.fromEntries(emailList.map((row) => [row.owner, row.email])));
        setPins(pinList);
      })
      .catch((caught: unknown) => setError(apiErrorMessage(caught)));
    // Read once. Every write hands back or refetches what it changed.
  }, [identity]);

  if (!identity) return null;

  const emailBy = new Map((emails ?? []).map((row) => [row.owner, row]));
  const pinBy = new Map((pins ?? []).map((row) => [row.owner, row.state]));

  /** One write at a time, with its result shown under that owner's row. */
  const run = async (key: string, owner: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setError(null);
    try {
      const text = await fn();
      if (text) setNotes((all) => ({ ...all, [owner]: { text, ok: !text.startsWith('Saved.') } }));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const clock = () =>
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const saveEmail = (owner: string) =>
    void run(`email-${owner}`, owner, async () => {
      const list = await saveOwnerEmail(identity, owner, (drafts[owner] ?? '').trim());
      setEmails(list);
      setDrafts(Object.fromEntries(list.map((row) => [row.owner, row.email])));
      return `Email saved at ${clock()}.`;
    });

  /**
   * Fire that member's sign-in link at their own inbox. It is the only way to
   * check an address reaches somebody without asking them to try, and it is
   * safe because the link lands in their mail, not the commissioner's.
   */
  const sendLink = (owner: string) => {
    setMenuFor(null);
    const address = emailBy.get(owner)?.email ?? 'their address';
    void run(`link-${owner}`, owner, async () => {
      await sendOwnerLink(identity, owner);
      return `Sign-in link sent to ${address} at ${clock()}.`;
    });
  };

  const savePin = (owner: string, pin: string) => {
    setClearArm(null);
    void run(`pin-${owner}`, owner, async () => {
      const result = await setPin(identity, owner, pin);
      setPins(await fetchPins(identity));
      setPinFor(null);
      setPinDraft('');
      if (pin === '') return `PIN cleared at ${clock()}.`;
      if (result.emailed) {
        return result.logged
          ? `PIN set at ${clock()}; the mail was logged, not sent.`
          : `PIN set and emailed to ${emailBy.get(owner)?.email ?? 'their address'} at ${clock()}.`;
      }
      return `Saved. ${result.reason ?? 'No email went out.'}`;
    });
  };

  const submitPin = (event: FormEvent, owner: string) => {
    event.preventDefault();
    if (/^\d{4,8}$/.test(pinDraft)) savePin(owner, pinDraft);
  };


  return (
    <div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: 10 }}>
        Links go to these addresses. NOT USED YET means it has never signed anyone in, so it
        might be wrong. A PIN you set goes to the owner by email. You will not see it again.
      </div>

      {(emails === null || pins === null) && !error ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {OWNERS.map((owner) => {
            const row = emailBy.get(owner);
            const pinState = pinBy.get(owner) ?? 'none';
            const value = drafts[owner] ?? '';
            const dirty = value.trim() !== (row?.email ?? '');
            const editingPin = pinFor === owner;
            return (
              <div key={owner} style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-hi)', fontSize: '0.8rem' }}>
                    {owner}
                  </span>
                  {row?.confirmedAt ? (
                    <span style={badge('var(--neon-teal)')}>✓ {usedOn(row.confirmedAt)}</span>
                  ) : (
                    <span style={badge('var(--neon-yellow)')}>
                      {row?.email ? 'NOT USED YET' : 'NO EMAIL'}
                    </span>
                  )}
                  <span style={badge(pinState === 'set' ? 'var(--neon-teal)' : 'var(--neon-yellow)')}>
                    {PIN_LABEL[pinState]}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="identity-email-input"
                    style={{ flex: 1, minWidth: 0, height: 44, fontSize: '0.85rem' }}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="nobody@example.com"
                    value={value}
                    aria-label={`Email for ${owner}`}
                    onChange={(event) => setDrafts({ ...drafts, [owner]: event.target.value })}
                  />
                  <button
                    className="tap-btn"
                    type="button"
                    onClick={() => saveEmail(owner)}
                    disabled={busy !== null || !dirty}
                    style={smallBtn(dirty ? 'var(--neon-teal)' : 'var(--panel-border)', dirty ? 'var(--neon-teal)' : 'var(--text-ghost)')}
                  >
                    {busy === `email-${owner}` ? '…' : 'SAVE'}
                  </button>
                  <button
                    className="tap-btn"
                    type="button"
                    onClick={() => {
                      setMenuFor(menuFor === owner ? null : owner);
                      setClearArm(null);
                    }}
                    disabled={busy !== null || editingPin}
                    aria-expanded={menuFor === owner}
                    style={smallBtn(menuFor === owner ? 'var(--neon-teal)' : 'var(--panel-border)', menuFor === owner ? 'var(--neon-teal)' : 'var(--text-mid)')}
                  >
                    {menuFor === owner ? 'CLOSE' : 'ACTIONS'}
                  </button>
                </div>

                {menuFor === owner && !editingPin && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="tap-btn"
                      type="button"
                      onClick={() => sendLink(owner)}
                      disabled={busy !== null || dirty || !row?.email}
                      title={dirty ? 'Save the address first' : `Send ${owner} a sign-in link`}
                      style={smallBtn('var(--neon-teal)', !dirty && row?.email ? 'var(--neon-teal)' : 'var(--text-ghost)')}
                    >
                      {busy === `link-${owner}` ? '…' : 'SEND SIGN-IN LINK'}
                    </button>
                    <button
                      className="tap-btn"
                      type="button"
                      onClick={() => {
                        setPinFor(owner);
                        setPinDraft('');
                        setClearArm(null);
                        setMenuFor(null);
                      }}
                      disabled={busy !== null}
                      style={smallBtn('var(--panel-border)', 'var(--text-mid)')}
                    >
                      SET A NEW PIN
                    </button>
                    <button
                      className="tap-btn"
                      type="button"
                      onClick={() => (clearArm === owner ? savePin(owner, '') : setClearArm(owner))}
                      disabled={busy !== null || pinState === 'none'}
                      style={smallBtn(
                        clearArm === owner ? 'var(--neon-red)' : 'var(--panel-border)',
                        pinState === 'none'
                          ? 'var(--text-ghost)'
                          : clearArm === owner
                            ? 'var(--neon-red)'
                            : 'var(--text-mid)',
                      )}
                    >
                      {busy === `pin-${owner}` ? '…' : clearArm === owner ? 'SURE? CLEAR IT' : 'CLEAR PIN'}
                    </button>
                  </div>
                )}

                {editingPin && (
                  <form style={{ display: 'flex', gap: 8 }} onSubmit={(event) => submitPin(event, owner)}>
                    <input
                      className="identity-email-input"
                      style={{ flex: 1, minWidth: 0, height: 44, fontSize: '0.85rem' }}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={8}
                      placeholder="New PIN, 4 to 8 digits"
                      aria-label={`New PIN for ${owner}`}
                      value={pinDraft}
                      autoFocus
                      onChange={(event) => setPinDraft(event.target.value.replace(/\D/g, ''))}
                    />
                    <button
                      className="tap-btn"
                      type="submit"
                      disabled={busy !== null || !/^\d{4,8}$/.test(pinDraft)}
                      style={smallBtn('var(--neon-teal)')}
                    >
                      {busy === `pin-${owner}` ? '…' : row?.email ? 'SAVE + EMAIL' : 'SAVE'}
                    </button>
                    <button
                      className="tap-btn"
                      type="button"
                      onClick={() => {
                        setPinFor(null);
                        setPinDraft('');
                      }}
                      style={smallBtn('var(--panel-border)', 'var(--text-mid)')}
                    >
                      CANCEL
                    </button>
                  </form>
                )}

                {notes[owner] && (
                  <div
                    role="status"
                    style={{
                      color: notes[owner].ok ? 'var(--neon-teal)' : 'var(--neon-yellow)',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                    }}
                  >
                    {notes[owner].text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.78rem' }}>{error}</div>
      )}
    </div>
  );
}

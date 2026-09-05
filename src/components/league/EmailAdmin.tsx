import { useEffect, useState } from 'react';
import { OWNERS } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchOwnerEmails,
  saveOwnerEmail,
  type OwnerEmail,
} from '../../lib/league/api.js';

/** Local time, short. The commissioner only needs to know it happened. */
function usedOn(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? 'used'
    : when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Owner email addresses, commissioner only. Sign-in links go to whatever is
 * typed here, so a typo locks somebody out. The "not used yet" marker is the
 * tell: until an owner has signed in through a link, treat the address as a
 * guess.
 */
export default function EmailAdmin() {
  const { identity } = useIdentity();
  const [rows, setRows] = useState<OwnerEmail[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) return;
    fetchOwnerEmails(identity)
      .then((list) => {
        setRows(list);
        setDrafts(Object.fromEntries(list.map((row) => [row.owner, row.email])));
      })
      .catch((caught: unknown) => setError(apiErrorMessage(caught)));
    // Read once. Every save hands the whole list back, so nothing else refetches.
  }, [identity]);

  if (!identity) return null;

  const save = async (owner: string) => {
    setBusy(owner);
    setError(null);
    setSaved(null);
    try {
      const list = await saveOwnerEmail(identity, owner, (drafts[owner] ?? '').trim());
      setRows(list);
      setDrafts(Object.fromEntries(list.map((row) => [row.owner, row.email])));
      setSaved(owner);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const byOwner = new Map((rows ?? []).map((row) => [row.owner, row]));

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', marginBottom: 4 }}>
        SIGN-IN EMAILS
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: 10 }}>
        Links go to these addresses. One marked NOT USED YET has never signed anyone in, so it
        might be wrong.
      </div>

      {rows === null && !error ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {OWNERS.map((owner) => {
            const row = byOwner.get(owner);
            const value = drafts[owner] ?? '';
            const dirty = value.trim() !== (row?.email ?? '');
            return (
              <div key={owner} style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-hi)', fontSize: '0.8rem' }}>
                    {owner}
                  </span>
                  {row?.confirmedAt ? (
                    <span style={{ color: 'var(--neon-teal)', fontSize: '0.6rem', fontWeight: 800 }}>
                      ✓ {usedOn(row.confirmedAt)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--neon-yellow)', fontSize: '0.6rem', fontWeight: 800 }}>
                      {row?.email ? 'NOT USED YET' : 'NO EMAIL'}
                    </span>
                  )}
                  {saved === owner && !dirty && (
                    <span style={{ color: 'var(--neon-teal)', fontSize: '0.6rem', fontWeight: 800 }}>
                      SAVED
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="identity-email-input"
                    style={{ flex: 1, height: 44, fontSize: '0.85rem' }}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="nobody@example.com"
                    value={value}
                    aria-label={`Email for ${owner}`}
                    onChange={(event) =>
                      setDrafts({ ...drafts, [owner]: event.target.value })
                    }
                  />
                  <button
                    className="tap-btn"
                    type="button"
                    onClick={() => void save(owner)}
                    disabled={busy !== null || !dirty}
                    style={{
                      minHeight: 44,
                      padding: '0 14px',
                      borderRadius: 8,
                      border: `2px solid ${dirty ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                      background: 'transparent',
                      color: dirty ? 'var(--neon-teal)' : 'var(--text-ghost)',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {busy === owner ? '…' : 'SAVE'}
                  </button>
                </div>
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

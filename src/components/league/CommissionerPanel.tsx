import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  apiErrorMessage,
  fetchPins,
  resetDraft,
  setKeeperVisibility,
  setLocks,
  setPin,
} from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity, useLeagueData } from '../../hooks/useLeague.js';

const btnOutline = (color: string): CSSProperties => ({
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 8,
  border: `2px solid ${color}`,
  background: 'transparent',
  color,
  fontWeight: 800,
  letterSpacing: '0.05em',
});

/** Lock keepers, PIN management, draft reset, TV link — commissioner only. */
export default function CommissionerPanel() {
  const { state, meta } = useLeagueData();
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();

  const [pins, setPins] = useState<Array<{ owner: string; pin: string; temp?: boolean }> | null>(
    null,
  );
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinArm, setPinArm] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [revealArmed, setRevealArmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [commishError, setCommishError] = useState<string | null>(null);

  const locked = state.locks.keepersLocked;
  const revealed = meta?.revealed ?? (state.keepersRevealed === true);
  if (!identity?.isCommissioner) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setCommishError(null);
    try {
      await fn();
    } catch (e) {
      setCommishError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleLock = () =>
    void run('lock', async () => {
      applyState(await setLocks(identity, !locked));
    });

  const openPins = () =>
    void run('pins', async () => {
      setPins(await fetchPins(identity));
      setPinsOpen(true);
    });

  const setReveal = (next: boolean) => {
    setRevealArmed(false);
    void run('reveal', async () => {
      applyState(await setKeeperVisibility(identity, next));
    });
  };

  const resetOwnerPin = (owner: string) => {
    setPinArm(null);
    void run(`pin-${owner}`, async () => {
      // Clear to unclaimed — the owner sets a fresh PIN on their next sign-in
      await setPin(identity, owner, '');
      setPins(await fetchPins(identity));
    });
  };

  const doResetDraft = () => {
    setResetArmed(false);
    void run('reset', async () => {
      applyState(await resetDraft(identity));
    });
  };

  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', marginBottom: 12 }}>
        COMMISH CONTROLS
      </div>

      {/* Lock toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: locked ? 'var(--neon-red)' : 'var(--neon-teal)' }}>
            Keepers are {locked ? 'LOCKED 🔒' : 'OPEN 🔓'}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
            {locked ? 'Only you can still edit keepers.' : 'Owners can edit + save their keepers.'}
          </div>
        </div>
        <button
          className="tap-btn"
          onClick={toggleLock}
          disabled={busy !== null}
          style={{ ...btnOutline(locked ? 'var(--neon-teal)' : 'var(--neon-red)'), flexShrink: 0 }}
        >
          {busy === 'lock' ? '…' : locked ? 'UNLOCK' : 'LOCK'}
        </button>
      </div>

      {/* Keeper visibility */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: revealed ? 'var(--neon-teal)' : 'var(--neon-purple)' }}>
              Keeper names are {revealed ? 'PUBLIC' : 'HIDDEN'}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
              Counts and roster options stay public. Saved names stay private until you reveal them.
            </div>
          </div>
          {revealed ? (
            <button
              className="tap-btn"
              onClick={() => setReveal(false)}
              disabled={busy !== null || state.draft.startedAt !== null}
              style={{ ...btnOutline('var(--neon-purple)'), flexShrink: 0 }}
            >
              {busy === 'reveal' ? '…' : 'HIDE'}
            </button>
          ) : (
            <button
              className="tap-btn"
              onClick={() => setRevealArmed(true)}
              disabled={busy !== null}
              style={{ ...btnOutline('var(--neon-teal)'), flexShrink: 0 }}
            >
              REVEAL
            </button>
          )}
        </div>
        {revealArmed && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: 'var(--neon-yellow)', fontSize: '0.78rem', marginBottom: 8 }}>
              This shows every saved keeper name to the league at once. Ready?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="tap-btn"
                onClick={() => setReveal(true)}
                disabled={busy !== null}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--neon-teal)',
                  color: '#001a14',
                  fontWeight: 800,
                }}
              >
                YES, REVEAL ALL
              </button>
              <button
                className="tap-btn"
                onClick={() => setRevealArmed(false)}
                style={btnOutline('var(--panel-border)')}
              >
                <span style={{ color: 'var(--text-mid)' }}>CANCEL</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PINs */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
        {!pinsOpen ? (
          <button
            className="tap-btn"
            onClick={openPins}
            disabled={busy !== null}
            style={btnOutline('var(--neon-yellow)')}
          >
            {busy === 'pins' ? 'LOADING…' : 'VIEW PINS'}
          </button>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span style={{ color: 'var(--neon-yellow)', fontSize: '0.72rem' }}>
                ⚠ Don't screen-share with these on screen.
              </span>
              <button
                className="tap-btn"
                onClick={() => {
                  setPinsOpen(false);
                  setPinArm(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-mid)',
                  fontSize: '0.75rem',
                  textDecoration: 'underline',
                  minHeight: 32,
                }}
              >
                hide
              </button>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {(pins ?? []).map(({ owner: o, pin, temp }) => (
                <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-hi)' }}>{o}</span>
                  {temp && (
                    <span style={{ color: 'var(--neon-yellow)', fontSize: '0.62rem', fontWeight: 800 }}>
                      TEMP
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: 'monospace',
                      letterSpacing: pin ? '0.2em' : undefined,
                      color: pin ? 'var(--neon-teal)' : 'var(--neon-yellow)',
                      fontSize: pin ? '0.95rem' : '0.72rem',
                    }}
                  >
                    {pin || 'unclaimed'}
                  </span>
                  <button
                    className="tap-btn"
                    onClick={() => (pinArm === o ? resetOwnerPin(o) : setPinArm(o))}
                    disabled={busy !== null || !pin}
                    style={{
                      minHeight: 40,
                      padding: '0 12px',
                      borderRadius: 8,
                      border: `2px solid ${pinArm === o ? 'var(--neon-red)' : 'var(--panel-border)'}`,
                      background: 'transparent',
                      color: !pin ? 'var(--text-ghost)' : pinArm === o ? 'var(--neon-red)' : 'var(--text-mid)',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                    }}
                  >
                    {busy === `pin-${o}` ? '…' : pinArm === o ? 'SURE?' : 'clear'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Reset draft */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
        {!resetArmed ? (
          <button
            className="tap-btn"
            onClick={() => setResetArmed(true)}
            disabled={busy !== null}
            style={btnOutline('var(--neon-red)')}
          >
            RESET DRAFT
          </button>
        ) : (
          <div>
            <div style={{ color: 'var(--neon-red)', fontSize: '0.8rem', marginBottom: 8 }}>
              This wipes every recorded draft pick. No undo. For real?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="tap-btn"
                onClick={doResetDraft}
                disabled={busy !== null}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--neon-red)',
                  color: 'var(--text-max)',
                  fontWeight: 800,
                  letterSpacing: '0.05em',
                }}
              >
                {busy === 'reset' ? 'RESETTING…' : 'YES — WIPE IT'}
              </button>
              <button
                className="tap-btn"
                onClick={() => setResetArmed(false)}
                style={btnOutline('var(--panel-border)')}
              >
                <span style={{ color: 'var(--text-mid)' }}>CANCEL</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {commishError && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.78rem' }}>{commishError}</div>
      )}

      {/* TV mode */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
        <Link
          to="/draft/tv"
          style={{
            color: 'var(--neon-blue)',
            fontSize: '0.85rem',
            textDecoration: 'none',
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 40,
            paddingRight: 12,
          }}
        >
          📺 TV mode
        </Link>
      </div>
    </section>
  );
}

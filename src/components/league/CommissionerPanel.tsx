import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import {
  apiErrorMessage,
  closeDraft,
  reopenDraft,
  resetDraft,
  setKeeperVisibility,
  setLocks,
} from '../../lib/league/api.js';
import { draftYearLabel, tradeableSeason } from '../../lib/league/pickTrades.js';
import { useApplyStateResponse, useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import ActAsPanel from './ActAsPanel.js';
import NavIcon from './NavIcon.js';
import SignInAdmin from './SignInAdmin.js';

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

/** Lock keepers, PINs, draft reset, TV link — commissioner only. */
export default function CommissionerPanel() {
  const { state, meta, dataset } = useLeagueData();
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();

  const [resetArmed, setResetArmed] = useState(false);
  const [closeArmed, setCloseArmed] = useState(false);
  const [revealArmed, setRevealArmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [commishError, setCommishError] = useState<string | null>(null);

  const locked = state.locks.keepersLocked;
  const closed = Boolean(state.draft.closedAt);
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

  const setReveal = (next: boolean) => {
    setRevealArmed(false);
    void run('reveal', async () => {
      applyState(await setKeeperVisibility(identity, next));
    });
  };

  const doResetDraft = () => {
    setResetArmed(false);
    void run('reset', async () => {
      applyState(await resetDraft(identity));
    });
  };

  const doCloseDraft = () => {
    setCloseArmed(false);
    void run('close', async () => {
      applyState(await closeDraft(identity));
    });
  };

  const doReopenDraft = () =>
    void run('close', async () => {
      applyState(await reopenDraft(identity));
    });

  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', marginBottom: 12 }}>
        COMMISH CONTROLS
      </div>

      {/* Lock toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 700,
              color: locked ? 'var(--neon-red)' : 'var(--neon-teal)',
            }}
          >
            Keepers are {locked ? 'LOCKED' : 'OPEN'}
            <NavIcon name={locked ? 'lock' : 'unlocked'} size={15} />
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

      {/* Sign-in: each owner's email and PIN */}
      <ActAsPanel />
      <details className="commish-fold commish-fold-inner">
        <summary className="hub-heading">
          SIGN-IN
          <small>Each owner&apos;s email and PIN</small>
        </summary>
        <SignInAdmin />
      </details>

      {/* Close the draft — this is what opens next season's pick trades */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
        <div style={{ fontWeight: 700, color: closed ? 'var(--neon-teal)' : 'var(--text-max)' }}>
          Draft is {closed ? 'FINISHED' : 'ON'}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: 8 }}>
          Teams can trade {draftYearLabel(tradeableSeason(state, dataset))} picks.
        </div>
        {closed ? (
          <button
            className="tap-btn"
            onClick={doReopenDraft}
            disabled={busy !== null}
            style={btnOutline('var(--neon-yellow)')}
          >
            {busy === 'close' ? '…' : 'REOPEN THE DRAFT'}
          </button>
        ) : !closeArmed ? (
          <button
            className="tap-btn"
            onClick={() => setCloseArmed(true)}
            disabled={busy !== null || state.draft.startedAt === null}
            style={btnOutline('var(--neon-teal)')}
          >
            CLOSE THE DRAFT
          </button>
        ) : (
          <div>
            <div style={{ color: 'var(--neon-yellow)', fontSize: '0.78rem', marginBottom: 8 }}>
              This ends trading for {draftYearLabel(dataset.season)} picks and opens{' '}
              {draftYearLabel(dataset.season + 1)} picks. You can undo it.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="tap-btn"
                onClick={doCloseDraft}
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
                {busy === 'close' ? 'CLOSING…' : 'YES — IT IS DONE'}
              </button>
              <button
                className="tap-btn"
                onClick={() => setCloseArmed(false)}
                style={btnOutline('var(--panel-border)')}
              >
                <span style={{ color: 'var(--text-mid)' }}>CANCEL</span>
              </button>
            </div>
          </div>
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
          <NavIcon name="tv" size={16} />
          <span style={{ marginLeft: 6 }}>TV mode</span>
        </Link>
      </div>
    </section>
  );
}

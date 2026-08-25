import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { apiErrorMessage, clearDraftPick, submitDraftPick } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import PlayerCombobox from '../league/PlayerCombobox.js';
import { positionColor } from './boardUtils.js';

function SheetShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
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
          maxWidth: 560,
          maxHeight: '70vh',
          overflowY: 'auto',
          borderRadius: '12px 12px 0 0',
          padding: '16px 16px calc(16px + env(safe-area-inset-bottom))',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function CancelButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      className="tap-btn"
      onClick={onClose}
      style={{
        width: '100%',
        marginTop: 12,
        padding: '10px 0',
        background: 'transparent',
        border: '2px solid var(--panel-border)',
        borderRadius: 8,
        color: '#8888aa',
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      Cancel
    </button>
  );
}

interface PickSheetProps {
  cell: BoardCell;
  pool: DatasetPlayer[];
  onClose: () => void;
}

/** Bottom sheet for entering a live draft pick into an empty cell. */
export default function PickSheet({ cell, pool, onClose }: PickSheetProps) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [chosen, setChosen] = useState<DatasetPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...pool].sort(
        (a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1),
      ),
    [pool],
  );

  const confirm = async () => {
    if (!identity || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitDraftPick(identity, {
        overallPick: cell.pick.overall,
        playerKey: chosen.key,
        playerName: chosen.name,
      });
      applyState(res);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetShell onClose={onClose}>
      <div className="hub-heading glow-teal" style={{ fontSize: '0.7rem', color: 'var(--neon-teal)', marginBottom: 4 }}>
        PICK {pickLabel(cell.pick)} — {cell.pick.currentOwner.toUpperCase()}
      </div>
      <div style={{ color: '#8888aa', fontSize: '0.8rem', marginBottom: 12 }}>
        #{cell.pick.overall} overall
        {cell.pick.viaTradeFrom && (
          <span style={{ color: 'var(--neon-yellow)' }}> · via {cell.pick.viaTradeFrom}</span>
        )}
      </div>

      {!chosen ? (
        <div style={{ minHeight: '42vh' }}>
          <PlayerCombobox
            players={sorted}
            autoFocus
            placeholder="Who's the pick?"
            onSelect={(p) => {
              setChosen(p);
              setError(null);
            }}
            renderMeta={(p) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#e0e0e0', fontWeight: 700, fontSize: '0.85rem' }}>
                  {p.keeper.effectiveAvg !== null ? p.keeper.effectiveAvg.toFixed(1) : '—'}
                </span>
                {p.keeper.round !== null && p.keeper.round <= 10 && (
                  <span
                    style={{
                      color: '#aaaacc',
                      border: '1px solid #2a2a4d',
                      background: '#121222',
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                    }}
                  >
                    R{p.keeper.round}
                  </span>
                )}
                {(p.injuryStatus === 'OUT' || p.injuryStatus === 'SUSPENSION') && (
                  <span
                    style={{
                      color: 'var(--neon-red)',
                      border: '1px solid var(--neon-red)',
                      borderRadius: 4,
                      padding: '1px 4px',
                      fontSize: '0.6rem',
                      fontWeight: 800,
                    }}
                  >
                    {p.injuryStatus === 'OUT' ? 'OUT' : 'SUSP'}
                  </span>
                )}
              </span>
            )}
          />
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: positionColor(chosen.positions) }}>
            {chosen.name}
          </div>
          <div style={{ color: '#8888aa', margin: '4px 0 14px' }}>
            {chosen.proTeam} · {chosen.positions.join('/')}
            {chosen.keeper.effectiveAvg !== null && <> · {chosen.keeper.effectiveAvg.toFixed(1)} FPPG</>}
          </div>
          <button
            className="tap-btn"
            onClick={confirm}
            disabled={busy}
            style={{
              width: '100%',
              padding: 14,
              background: busy ? '#1a1a33' : 'var(--neon-teal)',
              color: busy ? '#666688' : '#001a14',
              fontWeight: 800,
              fontSize: '1rem',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {busy ? 'SUBMITTING…' : 'CONFIRM PICK'}
          </button>
          <button
            className="tap-btn"
            onClick={() => setChosen(null)}
            style={{
              marginTop: 10,
              background: 'transparent',
              border: 'none',
              color: '#8888aa',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            pick someone else
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.85rem' }}>{error}</div>
      )}
      <CancelButton onClose={onClose} />
    </SheetShell>
  );
}

/** Commissioner action sheet: clear a live (non-keeper) pick off the board. */
export function ClearPickSheet({ cell, onClose }: { cell: BoardCell; onClose: () => void }) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = async () => {
    if (!identity || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await clearDraftPick(identity, cell.pick.overall);
      applyState(res);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetShell onClose={onClose}>
      <div className="hub-heading" style={{ fontSize: '0.7rem', color: 'var(--neon-yellow)', marginBottom: 4 }}>
        PICK {pickLabel(cell.pick)} — {cell.pick.currentOwner.toUpperCase()}
      </div>
      <div style={{ color: '#e0e0e0', fontSize: '1.05rem', fontWeight: 700, marginBottom: 12 }}>
        {cell.selection?.playerName ?? 'Unknown player'}
        <span style={{ color: '#666688', fontWeight: 400, fontSize: '0.8rem' }}>
          {' '}· #{cell.pick.overall} overall
        </span>
      </div>
      <button
        className="tap-btn"
        onClick={clear}
        disabled={busy}
        style={{
          width: '100%',
          padding: 13,
          background: busy ? '#1a1a33' : 'rgba(255,34,34,0.12)',
          color: busy ? '#666688' : 'var(--neon-red)',
          border: '2px solid var(--neon-red)',
          borderRadius: 8,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        {busy ? 'CLEARING…' : 'CLEAR THIS PICK'}
      </button>
      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.85rem' }}>{error}</div>
      )}
      <CancelButton onClose={onClose} />
    </SheetShell>
  );
}

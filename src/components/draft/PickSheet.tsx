import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { apiErrorMessage, clearDraftPick, submitDraftPick } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import { usePostseasonGames } from '../../hooks/usePostseasonGames.js';
import PostseasonTag from '../league/PostseasonTag.js';
import { POSITION_ORDER, positionTheme } from './boardUtils.js';

function SheetShell({
  onClose,
  titleId,
  children,
}: {
  onClose: () => void;
  titleId: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onKeyDown);
      priorFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="presentation"
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '88dvh',
          overflow: 'hidden',
          borderRadius: '16px 16px 0 0',
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
        color: 'var(--text-mid)',
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

type PositionFilter = 'ALL' | (typeof POSITION_ORDER)[number];

/** Bottom sheet for entering a live draft pick into an empty cell. */
export default function PickSheet({ cell, pool, onClose }: PickSheetProps) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const postseasonGames = usePostseasonGames();
  const [chosen, setChosen] = useState<DatasetPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PositionFilter>('ALL');

  const alphabetical = useMemo(
    () =>
      [...pool].sort((a, b) => {
        const nameA = a.fullName ?? a.name;
        const nameB = b.fullName ?? b.name;
        return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key);
      }),
    [pool],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return alphabetical
      .filter((player) => position === 'ALL' || player.positions.includes(position))
      .filter((player) => {
        if (!q) return true;
        return [player.name, player.fullName ?? '', player.proTeam, ...player.positions]
          .some((value) => value.toLocaleLowerCase().includes(q));
      });
  }, [alphabetical, position, query]);

  const chosenTheme = positionTheme(chosen?.positions);

  const confirm = async () => {
    if (!identity || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitDraftPick(identity, {
        overallPick: cell.pick.overall,
        playerKey: chosen.key,
        playerName: chosen.name,
        proTeam: chosen.proTeam,
        positions: chosen.positions,
      });
      applyState(res);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <SheetShell onClose={onClose} titleId="pick-sheet-title">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            id="pick-sheet-title"
            className="hub-heading glow-teal"
            style={{ fontSize: '0.7rem', color: 'var(--neon-teal)', marginBottom: 4 }}
          >
            PICK {pickLabel(cell.pick)} · {cell.pick.currentOwner.toUpperCase()}
          </div>
          <div style={{ color: 'var(--text-mid)', fontSize: '0.8rem' }}>
            #{cell.pick.overall} overall
            {cell.pick.viaTradeFrom && (
              <span style={{ color: 'var(--neon-yellow)' }}> · via {cell.pick.viaTradeFrom}</span>
            )}
          </div>
        </div>
        <button
          className="tap-btn"
          type="button"
          aria-label="Close player picker"
          onClick={onClose}
          style={{
            width: 38,
            height: 38,
            border: '1px solid var(--panel-border)',
            borderRadius: '50%',
            background: 'var(--chip-bg)',
            color: 'var(--text-hi)',
            fontSize: '1.35rem',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {!chosen ? (
        <div style={{ display: 'flex', minHeight: 0, flexDirection: 'column' }}>
          <label style={{ position: 'relative', display: 'block', marginBottom: 10 }}>
            <span className="sr-only">Search available players</span>
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 13,
                top: '50%',
                color: 'var(--text-mid)',
                fontSize: '1rem',
                transform: 'translateY(-50%)',
              }}
            >
              ⌕
            </span>
            <input
              className="hub-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search available players"
              aria-label="Search available players"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              style={{ width: '100%', minHeight: 48, padding: '11px 42px', fontSize: '0.95rem' }}
            />
            {query && (
              <button
                className="tap-btn"
                type="button"
                aria-label="Clear player search"
                onClick={() => setQuery('')}
                style={{
                  position: 'absolute',
                  right: 7,
                  top: '50%',
                  width: 32,
                  height: 32,
                  border: 0,
                  borderRadius: '50%',
                  background: 'transparent',
                  color: 'var(--text-mid)',
                  fontSize: '1.1rem',
                  transform: 'translateY(-50%)',
                }}
              >
                ×
              </button>
            )}
          </label>

          <div
            aria-label="Filter players by position"
            style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' }}
          >
            {(['ALL', ...POSITION_ORDER] as const).map((filter) => {
              const active = position === filter;
              const theme = filter === 'ALL' ? null : positionTheme([filter]);
              return (
                <button
                  key={filter}
                  className="tap-btn"
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPosition(filter)}
                  style={{
                    minWidth: filter === 'ALL' ? 54 : 44,
                    minHeight: 36,
                    padding: '6px 12px',
                    border: `1px solid ${active ? theme?.border ?? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                    borderRadius: 999,
                    background: active ? theme?.deepBackground ?? 'rgba(0,255,204,0.1)' : 'var(--chip-bg)',
                    color: active ? theme?.color ?? 'var(--neon-teal)' : 'var(--text-mid)',
                    fontWeight: 800,
                  }}
                >
                  {filter}
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              padding: '0 2px 7px',
              color: 'var(--text-dim)',
              fontSize: '0.68rem',
              fontWeight: 700,
            }}
          >
            <span>{filtered.length} AVAILABLE</span>
            <span>NAME A–Z</span>
          </div>

          <div
            aria-label="Available players"
            style={{
              minHeight: '34vh',
              maxHeight: '52vh',
              overflowY: 'auto',
              border: '1px solid var(--panel-border)',
              borderRadius: 10,
              background: 'var(--input-bg)',
            }}
          >
            {filtered.length === 0 && (
              <div style={{ padding: '32px 16px', color: 'var(--text-mid)', textAlign: 'center' }}>
                No available players match this filter.
              </div>
            )}
            {filtered.map((player) => {
              const theme = positionTheme(player.positions);
              const postseason = postseasonGames(player.proTeam);
              return (
                <button
                  key={player.key}
                  className="tap-btn"
                  type="button"
                  aria-label={`Select ${player.fullName ?? player.name}`}
                  onClick={() => {
                    setChosen(player);
                    setError(null);
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '5px minmax(0, 1fr) auto',
                    alignItems: 'stretch',
                    gap: 0,
                    width: '100%',
                    minHeight: 62,
                    padding: 0,
                    border: 0,
                    borderBottom: '1px solid var(--panel-border)',
                    background: 'transparent',
                    color: 'var(--text-hi)',
                    textAlign: 'left',
                  }}
                >
                  <span aria-hidden="true" style={{ background: theme.color }} />
                  <span style={{ minWidth: 0, padding: '11px 12px' }}>
                    <span
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        color: 'var(--text-max)',
                        fontWeight: 800,
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {player.fullName ?? player.name}
                    </span>
                    <span style={{ display: 'block', marginTop: 3, color: 'var(--text-mid)', fontSize: '0.76rem' }}>
                      <strong style={{ color: theme.color }}>{player.positions.join(' / ') || '—'}</strong>
                      {' · '}{player.proTeam.toUpperCase()}
                      {postseason && (
                        <>
                          {' · '}
                          <PostseasonTag games={postseason} />
                        </>
                      )}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    style={{ alignSelf: 'center', paddingRight: 14, color: 'var(--text-faint)', fontSize: '1.1rem' }}
                  >
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '18px 0 4px' }}>
          <div
            style={{
              marginBottom: 16,
              padding: '24px 16px',
              border: `1px solid ${chosenTheme.border}`,
              borderRadius: 12,
              background: `linear-gradient(145deg, ${chosenTheme.background}, ${chosenTheme.deepBackground})`,
            }}
          >
            <div style={{ fontSize: '1.55rem', fontWeight: 800, color: '#fff' }}>
              {chosen.fullName ?? chosen.name}
            </div>
            <div style={{ color: '#d9d9e7', marginTop: 6 }}>
              <strong style={{ color: chosenTheme.color }}>
                {chosen.positions.join(' / ') || '—'}
              </strong>
              {' · '}{chosen.proTeam.toUpperCase()}
            </div>
          </div>
          <button
            className="tap-btn"
            onClick={confirm}
            disabled={busy}
            style={{
              width: '100%',
              padding: 14,
              background: busy ? 'var(--panel-border)' : 'var(--neon-teal)',
              color: busy ? 'var(--text-dim)' : '#001a14',
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
              color: 'var(--text-mid)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Back to players
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.85rem' }}>{error}</div>
      )}
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
    <SheetShell onClose={onClose} titleId="clear-pick-title">
      <div id="clear-pick-title" className="hub-heading" style={{ fontSize: '0.7rem', color: 'var(--neon-yellow)', marginBottom: 4 }}>
        PICK {pickLabel(cell.pick)} — {cell.pick.currentOwner.toUpperCase()}
      </div>
      <div style={{ color: 'var(--text-hi)', fontSize: '1.05rem', fontWeight: 700, marginBottom: 12 }}>
        {cell.selection?.playerName ?? 'Unknown player'}
        <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: '0.8rem' }}>
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
          background: busy ? 'var(--panel-border)' : 'rgba(255,34,34,0.12)',
          color: busy ? 'var(--text-dim)' : 'var(--neon-red)',
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

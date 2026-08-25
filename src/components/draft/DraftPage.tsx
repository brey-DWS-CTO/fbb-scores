import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BoardCell } from '../../lib/keeper/types.js';
import { availablePlayers, buildDraftBoard, pickLabel } from '../../lib/keeper/engine.js';
import { leagueDataset, teamByOwner } from '../../lib/league/data.js';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import IdentityChip from '../league/IdentityChip.js';
import TeamPickerModal from '../league/TeamPickerModal.js';
import BoardGrid from './BoardGrid.js';
import PickSheet, { ClearPickSheet } from './PickSheet.js';
import { cellDisplay, positionColor, recentPicks } from './boardUtils.js';

function PosChip({ positions }: { positions: string[] }) {
  if (positions.length === 0) return null;
  const color = positionColor(positions);
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}55`,
        background: `${color}18`,
        borderRadius: 4,
        padding: '1px 5px',
        fontSize: '0.65rem',
        fontWeight: 700,
      }}
    >
      {positions.join('/')}
    </span>
  );
}

function PickRow({
  cell,
  tappable,
  onTap,
}: {
  cell: BoardCell;
  tappable: boolean;
  onTap: (cell: BoardCell) => void;
}) {
  const d = cellDisplay(cell);
  return (
    <div
      className={cell.onClock ? 'pulse-glow' : undefined}
      onClick={tappable ? () => onTap(cell) : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        borderBottom: '1px solid var(--panel-border)',
        boxShadow: d ? `inset 3px 0 0 ${d.color}` : undefined,
        background: cell.onClock
          ? 'rgba(0,255,204,0.06)'
          : d
            ? `${d.color}${d.isKeeper ? '0e' : '18'}`
            : 'transparent',
        outline: cell.onClock ? '2px solid var(--neon-teal)' : undefined,
        outlineOffset: cell.onClock ? -2 : undefined,
        cursor: tappable ? 'pointer' : 'default',
      }}
    >
      <div style={{ minWidth: 46, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#e0e0e0' }}>
          {pickLabel(cell.pick)}
        </div>
        <div style={{ fontSize: '0.65rem', color: '#666688' }}>#{cell.pick.overall}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.7rem', color: '#8888aa', fontWeight: 600 }}>
            {cell.pick.currentOwner}
          </span>
          {cell.pick.viaTradeFrom && (
            <span style={{ color: 'var(--neon-yellow)', fontSize: '0.65rem' }}>
              via {cell.pick.viaTradeFrom}
            </span>
          )}
        </div>
        {cell.keeper && d ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', opacity: 0.8 }}>
            <span style={{ fontWeight: 700 }}>🔒 {d.name}</span>
            <span
              style={{
                color: d.color,
                border: `1px solid ${d.color}66`,
                background: `${d.color}14`,
                borderRadius: 4,
                padding: '1px 6px',
                fontSize: '0.65rem',
                fontWeight: 700,
              }}
            >
              KEEPER · R{d.keeperRound ?? '?'}
            </span>
          </div>
        ) : d ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{d.name}</span>
            <PosChip positions={d.positions} />
            {d.enteredBy && (
              <span style={{ color: '#666688', fontSize: '0.65rem' }}>by {d.enteredBy}</span>
            )}
          </div>
        ) : (
          <div
            style={{
              color: cell.onClock ? 'var(--neon-teal)' : '#444466',
              fontWeight: cell.onClock ? 700 : 400,
            }}
          >
            {cell.onClock ? 'ON THE CLOCK' : '—'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DraftPage() {
  const { state } = useLeagueState(true);
  const { identity } = useIdentity();
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [pickTarget, setPickTarget] = useState<BoardCell | null>(null);
  const [clearTarget, setClearTarget] = useState<BoardCell | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);

  const board = useMemo(() => buildDraftBoard(leagueDataset, state), [state]);
  const pool = useMemo(() => availablePlayers(leagueDataset, state), [state]);
  const recent = useMemo(() => recentPicks(board, 5), [board]);

  const onClockIdx = board.findIndex((c) => c.onClock);
  const onClock = onClockIdx >= 0 ? board[onClockIdx] : null;
  const nextUp = onClock
    ? board.slice(onClockIdx + 1).filter((c) => !c.selection && !c.keeper).slice(0, 3)
    : [];

  const rounds = useMemo(
    () => Array.from({ length: leagueDataset.draftRounds }, (_, i) => i + 1),
    [],
  );

  const onCellTap = (cell: BoardCell) => {
    if (cell.keeper) return;
    if (cell.selection) {
      if (identity?.isCommissioner) setClearTarget(cell);
      return;
    }
    if (!identity) {
      setShowSignIn(true);
      return;
    }
    setPickTarget(cell);
  };

  const isTappable = (cell: BoardCell): boolean => {
    if (cell.keeper) return false;
    if (cell.selection) return identity?.isCommissioner === true;
    return true; // empty: tap picks (or opens sign-in when signed out)
  };

  return (
    <div
      style={{
        padding: '12px 12px 24px',
        maxWidth: view === 'grid' ? 1100 : 720,
        margin: '0 auto',
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', flex: 1 }}>
          2027 DRAFT
        </div>
        <IdentityChip />
        <Link
          to="/draft/tv"
          className="tap-btn"
          style={{
            padding: '6px 12px',
            border: '2px solid var(--neon-purple)',
            borderRadius: 999,
            color: 'var(--neon-purple)',
            textDecoration: 'none',
            fontSize: '0.8rem',
            fontWeight: 700,
          }}
        >
          📺 TV
        </Link>
      </div>

      {/* ON THE CLOCK hero */}
      <div
        className={`panel ${onClock ? 'pulse-glow' : ''}`}
        style={{
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 12,
          border: onClock ? '2px solid var(--neon-teal)' : undefined,
        }}
      >
        {onClock ? (
          <>
            <div className="hub-heading blink" style={{ fontSize: '0.62rem', color: 'var(--neon-yellow)' }}>
              ON THE CLOCK
            </div>
            <div
              className="hub-heading glow-teal"
              style={{ fontSize: 'clamp(1rem, 6vw, 1.6rem)', color: 'var(--neon-teal)', margin: '8px 0 2px' }}
            >
              {onClock.pick.currentOwner.toUpperCase()}
            </div>
            <div style={{ color: '#666688', fontSize: '0.75rem', marginBottom: 4 }}>
              {teamByOwner.get(onClock.pick.currentOwner)?.espnTeamName}
            </div>
            <div style={{ color: '#aaaacc' }}>
              Pick {pickLabel(onClock.pick)} · #{onClock.pick.overall} overall
              {onClock.pick.viaTradeFrom && (
                <span style={{ color: 'var(--neon-yellow)' }}> · via {onClock.pick.viaTradeFrom}</span>
              )}
            </div>
            {nextUp.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.65rem', color: '#666688', fontWeight: 700 }}>NEXT:</span>
                {nextUp.map((c) => (
                  <span
                    key={c.pick.overall}
                    style={{
                      border: '1px solid var(--panel-border)',
                      background: '#0c0c16',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      color: '#aaaacc',
                    }}
                  >
                    {c.pick.currentOwner} · {pickLabel(c.pick)}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div
            className="hub-heading glow-yellow"
            style={{ fontSize: '0.9rem', color: 'var(--neon-yellow)', textAlign: 'center', padding: '10px 0' }}
          >
            DRAFT COMPLETE 🏆
          </div>
        )}
      </div>

      {/* recent picks ticker */}
      {recent.length > 0 && (
        <div className="panel" style={{ borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <div className="hub-heading" style={{ fontSize: '0.62rem', color: '#8888aa', marginBottom: 6 }}>
            RECENT PICKS
          </div>
          {recent.map((rp) => (
            <div key={rp.overall} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: '0.9rem' }}>
              <span style={{ color: '#666688', minWidth: 40 }}>#{rp.overall}</span>
              <span style={{ color: '#aaaacc' }}>{rp.owner}</span>
              <span style={{ color: '#666688' }}>→</span>
              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {rp.playerName}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* view toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['list', 'grid'] as const).map((v) => (
          <button
            key={v}
            className="tap-btn hub-heading"
            onClick={() => setView(v)}
            style={{
              flex: 1,
              padding: '9px 0',
              fontSize: '0.62rem',
              background: view === v ? 'rgba(0,255,204,0.1)' : 'var(--panel-bg)',
              color: view === v ? 'var(--neon-teal)' : '#8888aa',
              border: `2px solid ${view === v ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>

      {view === 'list' ? (
        rounds.map((r) => (
          <section key={r}>
            <div
              className="hub-heading"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 20,
                background: 'rgba(10,10,15,0.96)',
                backdropFilter: 'blur(4px)',
                padding: '10px 4px 6px',
                fontSize: '0.6rem',
                color: 'var(--neon-teal)',
              }}
            >
              ROUND {r}
            </div>
            <div className="panel" style={{ borderRadius: 8, marginBottom: 4 }}>
              {board
                .filter((c) => c.pick.round === r)
                .map((cell) => (
                  <PickRow
                    key={cell.pick.overall}
                    cell={cell}
                    tappable={isTappable(cell)}
                    onTap={onCellTap}
                  />
                ))}
            </div>
          </section>
        ))
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8 }}>
          <BoardGrid board={board} />
        </div>
      )}

      {showSignIn && <TeamPickerModal onClose={() => setShowSignIn(false)} />}
      {pickTarget && (
        <PickSheet cell={pickTarget} pool={pool} onClose={() => setPickTarget(null)} />
      )}
      {clearTarget && <ClearPickSheet cell={clearTarget} onClose={() => setClearTarget(null)} />}
    </div>
  );
}

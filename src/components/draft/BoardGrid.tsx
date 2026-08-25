import { Fragment, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { BoardCell } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { leagueDataset, OWNERS } from '../../lib/league/data.js';
import { cellDisplay } from './boardUtils.js';

interface Props {
  board: BoardCell[];
  /** TV mode: fill the parent's height exactly (rows 1fr), viewport-scaled fonts. */
  tv?: boolean;
}

/**
 * The classic wall board: 10 team columns (draft order) x 14 round rows,
 * with an owner header row and a round-number rail.
 */
export default function BoardGrid({ board, tv = false }: Props) {
  const cellMap = useMemo(() => {
    const m = new Map<string, BoardCell>();
    for (const c of board) m.set(`${c.pick.round}:${c.pick.originalOwner}`, c);
    return m;
  }, [board]);

  const rounds = useMemo(
    () => Array.from({ length: leagueDataset.draftRounds }, (_, i) => i + 1),
    [],
  );

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${tv ? 'minmax(26px, 3vw)' : '30px'} repeat(${OWNERS.length}, minmax(0, 1fr))`,
        gridTemplateRows: tv ? `auto repeat(${rounds.length}, minmax(0, 1fr))` : undefined,
        gap: 3,
        height: tv ? '100%' : undefined,
        minWidth: 900,
      }}
    >
      {/* header row */}
      <div />
      {OWNERS.map((o) => (
        <div
          key={o}
          className="hub-heading"
          style={{
            fontSize: tv ? 'clamp(0.55rem, 0.9vw, 0.8rem)' : '0.6rem',
            color: 'var(--neon-teal)',
            textAlign: 'center',
            alignSelf: 'center',
            padding: '4px 2px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {o.toUpperCase()}
        </div>
      ))}
      {/* round rows */}
      {rounds.map((r) => (
        <Fragment key={r}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666688',
              fontWeight: 700,
              fontSize: tv ? 'clamp(10px, 1.4vh, 16px)' : '0.75rem',
            }}
          >
            {r}
          </div>
          {OWNERS.map((o) => (
            <GridCell key={o} cell={cellMap.get(`${r}:${o}`)} tv={tv} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function GridCell({ cell, tv }: { cell?: BoardCell; tv: boolean }) {
  if (!cell) return <div />;
  const d = cellDisplay(cell);
  const traded = cell.pick.viaTradeFrom;

  const style: CSSProperties = {
    position: 'relative',
    minWidth: 0,
    minHeight: tv ? 0 : 46,
    borderRadius: 3,
    padding: tv ? '1px 5px' : '4px 5px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    overflow: 'hidden',
    border: `1px solid ${d ? 'transparent' : '#14142a'}`,
    background: d ? `${d.color}18` : '#0b0b13',
    // position accent as an inset bar (avoids border shorthand/longhand mixing)
    boxShadow: d ? `inset 3px 0 0 ${d.color}` : undefined,
    opacity: d?.isKeeper ? 0.85 : 1,
  };
  if (cell.onClock) {
    style.outline = '2px solid var(--neon-teal)';
    style.outlineOffset = -2;
    style.background = 'rgba(0,255,204,0.06)';
  }

  return (
    <div className={cell.onClock ? 'pulse-glow' : undefined} style={style}>
      {traded && (
        <span
          title={`via ${traded} → ${cell.pick.currentOwner}`}
          style={{
            position: 'absolute',
            top: 0,
            right: 2,
            color: 'var(--neon-yellow)',
            fontSize: tv ? 'clamp(7px, 0.7vw, 11px)' : 8,
            lineHeight: 1.4,
          }}
        >
          ▲
        </span>
      )}
      {d ? (
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontWeight: 600,
            color: '#e8e8f0',
            fontSize: tv ? 'clamp(10px, 1.1vw, 18px)' : '0.72rem',
            lineHeight: 1.2,
            wordBreak: 'break-word',
          }}
        >
          {d.isKeeper ? '🔒 ' : ''}
          {d.name}
        </span>
      ) : cell.onClock ? (
        <span
          style={{
            color: 'var(--neon-teal)',
            fontWeight: 700,
            fontSize: tv ? 'clamp(9px, 0.9vw, 14px)' : '0.65rem',
          }}
        >
          {pickLabel(cell.pick)} ⏱
        </span>
      ) : tv ? (
        <>
          <span style={{ color: '#2e2e52', fontSize: 'clamp(9px, 0.9vw, 14px)', lineHeight: 1.2 }}>
            {pickLabel(cell.pick)}
          </span>
          {traded && (
            <span
              style={{
                color: 'var(--neon-yellow)',
                opacity: 0.65,
                fontSize: 'clamp(8px, 0.8vw, 12px)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {cell.pick.currentOwner}
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}

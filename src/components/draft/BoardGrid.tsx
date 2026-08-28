import { Fragment, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BoardCell } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { leagueDataset, OWNERS } from '../../lib/league/data.js';
import { cellDisplay, positionTheme } from './boardUtils.js';

interface Props {
  board: BoardCell[];
  /** TV mode: fill the parent's height exactly (rows 1fr), viewport-scaled fonts. */
  tv?: boolean;
}

interface TradeTip {
  cell: BoardCell;
  x: number;
  y: number;
}

/** Styled hover/tap popover explaining where a traded pick came from. */
function TradeTooltip({ tip }: { tip: TradeTip }) {
  const pick = tip.cell.pick;
  const detail = (leagueDataset.tradeDetails ?? []).find(
    (t) =>
      t.date === pick.tradeDate &&
      t.teams.includes(pick.currentOwner) &&
      t.teams.includes(pick.viaTradeFrom ?? ''),
  );
  const width = 300;
  const left = Math.min(Math.max(8, tip.x - width / 2), window.innerWidth - width - 8);
  const top = Math.min(tip.y + 14, window.innerHeight - 220);
  return (
    <div
      className="panel"
      style={{
        position: 'fixed',
        left,
        top,
        width,
        zIndex: 300,
        borderRadius: 10,
        borderColor: 'var(--neon-yellow)',
        padding: '10px 12px',
        pointerEvents: 'none',
        boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <span style={{ color: 'var(--neon-yellow)', fontWeight: 800, fontSize: '0.78rem' }}>
          ▲ TRADED PICK {pickLabel(pick)}
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{pick.tradeDate}</span>
      </div>
      <div style={{ color: 'var(--text-hi)', fontSize: '0.8rem', marginBottom: detail ? 8 : 0 }}>
        <strong>{pick.currentOwner}</strong> owns <strong>{pick.viaTradeFrom}</strong>'s R
        {pick.round} pick
      </div>
      {detail ? (
        <div style={{ display: 'grid', gap: 5 }}>
          {detail.teams.map((teamName) => (
            <div key={teamName} style={{ fontSize: '0.72rem', lineHeight: 1.4 }}>
              <span style={{ color: 'var(--neon-teal)', fontWeight: 800 }}>{teamName} got: </span>
              <span style={{ color: 'var(--text-body)' }}>
                {(detail.received[teamName] ?? []).join(', ')}
              </span>
            </div>
          ))}
        </div>
      ) : (
        pick.tradeNote && (
          <div style={{ color: 'var(--text-body)', fontSize: '0.72rem' }}>{pick.tradeNote}</div>
        )
      )}
    </div>
  );
}

/**
 * The classic wall board: 10 team columns (draft order) x 14 round rows,
 * with an owner header row and a round-number rail.
 */
export default function BoardGrid({ board, tv = false }: Props) {
  const [tip, setTip] = useState<TradeTip | null>(null);

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
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-dim)',
              fontWeight: 800,
              fontSize: tv ? 'clamp(9px, 1.2vh, 14px)' : '0.68rem',
              lineHeight: 1.2,
            }}
          >
            <span>R{r}</span>
            <span style={{ color: 'var(--text-faint)' }}>{r % 2 === 1 ? '→' : '←'}</span>
          </div>
          {OWNERS.map((o) => (
            <GridCell
              key={o}
              cell={cellMap.get(`${r}:${o}`)}
              tv={tv}
              onTradeShow={(cell, x, y) => setTip({ cell, x, y })}
              onTradeHide={() => setTip(null)}
              tipShownFor={tip?.cell.pick.overall ?? null}
            />
          ))}
        </Fragment>
      ))}
      {tip && <TradeTooltip tip={tip} />}
    </div>
  );
}

function GridCell({
  cell,
  tv,
  onTradeShow,
  onTradeHide,
  tipShownFor,
}: {
  cell?: BoardCell;
  tv: boolean;
  onTradeShow: (cell: BoardCell, x: number, y: number) => void;
  onTradeHide: () => void;
  tipShownFor: number | null;
}) {
  if (!cell) return <div />;
  const d = cellDisplay(cell);
  const theme = positionTheme(d?.positions);
  const traded = cell.pick.viaTradeFrom;

  const style: CSSProperties = {
    position: 'relative',
    minWidth: 0,
    minHeight: tv ? 0 : 46,
    borderRadius: 5,
    padding: tv ? '1px 6px' : '4px 6px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    overflow: 'hidden',
    border: `1px solid ${d ? theme.border : 'var(--cell-border)'}`,
    background: d
      ? `linear-gradient(155deg, ${theme.background} 0%, ${theme.deepBackground} 100%)`
      : 'var(--cell-bg)',
    // position accent as an inset bar (avoids border shorthand/longhand mixing)
    boxShadow: d ? `inset 3px 0 0 ${d.color}` : undefined,
  };
  if (cell.onClock) {
    style.outline = '2px solid var(--neon-teal)';
    style.outlineOffset = -2;
    style.background = 'rgba(0,255,204,0.06)';
  }

  const tradeHandlers = traded
    ? {
        onMouseEnter: (e: React.MouseEvent) => onTradeShow(cell, e.clientX, e.clientY),
        onMouseLeave: () => onTradeHide(),
        onClick: (e: React.MouseEvent) => {
          // tap toggle for touch screens
          if (tipShownFor === cell.pick.overall) onTradeHide();
          else onTradeShow(cell, e.clientX, e.clientY);
        },
      }
    : {};

  return (
    <div
      className={cell.onClock ? 'pulse-glow' : undefined}
      style={{ ...style, cursor: traded ? 'help' : undefined }}
      {...tradeHandlers}
    >
      {/* corner markers: keeper lock + trade flag, small, upper right */}
      {(d?.isKeeper || traded) && (
        <span
          style={{
            position: 'absolute',
            top: 1,
            right: 3,
            display: 'inline-flex',
            gap: 2,
            fontSize: tv ? 'clamp(7px, 0.75vw, 11px)' : 9,
            lineHeight: 1.4,
          }}
        >
          {traded && <span style={{ color: 'var(--neon-yellow)' }}>▲</span>}
          {d?.isKeeper && <span style={{ opacity: 0.9 }}>🔒</span>}
        </span>
      )}
      {d ? (
        <>
          {traded && (
            <span
              style={{
                color: 'var(--neon-yellow)',
                fontWeight: 800,
                fontSize: tv ? 'clamp(7px, 0.7vw, 10px)' : '0.55rem',
                letterSpacing: '0.05em',
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                paddingRight: 12,
              }}
            >
              {cell.pick.currentOwner.toUpperCase()}'S PICK
            </span>
          )}
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontWeight: 700,
              color: d ? '#ffffff' : 'var(--text-hi)',
              fontSize: tv ? 'clamp(10px, 1.1vw, 18px)' : '0.72rem',
              lineHeight: 1.15,
              wordBreak: 'break-word',
              paddingRight: d.isKeeper || traded ? 12 : 0,
            }}
          >
            {d.name}
          </span>
          <span
            style={{
              color: d.color,
              fontWeight: 800,
              fontSize: tv ? 'clamp(8px, 0.75vw, 12px)' : '0.6rem',
              lineHeight: 1.35,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '0.03em',
            }}
          >
            {d.positions[0] ?? ''}
            {d.proTeam ? <span style={{ color: 'var(--text-soft)', fontWeight: 600 }}> · {d.proTeam.toUpperCase()}</span> : null}
          </span>
        </>
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
      ) : (
        <>
          <span
            style={{
              color: 'var(--text-ghost)',
              fontSize: tv ? 'clamp(9px, 0.9vw, 14px)' : '0.68rem',
              lineHeight: 1.2,
            }}
          >
            {pickLabel(cell.pick)}
          </span>
          {traded && (
            <span
              style={{
                color: 'var(--neon-yellow)',
                opacity: 0.8,
                fontWeight: 700,
                fontSize: tv ? 'clamp(8px, 0.8vw, 12px)' : '0.62rem',
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              → {cell.pick.currentOwner}'s
            </span>
          )}
        </>
      )}
    </div>
  );
}

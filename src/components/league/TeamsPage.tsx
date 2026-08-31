import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BoardCell } from '../../lib/keeper/types.js';
import { buildDraftBoard, pickLabel } from '../../lib/keeper/engine.js';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { positionColor, cellDisplay } from '../draft/boardUtils.js';
import IdentityChip from './IdentityChip.js';

/** /teams — everyone's 2027 roster as it forms from keepers + draft picks. */
export default function TeamsPage() {
  const { state, meta, dataset } = useLeagueData(true);
  const { identity } = useIdentity();
  const [selected, setSelected] = useState<string | null>(null);

  const owner = selected ?? identity?.owner ?? OWNERS[0];
  const team = teamByOwner.get(owner);

  const board = useMemo(() => buildDraftBoard(dataset, state), [state, dataset]);
  const cells = useMemo(
    () => board.filter((c) => c.pick.currentOwner === owner),
    [board, owner],
  );
  const filled = cells.filter((c) => c.keeper || c.selection);
  const upcoming = cells.filter((c) => !c.keeper && !c.selection);

  const hiddenKeepers =
    meta && !meta.revealed && (meta.keeperStatus[owner] ?? 0) > 0 && filled.length === 0
      ? meta.keeperStatus[owner]
      : 0;
  const keeperAction = owner === identity?.owner
    ? 'MY KEEPER OPTIONS'
    : meta?.revealed
      ? 'VIEW KEEPERS'
      : 'PROJECT KEEPERS';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <h1
          className="hub-heading glow-blue"
          style={{ fontSize: '0.85rem', color: 'var(--neon-blue)', margin: 0, lineHeight: 1.6 }}
        >
          TEAMS
        </h1>
        <IdentityChip />
      </div>

      {/* owner chips */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 8,
          marginBottom: 12,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {OWNERS.map((o) => {
          const active = o === owner;
          const n = meta?.keeperStatus[o] ?? 0;
          return (
            <button
              key={o}
              className="tap-btn"
              onClick={() => setSelected(o)}
              style={{
                flexShrink: 0,
                minHeight: 40,
                padding: '0 14px',
                borderRadius: 999,
                border: `2px solid ${active ? 'var(--neon-blue)' : 'var(--panel-border)'}`,
                background: active ? 'rgba(0,170,255,0.12)' : 'transparent',
                color: active ? 'var(--neon-blue)' : 'var(--text-body)',
                fontWeight: 700,
                fontSize: '0.82rem',
              }}
            >
              {o}
              {n > 0 && <span style={{ marginLeft: 5, fontSize: '0.7rem' }}>·{n}</span>}
            </button>
          );
        })}
      </div>

      {/* roster panel */}
      <section className="panel" style={{ padding: '12px 0 6px', borderRadius: 10, marginBottom: 14 }}>
        <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-max)' }}>{owner}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{team?.espnTeamName}</div>
          </div>
          <Link
            to={`/keepers/${encodeURIComponent(owner)}`}
            className="tap-btn"
            style={{
              flexShrink: 0,
              minHeight: 40,
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 12px',
              borderRadius: 8,
              border: '2px solid var(--neon-purple)',
              color: 'var(--neon-purple)',
              textDecoration: 'none',
              textAlign: 'center',
              fontSize: '0.72rem',
              fontWeight: 800,
            }}
          >
            {keeperAction}
          </Link>
        </div>

        {hiddenKeepers > 0 && (
          <div style={{ margin: '0 14px 10px', color: 'var(--neon-purple)', fontSize: '0.8rem', fontWeight: 700 }}>
            🔒 {hiddenKeepers} keeper{hiddenKeepers > 1 ? 's' : ''} in. Names stay hidden until the commish reveals them.
          </div>
        )}

        {filled.length === 0 && hiddenKeepers === 0 && (
          <div style={{ margin: '0 14px 10px', color: 'var(--text-faint)', fontSize: '0.82rem' }}>
            No {dataset.season} players yet. Open {keeperAction.toLowerCase()} to browse this team's final roster.
          </div>
        )}

        {filled.map((c) => (
          <RosterLine key={c.pick.overall} cell={c} />
        ))}

        {upcoming.length > 0 && (
          <div style={{ padding: '10px 14px 6px' }}>
            <div className="hub-heading" style={{ fontSize: '0.6rem', color: 'var(--text-dim)', marginBottom: 6 }}>
              UPCOMING PICKS ({upcoming.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {upcoming.map((c) => (
                <span
                  key={c.pick.overall}
                  style={{
                    border: `1px solid ${c.pick.viaTradeFrom ? 'rgba(255,230,0,0.4)' : 'var(--panel-border)'}`,
                    background: 'var(--chip-bg)',
                    color: c.pick.viaTradeFrom ? 'var(--neon-yellow)' : 'var(--text-body)',
                    borderRadius: 999,
                    padding: '3px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  {pickLabel(c.pick)}
                  {c.pick.viaTradeFrom ? ` (via ${c.pick.viaTradeFrom})` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RosterLine({ cell }: { cell: BoardCell }) {
  const d = cellDisplay(cell);
  if (!d) return null;
  const color = positionColor(d.positions);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--panel-border)',
        boxShadow: `inset 3px 0 0 ${color}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-hi)' }}>
          {d.isKeeper && '🔒 '}
          {d.name}
        </div>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color }}>
          {d.positions[0] ?? ''}
          {d.proTeam && <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}> · {d.proTeam.toUpperCase()}</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-body)', fontWeight: 700 }}>
          {d.isKeeper ? `KEEPER · pick ${pickLabel(cell.pick)}` : `pick ${pickLabel(cell.pick)}`}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>#{cell.pick.overall} overall</div>
      </div>
    </div>
  );
}

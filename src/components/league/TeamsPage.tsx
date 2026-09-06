import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BoardCell } from '../../lib/keeper/types.js';
import { buildDraftBoard, pickLabel } from '../../lib/keeper/engine.js';
import { OWNERS } from '../../lib/league/data.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { usePostseasonGames, type PostseasonGamesLookup } from '../../hooks/usePostseasonGames.js';
import { useTeamName } from '../../hooks/useTeamNames.js';
import { positionColor, cellDisplay } from '../draft/boardUtils.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import PostseasonTag from './PostseasonTag.js';

/** /teams — everyone's 2027 roster as it forms from keepers + draft picks. */
export default function TeamsPage() {
  const { state, meta, dataset } = useLeagueData(true);
  const { identity } = useIdentity();
  const teamName = useTeamName();
  const postseasonGames = usePostseasonGames();
  const [selected, setSelected] = useState<string | null>(null);

  const owner = selected ?? identity?.owner ?? OWNERS[0];
  const index = Math.max(0, OWNERS.indexOf(owner));

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

      {/* Team picker. Ten teams do not fit across a phone, and a strip you have
          to swipe hides whoever is off the edge. A native picker opens the
          phone's own wheel, and the arrows step to the next team without
          opening anything. */}
      <div className="team-switch">
        <button
          className="tap-btn team-switch-arrow"
          type="button"
          onClick={() => setSelected(OWNERS[(index - 1 + OWNERS.length) % OWNERS.length])}
          aria-label="Previous team"
        >
          &#8249;
        </button>
        <div className="team-switch-picker">
          <select
            className="team-switch-select"
            value={owner}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Pick a team"
          >
            {OWNERS.map((o) => (
              <option key={o} value={o}>
                {o} · {teamName(o)}
              </option>
            ))}
          </select>
          <span className="team-switch-caret" aria-hidden="true">&#9662;</span>
        </div>
        <button
          className="tap-btn team-switch-arrow"
          type="button"
          onClick={() => setSelected(OWNERS[(index + 1) % OWNERS.length])}
          aria-label="Next team"
        >
          &#8250;
        </button>
      </div>

      {/* roster panel */}
      <section className="panel" style={{ padding: '12px 0 6px', borderRadius: 10, marginBottom: 14 }}>
        <div style={{ padding: '0 14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-max)' }}>{owner}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{teamName(owner)}</div>
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

        {/* Looking at someone's picks is exactly when you want to ask for one,
            so the offer starts here instead of sending you off to find them. */}
        {identity && owner !== identity.owner && (
          <div style={{ padding: '0 14px 10px' }}>
            <Link className="tap-btn team-trade-btn" to={`/trades?with=${encodeURIComponent(owner)}`}>
              &#8646; TRADE WITH {owner.toUpperCase()}
            </Link>
          </div>
        )}

        {hiddenKeepers > 0 && (
          <div style={{ margin: '0 14px 10px', color: 'var(--neon-purple)', fontSize: '0.8rem', fontWeight: 700 }}>
            <NavIcon name="lock" size={14} className="icon-in-heading" />
            {hiddenKeepers} keeper{hiddenKeepers > 1 ? 's' : ''} in. Names stay hidden until the commish reveals them.
          </div>
        )}

        {filled.length === 0 && hiddenKeepers === 0 && (
          <div style={{ margin: '0 14px 10px', color: 'var(--text-faint)', fontSize: '0.82rem' }}>
            No {dataset.season} players yet. Open {keeperAction.toLowerCase()} to browse this team's final roster.
          </div>
        )}

        {filled.map((c) => (
          <RosterLine key={c.pick.overall} cell={c} postseasonGames={postseasonGames} />
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

function RosterLine({
  cell,
  postseasonGames,
}: {
  cell: BoardCell;
  postseasonGames: PostseasonGamesLookup;
}) {
  const d = cellDisplay(cell);
  if (!d) return null;
  const color = positionColor(d.positions);
  const postseason = d.proTeam ? postseasonGames(d.proTeam) : null;
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
          {d.isKeeper && <NavIcon name="lock" size={13} label="Keeper" className="icon-in-heading" />}
          {d.name}
        </div>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color }}>
          {d.positions[0] ?? ''}
          {d.proTeam && <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}> · {d.proTeam.toUpperCase()}</span>}
          {postseason && (
            /* The dot carries the tag's colour, not the position colour. */
            <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>
              {' · '}
              <PostseasonTag games={postseason} />
            </span>
          )}
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

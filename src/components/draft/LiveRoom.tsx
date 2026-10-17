import { Fragment, useMemo, useState } from 'react';
import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { apiErrorMessage, submitDraftPick } from '../../lib/league/api.js';
import { POSITIONS } from '../../lib/league/draftValue.js';
import {
  DEFAULT_ROOM_SORT,
  nextRoomSort,
  roomRows,
  takenOnBoard,
  type RoomSort,
  type RoomSortKey,
} from '../../lib/league/liveRoom.js';
import { editTitle, type PlayerProjection } from '../../lib/league/projections.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import { positionColor } from './boardUtils.js';

const pct = (share: number) => `${Math.round(share * 100)}%`;
const one = (value: number | null | undefined) => (value === null || value === undefined ? '–' : value.toFixed(1));

/** Sorts a phone can reach without scrolling the table sideways. */
const QUICK_SORTS: ReadonlyArray<readonly [RoomSortKey, string]> = [
  ['rank', 'RK'],
  ['adp', 'ADP'],
  ['total', 'TOT'],
  ['fppg', 'FPPG'],
];

interface Props {
  board: readonly BoardCell[];
  /** Every player in the pool, taken or not. */
  everyone: readonly DatasetPlayer[];
  /** Players still there. */
  available: readonly DatasetPlayer[];
  onClock: BoardCell | null;
  /** The signed-in owner. */
  person: string;
  /** The viewer may enter the pick on the clock: it is theirs, or they are the commish. */
  canDraft: boolean;
  projections: ReadonlyMap<string, PlayerProjection>;
  /** Share of drafts each player is gone in before the viewer's next pick. Null when not counted. */
  gone: ReadonlyMap<string, number> | null;
}

/**
 * The live draft's player list, built like the mock room's: sort by any
 * column, filter by position, search, and see how often each player is gone
 * before your next pick. DRAFT enters him on the pick on the clock.
 */
export default function LiveRoom({ board, everyone, available, onClock, person, canDraft, projections, gone }: Props) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [sort, setSort] = useState<RoomSort>(DEFAULT_ROOM_SORT);
  const [position, setPosition] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showDrafted, setShowDrafted] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(() => takenOnBoard(board), [board]);
  const rows = useMemo(
    () => roomRows({ available, everyone, taken, projections, gone, position, search, showDrafted, sort }),
    [available, everyone, taken, projections, gone, position, search, showDrafted, sort],
  );

  // How many open picks until the viewer's own, and which pick that is.
  const onClockIdx = onClock ? board.indexOf(onClock) : -1;
  const open = onClockIdx >= 0 ? board.slice(onClockIdx).filter((cell) => !cell.selection && !cell.keeper && !cell.skipped) : [];
  const nextIdx = open.findIndex((cell) => cell.pick.currentOwner === person);
  const myNext = nextIdx >= 0 ? open[nextIdx] : null;
  const mine = onClock?.pick.currentOwner === person;
  // The line where your next pick falls, if the room takes players in board order.
  const pickLineAt = !mine && myNext && sort.key === 'rank' && sort.dir === 1 && !search.trim() && position === 'ALL' && !showDrafted
    ? nextIdx
    : null;
  const showGone = canDraft && gone !== null;

  const draft = async (player: DatasetPlayer) => {
    if (!identity || !onClock || busyKey) return;
    setBusyKey(player.key);
    setError(null);
    try {
      applyState(await submitDraftPick(identity, {
        overallPick: onClock.pick.overall,
        playerKey: player.key,
        playerName: player.name,
        proTeam: player.proTeam,
        positions: player.positions,
      }));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const head = (key: RoomSortKey, label: string, title?: string, className = '') => (
    <th className={`room-num${sort.key === key ? ' is-sorted' : ''}${className ? ` ${className}` : ''}`} title={title ?? label}>
      <button type="button" onClick={() => setSort((current) => nextRoomSort(current, key))}>
        {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  let status: string;
  if (!onClock) status = 'Draft complete';
  else if (canDraft && mine) status = `Your pick · ${pickLabel(onClock.pick)}`;
  else if (canDraft) status = `Entering for ${onClock.pick.currentOwner} · ${pickLabel(onClock.pick)}`;
  else if (myNext) status = nextIdx === 0 ? 'You are up' : `Up in ${nextIdx} pick${nextIdx === 1 ? '' : 's'} at ${pickLabel(myNext.pick)}`;
  else status = 'No picks left';

  return (
    <section className={`panel live-room${canDraft ? ' is-my-turn' : ''}`} aria-label="Players">
      <div className="live-room-head">
        <span className="hub-heading">PLAYERS</span>
        <span className={`live-room-status${canDraft ? ' is-on' : ''}`}>{status}</span>
      </div>
      <div className="room-filters">
        <select className="hub-input mock-select" aria-label="Position" value={position} onChange={(event) => setPosition(event.target.value)}>
          <option value="ALL">All players</option>
          {POSITIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <span className="room-sort-quick" role="group" aria-label="Sort by">
          {[...QUICK_SORTS, ...(showGone ? [['gone', 'GONE'] as const] : [])].map(([key, label]) => (
            <button key={key} type="button" className={sort.key === key ? 'is-on' : ''} aria-pressed={sort.key === key} onClick={() => setSort((current) => nextRoomSort(current, key))}>
              {label}{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
            </button>
          ))}
        </span>
        <input className="hub-input room-search" type="search" placeholder="Search for a player" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="proj-check"><input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} /> Show drafted</label>
      </div>
      {error && <div className="live-room-error" role="alert">{error}</div>}
      <div className="room-table-wrap">
        <table className="room-table">
          <thead>
            <tr>
              {canDraft && <th className="room-draft-col live-room-draft" />}
              {showGone && head('gone', 'GONE', 'How often he goes before your next pick, across 60 drafts from here', 'live-room-gone')}
              <th className="room-player-col">Player</th>
              {head('rank', 'RK', 'Our board rank')}
              {head('adp', 'ADP')}
              {head('fppg', 'FPPG')}
              {head('total', 'TOTAL', 'Projected season points')}
              {head('games', 'GP')}
              {head('pi', 'PI', 'Team games in our play-in weeks')}
              {head('po', 'PO', 'Team games in our playoff weeks')}
              {head('pts', 'PTS')}
              {head('reb', 'REB')}
              {head('ast', 'AST')}
              {head('stl', 'STL')}
              {head('blk', 'BLK')}
              {head('threes', '3PM')}
              {head('to', 'TO')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, taken: takenBy }, index) => {
              const projection = projections.get(player.key);
              const share = gone?.get(player.key) ?? 0;
              return (
                <Fragment key={player.key}>
                  {pickLineAt === index && myNext && (
                    <tr className="room-pickline"><td colSpan={20}>Your pick {pickLabel(myNext.pick)}</td></tr>
                  )}
                  <tr className={takenBy ? 'is-taken' : undefined}>
                    {canDraft && (
                      <td className="room-draft-col live-room-draft">
                        {!takenBy && (
                          <button
                            type="button"
                            className="tap-btn mock-mini-btn is-primary"
                            disabled={busyKey !== null}
                            onClick={() => draft(player)}
                          >
                            {busyKey === player.key ? '…' : 'DRAFT'}
                          </button>
                        )}
                      </td>
                    )}
                    {showGone && (
                      <td className={`room-num live-room-gone${share >= 0.5 ? ' is-hot' : ''}`}>{takenBy ? '–' : pct(share)}</td>
                    )}
                    <td className="room-player-col">
                      <span className="room-player-name">{player.fullName ?? player.name}</span>
                      <small>
                        {player.proTeam.toUpperCase()} – <span style={{ color: positionColor(player.positions), fontWeight: 800 }}>{player.positions.join('/')}</span>
                      </small>
                      {takenBy && (
                        <small className="room-taken"> {takenBy.label} {takenBy.owner}{takenBy.keeper ? ' · KEEPER' : ''}</small>
                      )}
                    </td>
                    <td className="room-num">{projection?.valueRank ?? '–'}</td>
                    <td className="room-num">{one(projection?.adp)}</td>
                    <td className="room-num room-strong">{one(projection?.fppg)}</td>
                    <td className="room-num">{projection?.total?.toLocaleString() ?? '–'}</td>
                    <td className="room-num" title={projection ? editTitle(projection) ?? undefined : undefined}>{projection?.games ?? '–'}{projection?.edit ? '*' : ''}</td>
                    <td className="room-num">{projection?.playInGames ?? '–'}</td>
                    <td className="room-num">{projection?.playoffGames ?? '–'}</td>
                    <td className="room-num">{one(projection?.line?.pts)}</td>
                    <td className="room-num">{one(projection?.line?.reb)}</td>
                    <td className="room-num">{one(projection?.line?.ast)}</td>
                    <td className="room-num">{one(projection?.line?.stl)}</td>
                    <td className="room-num">{one(projection?.line?.blk)}</td>
                    <td className="room-num">{one(projection?.line?.threes)}</td>
                    <td className="room-num">{one(projection?.line?.to)}</td>
                  </tr>
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={20} className="proj-empty">No players match.</td></tr>}
          </tbody>
        </table>
      </div>
      {showGone && <div className="mock-note mock-note-dim">GONE: how often he is taken before your next pick, across 60 drafts played from here.</div>}
    </section>
  );
}

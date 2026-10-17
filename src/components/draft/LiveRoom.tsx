import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { apiErrorMessage, submitDraftPick } from '../../lib/league/api.js';
import { moveQueued, shortName, toggleQueued } from '../../lib/league/draftRoom.js';
import { POSITIONS } from '../../lib/league/draftValue.js';
import {
  DEFAULT_ROOM_SORT,
  MEMBER_ROOM_SORT,
  nextRoomSort,
  roomRows,
  takenOnBoard,
  type RoomSort,
  type RoomSortKey,
  type TakenBy,
} from '../../lib/league/liveRoom.js';
import { editTitle, type PlayerProjection } from '../../lib/league/projections.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import { positionColor } from './boardUtils.js';

const pct = (share: number) => `${Math.round(share * 100)}%`;
const one = (value: number | null | undefined) => (value === null || value === undefined ? '–' : value.toFixed(1));
/** How far the list scrolls sideways before names shorten, and how far back before they grow again. */
const SHORT_NAME_AT = 40;
const FULL_NAME_AT = 8;

/** Sorts a phone reaches without scrolling the table sideways. */
const STAT_QUICK_SORTS: ReadonlyArray<readonly [RoomSortKey, string]> = [
  ['rank', 'RK'],
  ['adp', 'ADP'],
  ['total', 'TOT'],
  ['fppg', 'FPPG'],
];
const MEMBER_QUICK_SORTS: ReadonlyArray<readonly [RoomSortKey, string]> = [
  ['name', 'NAME'],
  ['team', 'TEAM'],
  ['pos', 'POS'],
];

/** The viewer's queue, kept on this device only. */
function useQueue(storageKey: string): [string[], (update: (current: string[]) => string[]) => void] {
  const [queue, setQueue] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(queue));
    } catch {
      /* ignore */
    }
  }, [storageKey, queue]);
  return [queue, (update) => setQueue((current) => update(current))];
}

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
  /** Stats and odds. Only the commissioner sees them while the draft runs. */
  showStats: boolean;
  projections: ReadonlyMap<string, PlayerProjection>;
  /** Share of drafts each player is gone in before the viewer's next pick. Null when not counted. */
  gone: ReadonlyMap<string, number> | null;
  /** Where this device keeps the viewer's queue. */
  queueKey: string;
  /** Open the form for a player the pool does not have. */
  onWriteIn: () => void;
}

/**
 * The live draft's player list, built like the mock room's. Tap a player for
 * his card, with DRAFT and QUEUE. The commissioner also gets every stat, the
 * column sorts and how often each player is gone before his next pick.
 * Members get names, positions and teams, nothing more.
 */
export default function LiveRoom({ board, everyone, available, onClock, person, canDraft, showStats, projections, gone, queueKey, onWriteIn }: Props) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [sort, setSort] = useState<RoomSort>(showStats ? DEFAULT_ROOM_SORT : MEMBER_ROOM_SORT);
  const [position, setPosition] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showDrafted, setShowDrafted] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [queue, setQueue] = useQueue(queueKey);
  const [showQueue, setShowQueue] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const taken = useMemo(() => takenOnBoard(board), [board]);
  const byKey = useMemo(() => new Map(everyone.map((player) => [player.key, player])), [everyone]);
  const rows = useMemo(
    () => roomRows({ available, everyone, taken, projections, gone, position, search, showDrafted, sort }),
    [available, everyone, taken, projections, gone, position, search, showDrafted, sort],
  );
  const queued = queue.filter((key) => !taken.has(key) && byKey.has(key));

  // How many open picks until the viewer's own, and which pick that is.
  const onClockIdx = onClock ? board.indexOf(onClock) : -1;
  const open = onClockIdx >= 0 ? board.slice(onClockIdx).filter((cell) => !cell.selection && !cell.keeper && !cell.skipped) : [];
  const nextIdx = open.findIndex((cell) => cell.pick.currentOwner === person);
  const myNext = nextIdx >= 0 ? open[nextIdx] : null;
  const mine = onClock?.pick.currentOwner === person;
  // The line where your next pick falls, if the room takes players in board order.
  const pickLineAt = showStats && !mine && myNext && sort.key === 'rank' && sort.dir === 1 && !search.trim() && position === 'ALL' && !showDrafted
    ? nextIdx
    : null;
  const showGone = showStats && canDraft && gone !== null;

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
      setSelected(null);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  const look = (key: string) => {
    setSelected(key);
    window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  };

  const onListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const left = event.currentTarget.scrollLeft;
    // A gap between the two marks, so a finger resting near one does not flicker.
    const next = scrolled ? left > FULL_NAME_AT : left > SHORT_NAME_AT;
    if (next !== scrolled) setScrolled(next);
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

  const quickSorts = showStats ? [...STAT_QUICK_SORTS, ...(showGone ? [['gone', 'GONE'] as const] : [])] : MEMBER_QUICK_SORTS;
  const card = selected ? byKey.get(selected) ?? null : null;

  return (
    <section className={`panel live-room${canDraft ? ' is-my-turn' : ''}${showStats ? ' has-stats' : ''}`} aria-label="Players">
      <div className="live-room-head">
        <span className="hub-heading">PLAYERS</span>
        <span className={`live-room-status${canDraft ? ' is-on' : ''}`}>{status}</span>
      </div>
      {card && (
        <div ref={cardRef}>
          <LiveCard
            player={card}
            projection={showStats ? projections.get(card.key) ?? null : null}
            gone={showGone ? gone?.get(card.key) ?? 0 : null}
            takenBy={taken.get(card.key) ?? null}
            queued={queue.includes(card.key)}
            canDraft={canDraft}
            busy={busyKey !== null}
            onDraft={() => draft(card)}
            onQueue={() => setQueue((current) => toggleQueued(current, card.key))}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
      <div className="room-filters">
        <select className="hub-input mock-select" aria-label="Position" value={position} onChange={(event) => setPosition(event.target.value)}>
          <option value="ALL">All players</option>
          {POSITIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <span className={`room-sort-quick${showStats ? '' : ' is-always'}`} role="group" aria-label="Sort by">
          {quickSorts.map(([key, label]) => (
            <button key={key} type="button" className={sort.key === key ? 'is-on' : ''} aria-pressed={sort.key === key} onClick={() => setSort((current) => nextRoomSort(current, key))}>
              {label}{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
            </button>
          ))}
        </span>
        <button
          type="button"
          className={`tap-btn mock-mini-btn live-room-queue-btn${showQueue ? ' is-on' : ''}`}
          aria-expanded={showQueue}
          onClick={() => setShowQueue((current) => !current)}
        >
          {showQueue ? '★' : '☆'} QUEUE{queued.length ? ` ${queued.length}` : ''}
        </button>
        <input className="hub-input room-search" type="search" placeholder="Search for a player" value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="proj-check"><input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} /> Show drafted</label>
      </div>
      {showQueue && (
        <div className="live-room-queue">
          {queued.length === 0 ? (
            <div className="mock-note mock-note-dim">Tap ☆ beside a player, or QUEUE on his card. Your queue stays on this phone.</div>
          ) : (
            <ol className="room-queue-list">
              {queued.map((key, index) => {
                const player = byKey.get(key)!;
                return (
                  <li key={key}>
                    <span className="room-upcoming-num">{index + 1}</span>
                    <button type="button" className="room-queue-name" onClick={() => look(key)}>{player.fullName ?? player.name}</button>
                    <small style={{ color: positionColor(player.positions), fontWeight: 800 }}>{player.positions.join('/')}</small>
                    {canDraft && (
                      <button type="button" className="tap-btn mock-mini-btn is-primary" disabled={busyKey !== null} onClick={() => draft(player)}>DRAFT</button>
                    )}
                    <button type="button" className="room-icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => setQueue((current) => moveQueued(current, key, -1))}>↑</button>
                    <button type="button" className="room-icon-btn" aria-label="Move down" disabled={index === queued.length - 1} onClick={() => setQueue((current) => moveQueued(current, key, 1))}>↓</button>
                    <button type="button" className="room-icon-btn" aria-label="Take off my queue" onClick={() => setQueue((current) => toggleQueued(current, key))}>✕</button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
      {error && <div className="live-room-error" role="alert">{error}</div>}
      <div className={`room-table-wrap${scrolled ? ' is-scrolled' : ''}`} onScroll={onListScroll}>
        <table className="room-table">
          <thead>
            <tr>
              {canDraft && <th className="room-draft-col live-room-draft" />}
              {showGone && head('gone', 'GONE', 'How often he goes before your next pick, across 60 drafts from here', 'live-room-gone')}
              <th className="room-star" aria-label="Queue" />
              <th className="room-player-col">Player</th>
              {showStats && (
                <>
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
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, taken: takenBy }, index) => {
              const projection = showStats ? projections.get(player.key) : undefined;
              const share = gone?.get(player.key) ?? 0;
              const fullName = player.fullName ?? player.name;
              const isQueued = queue.includes(player.key);
              return (
                <Fragment key={player.key}>
                  {pickLineAt === index && myNext && (
                    <tr className="room-pickline"><td colSpan={20}>Your pick {pickLabel(myNext.pick)}</td></tr>
                  )}
                  <tr className={`${takenBy ? 'is-taken' : ''}${selected === player.key ? ' is-focus' : ''}`} onClick={() => look(player.key)}>
                    {canDraft && (
                      <td className="room-draft-col live-room-draft">
                        {!takenBy && (
                          <button
                            type="button"
                            className="tap-btn mock-mini-btn is-primary"
                            disabled={busyKey !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              void draft(player);
                            }}
                          >
                            {busyKey === player.key ? '…' : 'DRAFT'}
                          </button>
                        )}
                      </td>
                    )}
                    {showGone && (
                      <td className={`room-num live-room-gone${share >= 0.5 ? ' is-hot' : ''}`}>{takenBy ? '–' : pct(share)}</td>
                    )}
                    <td className="room-star">
                      {!takenBy && (
                        <button
                          type="button"
                          aria-label={isQueued ? 'Take off my queue' : 'Add to my queue'}
                          aria-pressed={isQueued}
                          className={isQueued ? 'is-on' : ''}
                          onClick={(event) => {
                            event.stopPropagation();
                            setQueue((current) => toggleQueued(current, player.key));
                          }}
                        >
                          {isQueued ? '★' : '☆'}
                        </button>
                      )}
                    </td>
                    <td className="room-player-col">
                      <span className="room-player-name">
                        <span className="room-name-full">{fullName}</span>
                        <span className="room-name-short">{shortName(fullName)}</span>
                      </span>
                      <small className="live-room-sub">
                        {player.proTeam.toUpperCase()} – <span style={{ color: positionColor(player.positions), fontWeight: 800 }}>{player.positions.join('/')}</span>
                      </small>
                      {takenBy && <TakenNote takenBy={takenBy} />}
                    </td>
                    {showStats && (
                      <>
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
                      </>
                    )}
                  </tr>
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={20} className="proj-empty">No players match.</td></tr>}
          </tbody>
        </table>
      </div>
      {showGone && <div className="mock-note mock-note-dim">GONE: how often he is taken before your next pick, across 60 drafts played from here.</div>}
      {canDraft && (
        <button type="button" className="live-room-writein" onClick={onWriteIn}>
          Not in the list? Write him in
        </button>
      )}
    </section>
  );
}

function TakenNote({ takenBy }: { takenBy: TakenBy }) {
  return <small className="room-taken"> {takenBy.label} {takenBy.owner}{takenBy.keeper ? ' · KEEPER' : ''}</small>;
}

/** A tapped player: who he is, DRAFT and QUEUE, and for the commish his numbers. */
function LiveCard({ player, projection, gone, takenBy, queued, canDraft, busy, onDraft, onQueue, onClose }: {
  player: DatasetPlayer;
  projection: PlayerProjection | null;
  gone: number | null;
  takenBy: TakenBy | null;
  queued: boolean;
  canDraft: boolean;
  busy: boolean;
  onDraft: () => void;
  onQueue: () => void;
  onClose: () => void;
}) {
  const line = projection?.line ?? null;
  return (
    <section className="panel room-card live-card is-picked">
      <div className="room-card-head">
        <div className="room-card-main">
          {takenBy && (
            <div className="room-card-top">
              <span className="room-card-taken">{takenBy.keeper ? 'Kept' : 'Drafted'} {takenBy.label} by {takenBy.owner}</span>
            </div>
          )}
          <div className="room-card-name">{player.fullName ?? player.name}</div>
          <div className="room-card-meta">
            <span style={{ color: positionColor(player.positions), fontWeight: 800 }}>{player.positions.join('/')}</span>
            {' | '}{player.proTeam.toUpperCase()}
            {projection?.espnRank ? ` | ESPN #${projection.espnRank}` : ''}
            {projection?.adp ? ` | ADP ${projection.adp.toFixed(1)}` : ''}
            {gone !== null && !takenBy ? ` | ${pct(gone)} gone by your next pick` : ''}
          </div>
        </div>
        <div className="room-card-actions">
          {!takenBy && canDraft && (
            <button type="button" className="tap-btn live-start-btn" disabled={busy} onClick={onDraft}>DRAFT</button>
          )}
          {!takenBy && (
            <button type="button" className={`tap-btn mock-mini-btn${queued ? ' is-on' : ''}`} onClick={onQueue}>{queued ? '★ QUEUED' : '☆ QUEUE'}</button>
          )}
          <button type="button" className="room-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
      </div>
      {projection && (
        <div className="room-card-table-wrap">
          <table className="room-card-table">
            <thead>
              <tr><th aria-label="Season" /><th>FPPG</th><th>Total</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TO</th></tr>
            </thead>
            <tbody>
              <tr>
                <th>Projected</th>
                <td>{one(projection.fppg)}</td>
                <td>{projection.total?.toLocaleString() ?? '–'}</td>
                <td>{projection.games ?? '–'}</td>
                <td>{one(line?.min)}</td><td>{one(line?.pts)}</td><td>{one(line?.reb)}</td><td>{one(line?.ast)}</td>
                <td>{one(line?.stl)}</td><td>{one(line?.blk)}</td><td>{one(line?.threes)}</td><td>{one(line?.to)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

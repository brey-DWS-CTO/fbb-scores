import type { DraftRoom } from '../../lib/league/testDraft.js';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Wide enough for a second row of sort chips. Phones keep one sort. */
function useDesktop(): boolean {
  const query = '(min-width: 840px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}
import type { ReactNode } from 'react';
import type { BoardCell, DatasetPlayer } from '../../lib/keeper/types.js';
import { pickLabel } from '../../lib/keeper/engine.js';
import { apiErrorMessage, clearDraftPick, submitDraftPick } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';
import { usePostseasonGames } from '../../hooks/usePostseasonGames.js';
import PostseasonTag from '../league/PostseasonTag.js';
import {
  allowedSort,
  filterPool,
  pickNumber,
  pickPercent,
  SORT_LABELS,
  sortPool,
  sortsFor,
  THEN_SORTS,
  type PickNumbersByKey,
  type PickSort,
  type PositionFilter,
} from '../../lib/league/pickSheet.js';
import { parseWriteIn, WRITE_IN_POSITIONS, type WriteInPosition } from '../../lib/league/writeIn.js';
import { POSITION_ORDER, positionTheme } from './boardUtils.js';

/** Name, team and position for a player the pool does not have. */
function WriteInForm({
  teams,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  /** NBA team codes as the pool spells them. */
  teams: readonly string[];
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (input: { name: string; proTeam: string; positions: WriteInPosition[] }) => void;
}) {
  const [name, setName] = useState('');
  const [proTeam, setProTeam] = useState('');
  const [positions, setPositions] = useState<WriteInPosition[]>([]);
  const togglePosition = (code: WriteInPosition) =>
    setPositions((current) => (current.includes(code)
      ? current.filter((entry) => entry !== code)
      : current.length >= 2 ? current : [...current, code]));
  const check = parseWriteIn({ name, proTeam, positions });
  const field = { width: '100%', minHeight: 48, padding: '11px 14px', fontSize: '0.95rem' } as const;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (check.ok) onSubmit({ name, proTeam, positions });
      }}
      style={{ display: 'grid', gap: 10 }}
    >
      <div style={{ color: 'var(--text-soft)', fontSize: '0.8rem' }}>
        Not in the pool? Type him in. The name goes on the board as written.
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="hub-heading" style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>PLAYER NAME</span>
        <input className="hub-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="First Last" autoComplete="off" spellCheck={false} autoFocus style={field} />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="hub-heading" style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>NBA TEAM</span>
        <select className="hub-input" value={proTeam} onChange={(event) => setProTeam(event.target.value)} style={{ ...field, textTransform: 'uppercase' }}>
          <option value="">Pick a team…</option>
          {teams.map((code) => (
            <option key={code} value={code}>{code.toUpperCase()}</option>
          ))}
        </select>
      </label>
      <div style={{ display: 'grid', gap: 4 }}>
        <span className="hub-heading" style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>POSITION · UP TO TWO</span>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {WRITE_IN_POSITIONS.map((code) => {
            const active = positions.includes(code);
            const theme = positionTheme([code]);
            return (
              <button
                key={code}
                className="tap-btn"
                type="button"
                aria-pressed={active}
                onClick={() => togglePosition(code)}
                style={{
                  minWidth: 52,
                  minHeight: 40,
                  padding: '6px 12px',
                  border: `1px solid ${active ? theme.border : 'var(--panel-border)'}`,
                  borderRadius: 999,
                  background: active ? theme.deepBackground : 'var(--chip-bg)',
                  color: active ? theme.color : 'var(--text-mid)',
                  fontWeight: 800,
                }}
              >
                {code}
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="tap-btn"
        type="submit"
        disabled={busy || !check.ok}
        style={{
          minHeight: 48,
          marginTop: 4,
          border: 'none',
          borderRadius: 8,
          background: busy || !check.ok ? 'var(--panel-border)' : 'var(--neon-teal)',
          color: busy || !check.ok ? 'var(--text-dim)' : '#001a14',
          fontWeight: 800,
          fontSize: '0.95rem',
        }}
      >
        {busy ? 'ENTERING…' : check.ok ? `DRAFT ${check.player.name.toUpperCase()}` : 'DRAFT WRITE-IN'}
      </button>
      {!check.ok && (name || proTeam || positions.length > 0) && (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{check.error}</div>
      )}
      {error && <div role="alert" style={{ color: 'var(--neon-red)', fontSize: '0.85rem' }}>{error}</div>}
      <button className="tap-btn" type="button" onClick={onBack} style={{ background: 'transparent', border: 'none', color: 'var(--text-mid)', textDecoration: 'underline' }}>
        Back to the list
      </button>
    </form>
  );
}

function SheetShell({
  onClose,
  titleId,
  children,
}: {
  onClose: () => void;
  titleId: string;
  children: ReactNode;
}) {
  // The page re-renders on every poll and hands in a new onClose each time.
  // Keep it in a ref so this runs once: otherwise the cleanup pulled focus
  // out of whatever the person was typing in, every three seconds.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onKeyDown);
      priorFocus?.focus();
    };
  }, []);

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
  room: DraftRoom;
  cell: BoardCell;
  pool: DatasetPlayer[];
  onClose: () => void;
  /**
   * The commissioner's numbers beside each name. Members get nothing here,
   * and the sheet shows nothing without it.
   */
  numbers?: PickNumbersByKey | null;
  /** Open on the write-in form instead of the player list. */
  startInWriteIn?: boolean;
}

/** Bottom sheet for entering a live draft pick into an empty cell. */
export default function PickSheet({ room: displayedRoom, cell, pool, onClose, numbers = null, startInWriteIn = false }: PickSheetProps) {
  const [room] = useState(displayedRoom);
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const postseasonGames = usePostseasonGames();
  const [picking, setPicking] = useState<DatasetPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PositionFilter>('ALL');
  const [sortChoice, setSortChoice] = useState<PickSort>('name');
  const [thenChoice, setThenChoice] = useState<PickSort | null>(null);
  const [writeIn, setWriteIn] = useState(startInWriteIn);
  const desktop = useDesktop();

  const isCommissioner = identity?.isCommissioner === true;
  const showNumbers = isCommissioner && numbers !== null;
  const sort = allowedSort(sortChoice, showNumbers);
  const sorts = sortsFor(showNumbers);
  // A second sort is a desktop, commish-only thing.
  const thenBy = showNumbers && desktop && thenChoice && thenChoice !== sort ? thenChoice : null;

  const sorted = useMemo(() => sortPool(pool, sort, numbers, thenBy), [pool, sort, numbers, thenBy]);
  // Every NBA team the pool knows, for the write-in dropdown.
  const teamCodes = useMemo(
    () => [...new Set(pool.map((player) => player.proTeam.toLowerCase()).filter((code) => /^[a-z]{2,4}$/.test(code)))].sort(),
    [pool],
  );
  const filtered = useMemo(() => filterPool(sorted, { query, position }), [sorted, position, query]);

  // One tap and the pick lands. The commissioner has UNDO on the board for a slip.
  const choose = async (player: DatasetPlayer) => {
    if (!identity || busy) return;
    setBusy(true);
    setPicking(player);
    setError(null);
    try {
      const res = await submitDraftPick(identity, {
        overallPick: cell.pick.overall,
        playerKey: player.key,
        playerName: player.name,
        proTeam: player.proTeam,
        positions: player.positions,
      }, room);
      applyState(res);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
      setBusy(false);
      setPicking(null);
    }
  };

  const chooseWriteIn = async (input: { name: string; proTeam: string; positions: WriteInPosition[] }) => {
    if (!identity || busy) return;
    const parsed = parseWriteIn(input);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await submitDraftPick(identity, {
        overallPick: cell.pick.overall,
        playerKey: parsed.player.key,
        playerName: parsed.player.name,
        proTeam: parsed.player.proTeam,
        positions: parsed.player.positions,
        writeIn: true,
      }, room);
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
            {cell.skipped && <span style={{ color: 'var(--neon-red)' }}> · SKIPPED</span>}
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

      {writeIn ? (
        <WriteInForm teams={teamCodes} busy={busy} error={error} onBack={() => { setWriteIn(false); setError(null); }} onSubmit={chooseWriteIn} />
      ) : (
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
            aria-label="Sort players"
            style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}
          >
            <span className="hub-heading" style={{ color: 'var(--text-dim)', fontSize: '0.55rem', marginRight: 2, flexShrink: 0 }}>
              SORT
            </span>
            {sorts.map((option) => {
              const active = sort === option;
              return (
                <button
                  key={option}
                  className="tap-btn"
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSortChoice(option)}
                  style={{
                    minHeight: 32,
                    padding: '4px 11px',
                    border: `1px solid ${active ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                    borderRadius: 999,
                    background: active ? 'rgba(0,255,204,0.1)' : 'var(--chip-bg)',
                    color: active ? 'var(--neon-teal)' : 'var(--text-mid)',
                    fontSize: '0.66rem',
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {SORT_LABELS[option]}
                </button>
              );
            })}
          </div>

          {showNumbers && desktop && (
            <div
              aria-label="Then sort players by"
              style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}
            >
              <span className="hub-heading" style={{ color: 'var(--text-dim)', fontSize: '0.55rem', marginRight: 2, flexShrink: 0 }}>
                THEN
              </span>
              {THEN_SORTS.filter((option) => option !== sort).map((option) => {
                const active = thenBy === option;
                return (
                  <button
                    key={option}
                    className="tap-btn"
                    type="button"
                    aria-pressed={active}
                    onClick={() => setThenChoice(active ? null : option)}
                    style={{
                      minHeight: 28,
                      padding: '3px 10px',
                      border: `1px solid ${active ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                      borderRadius: 999,
                      background: active ? 'rgba(0,255,204,0.1)' : 'var(--chip-bg)',
                      color: active ? 'var(--neon-teal)' : 'var(--text-mid)',
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {SORT_LABELS[option]}
                  </button>
                );
              })}
            </div>
          )}

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
            <span>{busy && picking ? `ENTERING ${(picking.fullName ?? picking.name).toUpperCase()}…` : `${filtered.length} AVAILABLE`}</span>
            <span>{showNumbers ? `BY ${SORT_LABELS[sort]}${thenBy ? `, THEN ${SORT_LABELS[thenBy]}` : ''} · MEMBERS SEE NO NUMBERS` : `BY ${SORT_LABELS[sort]}`}</span>
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
              // Play-in and playoff game counts are the commissioner's too.
              const postseason = showNumbers ? postseasonGames(player.proTeam) : null;
              const stat = showNumbers ? numbers.get(player.key) ?? null : null;
              const gone = stat?.gone ?? null;
              return (
                <div
                  key={player.key}
                  aria-busy={picking?.key === player.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '5px minmax(0, 1fr) auto auto',
                    alignItems: 'stretch',
                    gap: 0,
                    width: '100%',
                    minHeight: 62,
                    borderBottom: '1px solid var(--panel-border)',
                    color: 'var(--text-hi)',
                    opacity: busy && picking?.key !== player.key ? 0.45 : 1,
                  }}
                >
                  <span aria-hidden="true" style={{ background: picking?.key === player.key ? 'var(--neon-teal)' : theme.color }} />
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
                    {showNumbers && (
                      <span
                        className="room-num"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '2px 10px',
                          marginTop: 4,
                          color: 'var(--text-soft)',
                          fontSize: '0.72rem',
                          textAlign: 'left',
                        }}
                      >
                        {([
                          ['fppg', 'FPPG', pickNumber(stat?.fppg)],
                          ['total', 'TOT', pickNumber(stat?.total, 0)],
                          ['adp', 'ADP', pickNumber(stat?.adp)],
                          ['rank', 'RK', pickNumber(stat?.rank, 0)],
                          ['playIn', 'PLAY-IN', pickNumber(stat?.playIn, 0)],
                          ['playoff', 'PLAYOFF', pickNumber(stat?.playoff, 0)],
                        ] as const).map(([key, label, value]) => {
                          // The stats the list is sorted by stand out.
                          const sortedBy = sort === key || thenBy === key;
                          return (
                            <span key={key} style={sortedBy ? { color: 'var(--neon-teal)' } : undefined}>
                              <b style={{ color: sortedBy ? 'var(--neon-teal)' : 'var(--text-dim)' }}>{label}</b>{' '}
                              <span className={sortedBy ? 'room-strong' : undefined} style={sortedBy ? { color: 'var(--neon-teal)' } : undefined}>{value}</span>
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                  {showNumbers ? (
                    <span
                      title="How often he is gone before your next pick, across 60 drafts from here"
                      style={{
                        alignSelf: 'center',
                        minWidth: 52,
                        marginRight: 10,
                        padding: '4px 6px',
                        borderRadius: 8,
                        border: `${sort === 'gone' ? 2 : 1}px solid ${gone !== null && gone >= 0.5 ? 'var(--neon-red)' : sort === 'gone' ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                        background: gone !== null && gone >= 0.5 ? 'rgba(255,34,34,0.12)' : 'var(--chip-bg)',
                        color: gone !== null && gone >= 0.5 ? 'var(--neon-red)' : 'var(--text-mid)',
                        textAlign: 'center',
                        lineHeight: 1.2,
                      }}
                    >
                      <span style={{ display: 'block', fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.05em' }}>GONE</span>
                      <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 800 }}>{pickPercent(gone)}</span>
                    </span>
                  ) : null}
                  <button
                    className="tap-btn"
                    type="button"
                    aria-label={`Draft ${player.fullName ?? player.name}`}
                    disabled={busy}
                    onClick={() => choose(player)}
                    style={{
                      alignSelf: 'center',
                      minWidth: 68,
                      minHeight: 40,
                      marginRight: 10,
                      padding: '0 12px',
                      borderRadius: 8,
                      border: 'none',
                      background: picking?.key === player.key ? 'var(--panel-border)' : 'var(--neon-teal)',
                      color: picking?.key === player.key ? 'var(--text-dim)' : '#001a14',
                      fontWeight: 800,
                      fontSize: '0.72rem',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {picking?.key === player.key ? '…' : 'DRAFT'}
                  </button>
                </div>
              );
            })}
          </div>
          <button
            className="tap-btn"
            type="button"
            disabled={busy}
            onClick={() => { setWriteIn(true); setError(null); }}
            style={{
              marginTop: 10,
              minHeight: 40,
              border: '1px dashed var(--panel-border)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--text-mid)',
              fontWeight: 800,
              fontSize: '0.7rem',
              letterSpacing: '0.05em',
            }}
          >
            NOT IN THE LIST? WRITE IN A PLAYER
          </button>
        </div>
      )}
      {error && !writeIn && (
        <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.85rem' }}>{error}</div>
      )}
    </SheetShell>
  );
}

/** Commissioner action sheet: clear a live (non-keeper) pick off the board. */
export function ClearPickSheet({ room: displayedRoom, cell, onClose }: { room: DraftRoom; cell: BoardCell; onClose: () => void }) {
  const [room] = useState(displayedRoom);
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = async () => {
    if (!identity || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await clearDraftPick(identity, cell.pick.overall, room);
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

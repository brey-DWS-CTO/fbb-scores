import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { POSITIONS, type Position, type ValueBoard } from '../../lib/league/draftValue.js';
import { autoPick, oddsGoneByNextPick, type LiveChoices } from '../../lib/league/liveMock.js';
import type { MockCandidate, MockPick, PreparedMock } from '../../lib/league/mockDraft.js';
import type { PlayerProjection } from '../../lib/league/projections.js';
import {
  draftGrid,
  moveQueued,
  picksUntilTurn,
  queuedPick,
  replaySaved,
  rosterBySlot,
  toggleQueued,
  upcomingPicks,
} from '../../lib/league/draftRoom.js';
import NavIcon from './NavIcon.js';
import { positionColor, positionTheme } from '../draft/boardUtils.js';

/** A position code in the board's own colour for it. */
function Pos({ positions }: { positions: readonly string[] }) {
  return <span style={{ color: positionColor([...positions]), fontWeight: 800 }}>{positions.join('/')}</span>;
}

/** Seconds on the clock at the person's pick. */
const PICK_CLOCK = 120;
/** Gap between one team's pick and the next on screen. */
const REVEAL_MS = 450;
const LIST_LIMIT = 150;

export interface RoomProgress {
  started: boolean;
  choices: Record<number, string>;
  queue: string[];
  clockLeft: number | null;
}

interface Props {
  prepared: PreparedMock;
  values: ValueBoard;
  projections: ReadonlyMap<string, PlayerProjection>;
  person: string;
  seed: number;
  /** Where the person left off, if they did. */
  saved: RoomProgress | null;
  onProgress: (progress: RoomProgress) => void;
  onNewDraft: () => void;
}

type CenterTab = 'players' | 'teams' | 'results';
type PhoneTab = 'draft' | 'queue' | 'team' | 'picks';
type SortKey = 'rank' | 'adp' | 'fppg' | 'total' | 'games' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'threes' | 'to' | 'gone';

const pct = (share: number) => `${Math.round(share * 100)}%`;
const one = (value: number | null | undefined) => (value === null || value === undefined ? '–' : value.toFixed(1));
type Clock = { overall: number; deadline: number; pausedAt: number | null } | null;

/** Whole seconds left on a clock at `at`, or null with no clock. */
function secondsOn(clock: Clock, at: number): number | null {
  return clock ? Math.min(PICK_CLOCK, Math.max(0, Math.ceil((clock.deadline - (clock.pausedAt ?? at)) / 1000))) : null;
}

const clockLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`);

/**
 * The mock draft room, laid out the way Yahoo's is: the clock and who picks
 * next on the left, the player card and the player list in the middle, your
 * queue, your team and the latest picks on the right. On a phone the clock
 * stays on top and the rest sits behind four tabs.
 *
 * The draft is a replay of the seed and the person's choices, the same as
 * before. What is new is that it is saved as it goes, so leaving the page and
 * coming back finds it where it was, with the clock paused.
 */
export default function DraftRoom({ prepared, values, projections, person, seed, saved, onProgress, onNewDraft }: Props) {
  // Only the first render restores; after that the room owns its state.
  const [restored] = useState(() => replaySaved(prepared, seed, person, saved?.choices ?? {}));
  const [started, setStarted] = useState(saved?.started === true);
  const [choices, setChoices] = useState<LiveChoices>(restored.choices);
  const [queue, setQueue] = useState<string[]>(saved?.queue ?? []);
  // A restored draft shows everything at once; there is nothing to watch roll in.
  const [revealed, setRevealed] = useState(saved?.started ? restored.live.picks.length : 0);
  const [clock, setClock] = useState<Clock>(() => {
    const waiting = restored.live.waitingOn?.pick.overall;
    if (!saved?.started || waiting === undefined || saved.clockLeft === null) return null;
    const at = Date.now();
    return { overall: waiting, deadline: at + saved.clockLeft * 1000, pausedAt: at };
  });
  const [now, setNow] = useState(() => Date.now());
  const [center, setCenter] = useState<CenterTab>('players');
  const [phone, setPhone] = useState<PhoneTab>('draft');
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [showDrafted, setShowDrafted] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [teamView, setTeamView] = useState(person);
  const [resultsView, setResultsView] = useState<'board' | 'list'>('board');

  const live = useMemo(() => replaySaved(prepared, seed, person, choices).live, [prepared, seed, person, choices]);
  const byKey = useMemo(() => new Map(values.entries.map((entry) => [entry.player.key, entry])), [values]);
  const caughtUp = revealed >= live.picks.length;
  // The draft halts at each of the person's own keeper slots, so they can see
  // who would still be there, then CONTINUE. The keeper itself never changes.
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set());
  const nextUp = live.picks[revealed];
  const atMyKeeper = started && !caughtUp && nextUp?.how === 'keeper' && nextUp.owner === person && !skipped.has(nextUp.overall)
    ? nextUp
    : null;
  const myTurn = started && caughtUp && live.waitingOn !== null;
  const over = started && caughtUp && live.over;
  const slots = prepared.input.board.slots;

  // ── Saving as it goes ────────────────────────────────────────────────────
  const clockRef = useRef(clock);
  // The pick the person is on the clock for right now, or null.
  const turnRef = useRef<number | null>(null);
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);
  useEffect(() => {
    turnRef.current = myTurn ? live.waitingOn?.pick.overall ?? null : null;
  }, [myTurn, live.waitingOn]);
  // Only a clock for the pick the person is actually on counts as time left.
  const clockLeftNow = () => {
    const current = clockRef.current;
    return current && current.overall === turnRef.current ? secondsOn(current, Date.now()) : null;
  };
  const progressRef = useRef<RoomProgress>({ started, choices: { ...choices }, queue, clockLeft: null });
  useEffect(() => {
    progressRef.current = { started, choices: { ...choices }, queue, clockLeft: clockLeftNow() };
    onProgress(progressRef.current);
  }, [started, choices, queue, onProgress]);
  useEffect(() => {
    // Leaving the page or the app keeps the clock where it stood.
    const keep = () => onProgress({ ...progressRef.current, clockLeft: clockLeftNow() });
    window.addEventListener('pagehide', keep);
    return () => {
      window.removeEventListener('pagehide', keep);
      keep();
    };
  }, [onProgress]);

  // ── The other teams pick, one at a time ──────────────────────────────────
  useEffect(() => {
    if (!started || caughtUp || atMyKeeper) return;
    const delay = live.picks[revealed]?.how === 'pick' ? REVEAL_MS : 0;
    const timer = setTimeout(() => setRevealed((current) => Math.min(current + 1, live.picks.length)), delay);
    return () => clearTimeout(timer);
  }, [started, caughtUp, revealed, live.picks, atMyKeeper]);

  // ── The clock ────────────────────────────────────────────────────────────
  const waitingOverall = live.waitingOn?.pick.overall ?? null;
  useEffect(() => {
    if (!myTurn || waitingOverall === null) {
      if (clock === null) return;
      const stop = setTimeout(() => setClock(null), 0);
      return () => clearTimeout(stop);
    }
    if (clock?.overall === waitingOverall) return;
    const start = setTimeout(() => setClock({ overall: waitingOverall, deadline: Date.now() + PICK_CLOCK * 1000, pausedAt: null }), 0);
    return () => clearTimeout(start);
  }, [myTurn, waitingOverall, clock]);

  useEffect(() => {
    if (!clock || clock.pausedAt !== null) return;
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= clock.deadline) {
        // Time is up: the top of the queue, else the best value left.
        const pick = queuedPick(queue, live.run.available(), autoPick(live));
        if (pick) setChoices((current) => ({ ...current, [clock.overall]: pick.playerKey }));
      }
    }, 250);
    return () => clearInterval(tick);
  }, [clock, live, queue]);
  const secondsLeft = secondsOn(clock, now);
  const paused = clock !== null && clock.pausedAt !== null;
  const togglePause = () =>
    setClock((current) => {
      if (!current) return current;
      const at = Date.now();
      return current.pausedAt === null
        ? { ...current, pausedAt: at }
        : { ...current, deadline: current.deadline + (at - current.pausedAt), pausedAt: null };
    });

  const odds = useMemo(
    () => (myTurn ? oddsGoneByNextPick(prepared, seed, person, live, 60) : new Map<string, number>()),
    [myTurn, prepared, seed, person, live],
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  const draft = (playerKey: string) => {
    if (!myTurn || !live.waitingOn) return;
    setChoices((current) => ({ ...current, [live.waitingOn!.pick.overall]: playerKey }));
    setQueue((current) => current.filter((key) => key !== playerKey));
    setSearch('');
  };
  const undo = () => {
    const mine = Object.keys(choices).map(Number).sort((a, b) => a - b);
    const last = mine[mine.length - 1];
    if (last === undefined) return;
    const next = { ...choices };
    delete next[last];
    setChoices(next);
    setRevealed(Math.min(revealed, last - 1));
  };
  const restart = (clearQueue = false) => {
    setStarted(false);
    setChoices({});
    setRevealed(0);
    setClock(null);
    if (clearQueue) setQueue([]);
    // Written now, not after the next render: NEW DRAFT unmounts this room
    // straight away, and the last thing it saves must be the empty draft.
    progressRef.current = { started: false, choices: {}, queue: clearQueue ? [] : queue, clockLeft: null };
  };

  // ── What the screen shows ────────────────────────────────────────────────
  const shownPicks = useMemo(() => (started ? live.picks.slice(0, revealed) : []), [started, live.picks, revealed]);
  // Who has each player: keepers from the start, then every pick on screen.
  const takenBy = new Map<string, Taken>();
  for (const slot of slots) {
    if (slot.keeper) {
      takenBy.set(slot.keeper.playerKey, {
        label: `${slot.pick.round}.${slot.pick.slot}`,
        owner: slot.pick.currentOwner,
        how: 'keeper',
        keeperStatus: slot.keeper.status,
        keeperEarly: slot.keeper.early,
      });
    }
  }
  for (const pick of shownPicks) if (pick.playerKey) takenBy.set(pick.playerKey, pick);
  const currentOverall = caughtUp
    ? live.waitingOn?.pick.overall ?? null
    : live.picks[revealed]?.overall ?? null;
  const currentSlot = currentOverall !== null ? slots.find((slot) => slot.pick.overall === currentOverall) ?? null : null;
  const untilTurn = currentOverall !== null ? picksUntilTurn(slots, currentOverall, person) : null;
  const myNext = slots.find((slot) => slot.pick.currentOwner === person && slot.pick.overall >= (currentOverall ?? 1) && !slot.keeper && !slot.made) ?? null;
  const upcoming = upcomingPicks(slots, currentOverall ?? 1, person, 30);

  // The pool as the screen sees it: who is still there, plus the taken when asked.
  const availableNow = useMemo(() => {
    const takenKeys = new Set(shownPicks.map((pick) => pick.playerKey));
    return prepared.pool.filter((candidate) => !takenKeys.has(candidate.playerKey));
  }, [prepared.pool, shownPicks]);
  const needle = search.trim().toLowerCase();
  // A search finds anyone, drafted or kept too, greyed out; so does Show drafted.
  const listed: MockCandidate[] = showDrafted || needle ? [...prepared.byKey.values()] : availableNow;
  const rowValue = (candidate: MockCandidate, key: SortKey): number | null => {
    const projection = projections.get(candidate.playerKey);
    switch (key) {
      case 'rank': return candidate.valueRank;
      case 'adp': return projection?.adp ?? null;
      case 'fppg': return projection?.fppg ?? null;
      case 'total': return projection?.total ?? null;
      case 'games': return projection?.games ?? null;
      case 'gone': return odds.get(candidate.playerKey) ?? (odds.size > 0 ? 0 : null);
      default: return projection?.line?.[key] ?? null;
    }
  };
  const rows = listed
    .filter((candidate) => position === 'ALL' || candidate.positions.includes(position))
    .filter((candidate) => {
      if (!needle) return true;
      const projection = projections.get(candidate.playerKey);
      return `${candidate.playerName} ${projection?.name ?? ''} ${projection?.proTeam ?? ''}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => {
      const x = rowValue(a, sort.key);
      const y = rowValue(b, sort.key);
      if (x === null || y === null) return x === y ? a.valueRank - b.valueRank : x === null ? 1 : -1;
      return (x - y) * sort.dir || a.valueRank - b.valueRank;
    })
    .slice(0, LIST_LIMIT);
  const sortBy = (key: SortKey) =>
    setSort((current) => (current.key === key
      ? { key, dir: current.dir === 1 ? -1 : 1 }
      : { key, dir: key === 'rank' || key === 'adp' || key === 'to' ? 1 : -1 }));
  // The line where your next pick falls, if the room takes players in this order.
  const pickLineAt = !myTurn && sort.key === 'rank' && sort.dir === 1 && !needle && position === 'ALL' && !showDrafted && untilTurn !== null && started
    ? untilTurn
    : null;

  const focus = selected ?? (myTurn ? queuedPick(queue, availableNow)?.playerKey ?? null : null) ?? availableNow[0]?.playerKey ?? null;
  const myPicks = live.run.result().rosters[person] ?? [];
  const myRoster = rosterBySlot(
    myPicks.filter((key) => shownPicks.some((pick) => pick.playerKey === key)).map((key) => ({ playerKey: key, positions: byKey.get(key)?.positions ?? [] })),
    prepared.roster,
  );
  // When the last pick lands, show the board.
  const [sawEnd, setSawEnd] = useState(false);
  if (over && !sawEnd) {
    setSawEnd(true);
    setCenter('results');
    setResultsView('board');
    setPhone('draft');
  }
  if (!over && sawEnd) setSawEnd(false);
  const rosterOf = (owner: string) => rosterBySlot(
    shownPicks
      .filter((pick) => pick.owner === owner && pick.playerKey)
      .map((pick) => ({ playerKey: pick.playerKey!, positions: pick.positions })),
    prepared.roster,
  );
  const teamRoster = rosterOf(teamView);
  const grid = draftGrid(slots, shownPicks, myTurn || !over ? currentOverall : null);
  const owners = grid.owners;

  const sortHead = (key: SortKey, label: string, title?: string) => (
    <th className={`room-num${sort.key === key ? ' is-sorted' : ''}`} title={title ?? label}>
      <button type="button" onClick={() => sortBy(key)}>
        {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  return (
    <div className={`room room-phone-${phone}`}>
      {/* ── Left: the clock and who picks next ── */}
      <aside className="room-left">
        <div className={`panel room-clock${myTurn ? ' is-mine' : ''}`}>
          {!started ? (
            <>
              <div className="room-clock-meta">Nine teams, one seat for you. {PICK_CLOCK / 60} minutes a pick.</div>
              <button type="button" className="tap-btn live-start-btn" onClick={() => setStarted(true)}>START DRAFT</button>
            </>
          ) : over ? (
            <>
              <div className="room-clock-big">DONE</div>
              <div className="room-clock-meta">Draft complete. <button type="button" className="room-link" onClick={() => { setCenter('results'); setPhone('draft'); }}>See the board</button></div>
            </>
          ) : (
            <>
              <div className="room-clock-row">
                <div className={`room-clock-big${secondsLeft !== null && secondsLeft <= 10 ? ' is-low' : ''}${paused ? ' is-paused' : ''}`} aria-live="polite">
                  {myTurn ? clockLabel(secondsLeft ?? PICK_CLOCK) : '…'}
                </div>
                {currentSlot && (
                  <div className="room-clock-meta">
                    Round {currentSlot.pick.round}<br />Pick {currentSlot.pick.slot}<br />{ordinal(currentSlot.pick.overall)} overall
                  </div>
                )}
              </div>
              {atMyKeeper ? (
                <div className="room-turn is-keeper">
                  <span>Draft is paused to show you who is there at your keeper selection.</span>
                  <button
                    type="button"
                    className="tap-btn mock-mini-btn is-primary"
                    onClick={() => setSkipped((current) => new Set(current).add(atMyKeeper.overall))}
                  >
                    CONTINUE
                  </button>
                </div>
              ) : myTurn ? (
                <div className="room-turn is-mine">
                  YOUR PICK
                  <button type="button" className="tap-btn mock-mini-btn" onClick={togglePause} aria-pressed={paused}>{paused ? 'RESUME' : 'PAUSE'}</button>
                </div>
              ) : (
                <div className="room-turn">
                  {untilTurn === null ? 'No picks left for you' : `${untilTurn} pick${untilTurn === 1 ? '' : 's'} until your turn`}
                  {myNext && <small> ({myNext.pick.round}.{myNext.pick.slot})</small>}
                </div>
              )}
            </>
          )}
          {started && (
            <div className="live-actions room-actions">
              <button type="button" className="tap-btn mock-mini-btn" onClick={() => restart()}>RESTART</button>
              <button type="button" className="tap-btn mock-mini-btn" onClick={undo} disabled={Object.keys(choices).length === 0}>UNDO</button>
              <button type="button" className="tap-btn mock-mini-btn" onClick={() => { restart(true); onNewDraft(); }}>NEW DRAFT</button>
            </div>
          )}
        </div>

        <div className="panel room-now">
          <div className="hub-heading room-head">
            <NavIcon name="target" size={14} className="icon-in-heading" />
            DRAFTING NOW
          </div>
          <ol className="room-upcoming">
            {upcoming.map((pick, index) => (
              <li key={pick.overall} className={`${pick.mine ? 'is-mine' : ''}${index === 0 && started && !over ? ' is-now' : ''}`}>
                {(index === 0 || upcoming[index - 1].round !== pick.round) && <div className="room-round">Round {pick.round}</div>}
                <span className="room-upcoming-row">
                  <span className="room-upcoming-num">{pick.overall}</span>
                  <span className="room-upcoming-owner">{pick.owner}</span>
                  {pick.fixed && <span className="mock-tag mock-tag-known">keeper</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      {/* ── Center: the player card and the lists ── */}
      <main className="room-center">
        {started && shownPicks.length > 0 && (() => {
          const last = shownPicks[shownPicks.length - 1];
          return (
            <div key={last.overall} className={`panel room-latest${last.owner === person ? ' is-mine' : ''}`} aria-live="polite">
              <span className="room-upcoming-num">{last.label}</span>
              <span><strong>{last.owner}</strong> {last.how === 'keeper' ? 'keeps' : 'takes'} <strong>{last.playerName ?? 'nobody'}</strong> <small><Pos positions={last.positions} /></small></span>
            </div>
          );
        })()}

        {focus && <PlayerCard
          playerKey={focus}
          projection={projections.get(focus) ?? null}
          entry={byKey.get(focus) ?? null}
          takenBy={takenBy.get(focus) ?? null}
          queued={queue.includes(focus)}
          canDraft={myTurn && !takenBy.has(focus)}
          picked={selected !== null}
          onClose={() => setSelected(null)}
          onDraft={() => { draft(focus); setSelected(null); }}
          onQueue={() => setQueue((current) => toggleQueued(current, focus))}
        />}


        <div className="room-tabs" role="tablist">
          {(['players', 'teams', 'results'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={center === tab} className={center === tab ? 'is-on' : ''} onClick={() => setCenter(tab)}>
              {tab === 'players' ? 'Players' : tab === 'teams' ? 'Teams' : 'Draft Results'}
            </button>
          ))}
        </div>

        {center === 'players' && (
          <div className="room-players">
            <div className="room-filters">
              <select className="hub-input mock-select" aria-label="Position" value={position} onChange={(event) => setPosition(event.target.value as Position | 'ALL')}>
                <option value="ALL">All players</option>
                {POSITIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              <input className="hub-input room-search" type="search" placeholder="Search for a player" value={search} onChange={(event) => setSearch(event.target.value)} />
              <label className="proj-check"><input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} /> Show drafted</label>
            </div>
            <div className="room-table-wrap">
              <table className="room-table">
                <thead>
                  <tr>
                    <th className="room-star" aria-label="Queue" />
                    {sortHead('rank', 'RK', 'Our board rank')}
                    {sortHead('adp', 'ADP')}
                    <th className="room-player-col">Player</th>
                    {sortHead('fppg', 'FPPG')}
                    {sortHead('total', 'TOTAL', 'Projected season points')}
                    {sortHead('games', 'GP')}
                    {sortHead('pts', 'PTS')}
                    {sortHead('reb', 'REB')}
                    {sortHead('ast', 'AST')}
                    {sortHead('stl', 'STL')}
                    {sortHead('blk', 'BLK')}
                    {sortHead('threes', '3PM')}
                    {sortHead('to', 'TO')}
                    {myTurn && sortHead('gone', 'GONE BY NEXT', 'How often he goes before your next pick, across 60 drafts from here')}
                    {myTurn && <th className="room-draft-col" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((candidate, index) => {
                    const projection = projections.get(candidate.playerKey);
                    const taken = takenBy.get(candidate.playerKey) ?? null;
                    const gone = odds.get(candidate.playerKey) ?? 0;
                    return (
                      <Fragment key={candidate.playerKey}>
                      {pickLineAt === index && myNext && (
                        <tr className="room-pickline"><td colSpan={16}>Your pick {myNext.pick.round}.{myNext.pick.slot}</td></tr>
                      )}
                      <tr
                        className={`${taken ? 'is-taken' : ''}${focus === candidate.playerKey ? ' is-focus' : ''}`}
                        onClick={() => setSelected(candidate.playerKey)}
                      >
                        <td className="room-star">
                          <button
                            type="button"
                            aria-label={queue.includes(candidate.playerKey) ? 'Take off my queue' : 'Add to my queue'}
                            aria-pressed={queue.includes(candidate.playerKey)}
                            className={queue.includes(candidate.playerKey) ? 'is-on' : ''}
                            onClick={(event) => { event.stopPropagation(); setQueue((current) => toggleQueued(current, candidate.playerKey)); }}
                          >
                            {queue.includes(candidate.playerKey) ? '★' : '☆'}
                          </button>
                        </td>
                        <td className="room-num">{candidate.valueRank}</td>
                        <td className="room-num">{one(projection?.adp)}</td>
                        <td className="room-player-col">
                          <span className="room-player-name">{projection?.name ?? candidate.playerName}</span>
                          <small>{projection?.proTeam ?? ''} – <Pos positions={candidate.positions} /></small>
                          {taken && (
                            <small className="room-taken">
                              {' '}{taken.label} {taken.owner}
                              {taken.how === 'keeper' && <> <KeeperChip projected={taken.keeperStatus === 'assumed'} early={taken.keeperEarly ?? null} /></>}
                            </small>
                          )}
                        </td>
                        <td className="room-num room-strong">{one(projection?.fppg)}</td>
                        <td className="room-num">{projection?.total?.toLocaleString() ?? '–'}</td>
                        <td className="room-num" title={projection?.gamesNote ?? undefined}>{projection?.games ?? '–'}{projection?.gamesNote ? '*' : ''}</td>
                        <td className="room-num">{one(projection?.line?.pts)}</td>
                        <td className="room-num">{one(projection?.line?.reb)}</td>
                        <td className="room-num">{one(projection?.line?.ast)}</td>
                        <td className="room-num">{one(projection?.line?.stl)}</td>
                        <td className="room-num">{one(projection?.line?.blk)}</td>
                        <td className="room-num">{one(projection?.line?.threes)}</td>
                        <td className="room-num">{one(projection?.line?.to)}</td>
                        {myTurn && <td className={`room-num${gone >= 0.5 ? ' is-hot' : ''}`}>{taken ? '–' : pct(gone)}</td>}
                        {myTurn && (
                          <td className="room-draft-col">
                            {!taken && (
                              <button type="button" className="tap-btn mock-mini-btn is-primary" onClick={(event) => { event.stopPropagation(); draft(candidate.playerKey); }}>
                                DRAFT
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={16} className="proj-empty">No players match.</td></tr>}
                </tbody>
              </table>
            </div>
            {myTurn && <div className="mock-note mock-note-dim">GONE BY NEXT: how often he is taken before your next pick, across 60 drafts played from here.</div>}
          </div>
        )}

        {center === 'teams' && (
          <div className="room-teams">
            <select className="hub-input mock-select" aria-label="Team" value={teamView} onChange={(event) => setTeamView(event.target.value)}>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}{owner === person ? ' (you)' : ''}</option>)}
            </select>
            <div className="room-table-wrap room-roster-wrap">
              <table className="room-table room-roster">
                <thead>
                  <tr>
                    <th className="room-slot-col">Slot</th>
                    <th className="room-player-col">Player</th>
                    {['FPPG', 'TOTAL', 'GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO'].map((label) => (
                      <th key={label} className="room-num"><span className="room-th">{label}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamRoster.map((fill, index) => {
                    const projection = fill.playerKey ? projections.get(fill.playerKey) ?? null : null;
                    const candidate = fill.playerKey ? prepared.byKey.get(fill.playerKey) ?? null : null;
                    const pick = fill.playerKey ? takenBy.get(fill.playerKey) ?? null : null;
                    const line = projection?.line ?? null;
                    return (
                      <tr key={`${fill.slot}-${index}`} className={fill.slot === 'BE' ? 'is-bench' : ''} onClick={() => fill.playerKey && setSelected(fill.playerKey)}>
                        <td className="room-slot-col">{fill.slot === 'BE' ? 'Bench' : fill.slot}</td>
                        <td className="room-player-col">
                          {candidate ? (
                            <>
                              <span className="room-player-name">{projection?.name ?? candidate.playerName}</span>
                              <small>{projection?.proTeam ?? ''} <Pos positions={candidate.positions} />{pick ? ` · ${pick.label}` : ''}</small>
                            </>
                          ) : <span className="mock-live">Empty</span>}
                        </td>
                        <td className="room-num room-strong">{candidate ? one(projection?.fppg) : '–'}</td>
                        <td className="room-num">{projection?.total?.toLocaleString() ?? '–'}</td>
                        <td className="room-num">{projection?.games ?? '–'}</td>
                        <td className="room-num">{one(line?.min)}</td>
                        <td className="room-num">{one(line?.pts)}</td>
                        <td className="room-num">{one(line?.reb)}</td>
                        <td className="room-num">{one(line?.ast)}</td>
                        <td className="room-num">{one(line?.stl)}</td>
                        <td className="room-num">{one(line?.blk)}</td>
                        <td className="room-num">{one(line?.threes)}</td>
                        <td className="room-num">{one(line?.to)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {center === 'results' && (
          <>
            <div className="mock-seg room-results-switch" role="radiogroup" aria-label="Board or list">
              {(['board', 'list'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={resultsView === choice}
                  className={`tap-btn mock-seg-btn${resultsView === choice ? ' is-on' : ''}`}
                  onClick={() => setResultsView(choice)}
                >
                  {choice === 'board' ? 'BOARD' : 'LIST'}
                </button>
              ))}
            </div>
            {resultsView === 'board' ? (
              <div className="room-grid-wrap">
                <table className="room-grid">
                  <thead>
                    <tr>
                      <th />
                      {owners.map((owner) => <th key={owner} className={owner === person ? 'is-mine' : ''}>{owner}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rounds.map((row, index) => (
                      <tr key={index}>
                        <th>R{index + 1}<small>{index % 2 === 0 ? '→' : '←'}</small></th>
                        {row.map((cell) => {
                          const theme = cell.pick?.playerName ? positionTheme([...cell.pick.positions]) : null;
                          const kept = cell.pick?.how === 'keeper';
                          const projected = kept && cell.pick?.keeperStatus === 'assumed';
                          return (
                            <td
                              key={cell.overall}
                              className={`${cell.owner === person ? 'is-mine' : ''}${cell.current ? ' is-now' : ''}${kept ? ' is-keeper' : ''}${projected ? ' is-projected' : ''}`}
                              style={theme ? {
                                background: `linear-gradient(155deg, ${theme.background} 0%, ${theme.deepBackground} 100%)`,
                                borderColor: theme.border,
                                boxShadow: `inset 3px 0 0 ${theme.color}`,
                              } : undefined}
                            >
                              <span className="room-grid-label">
                                {cell.round}.{cell.slot}{cell.via ? ` ${cell.owner}` : ''}
                                {kept && <KeeperChip projected={projected} early={cell.pick?.keeperEarly ?? null} />}
                              </span>
                              {cell.pick?.playerName
                                ? <>
                                  <span className="room-grid-name">{cell.pick.playerName}</span>
                                  <small style={{ color: theme?.color }}>{cell.pick.positions.join('/')}</small>
                                </>
                                : cell.current ? <span className="room-grid-name mock-live">on the clock</span> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ol className="room-team-list room-results-list">
                {shownPicks.map((pick) => (
                  <li key={pick.overall} className={pick.owner === person ? 'is-mine' : ''}>
                    <span className="room-upcoming-num">{pick.label}</span>
                    <span className="room-player-name">{pick.playerName ?? 'nobody'}</span>
                    <small><Pos positions={pick.positions} /></small>
                    {pick.how === 'keeper'
                      ? <span className={`mock-tag ${pick.keeperStatus === 'known' ? 'mock-tag-known' : 'mock-tag-assumed'}`}>{pick.keeperStatus === 'known' ? 'keeper' : 'projected'}</span>
                      : <span />}
                    <span className="room-update-owner">{pick.owner}</span>
                  </li>
                ))}
                {shownPicks.length === 0 && <li className="mock-live">No picks yet.</li>}
              </ol>
            )}
          </>
        )}

      </main>

      {/* ── Right: queue, team, updates ── */}
      <aside className="room-right">
        <div className="panel room-queue">
          <div className="hub-heading room-head">☆ MY QUEUE</div>
          {queue.length === 0 ? (
            <div className="mock-note mock-note-dim">Tap ☆ next to a player to queue him. If your clock runs out, you take the top one still there.</div>
          ) : (
            <ol className="room-queue-list">
              {queue.map((key, index) => {
                const candidate = prepared.byKey.get(key);
                const taken = takenBy.get(key);
                return (
                  <li key={key} className={taken ? 'is-taken' : ''}>
                    <span className="room-upcoming-num">{index + 1}</span>
                    <button type="button" className="room-queue-name" onClick={() => setSelected(key)}>
                      {candidate?.playerName ?? key}<small>{candidate?.positions.join('/')}{taken ? ` · gone ${taken.label}` : ''}</small>
                    </button>
                    <button type="button" className="room-icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => setQueue((current) => moveQueued(current, key, -1))}>↑</button>
                    <button type="button" className="room-icon-btn" aria-label="Move down" disabled={index === queue.length - 1} onClick={() => setQueue((current) => moveQueued(current, key, 1))}>↓</button>
                    <button type="button" className="room-icon-btn" aria-label="Remove" onClick={() => setQueue((current) => toggleQueued(current, key))}>✕</button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="panel room-team">
          <div className="hub-heading room-head">MY TEAM <small>{myRoster.filter((fill) => fill.playerKey).length} of {myRoster.length}</small></div>
          <ul className="room-slots">
            {myRoster.map((fill, index) => {
              const candidate = fill.playerKey ? prepared.byKey.get(fill.playerKey) : null;
              return (
                <li key={`${fill.slot}-${index}`}>
                  <span className="room-slot-name">{fill.slot === 'BE' ? 'Bench' : fill.slot}</span>
                  <span>{candidate ? candidate.playerName : <span className="mock-live">empty</span>}</span>
                  <span className="room-num">{candidate ? one(projections.get(candidate.playerKey)?.fppg) : ''}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="panel room-updates">
          <div className="hub-heading room-head">UPDATES</div>
          <ol className="room-update-list">
            {[...shownPicks].reverse().slice(0, 12).map((pick) => (
              <li key={pick.overall} className={`${pick.owner === person ? 'is-mine' : ''}${pick.how === 'keeper' ? ' is-keeper' : ''}`}>
                <span className="room-upcoming-num">{pick.label}</span>
                <span>
                  {pick.playerName ?? 'nobody'} <small><Pos positions={pick.positions} /></small>
                  {pick.how === 'keeper' && <> <KeeperChip projected={pick.keeperStatus === 'assumed'} early={pick.keeperEarly ?? null} /></>}
                </span>
                <span className="room-update-owner">{pick.owner}</span>
              </li>
            ))}
            {shownPicks.length === 0 && <li className="mock-live">No picks yet.</li>}
          </ol>
        </div>
      </aside>

      {/* ── Phone tabs ── */}
      <nav className="room-phone-tabs" aria-label="Draft room">
        {(['draft', 'queue', 'team', 'picks'] as const).map((tab) => (
          <button key={tab} type="button" className={phone === tab ? 'is-on' : ''} onClick={() => setPhone(tab)}>
            {tab === 'draft' ? 'PLAYERS' : tab === 'queue' ? `QUEUE${queue.length ? ` ${queue.length}` : ''}` : tab === 'team' ? 'MY TEAM' : 'PICKS'}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Who has a player, for the list, the card and the roster. */
type Taken = Pick<MockPick, 'label' | 'owner'> & Partial<Pick<MockPick, 'how' | 'keeperStatus' | 'keeperEarly'>>;

/** A keeper on the board, in the list and in the updates: K, solid when entered, dashed when projected. */
function KeeperChip({ projected, early }: { projected: boolean; early: string | null }) {
  return (
    <>
      <span
        className={`room-keeper-chip${projected ? ' is-projected' : ''}`}
        title={projected ? 'Projected keeper' : 'Keeper'}
        aria-label={projected ? 'Projected keeper' : 'Keeper'}
      >K</span>
      {early && <span className="keeper-early" title={early} aria-label={early}>↑</span>}
    </>
  );
}

interface CardProps {
  playerKey: string;
  projection: PlayerProjection | null;
  entry: ValueBoard['entries'][number] | null;
  takenBy: Taken | null;
  queued: boolean;
  canDraft: boolean;
  /** Tapped on purpose, rather than the default player shown. */
  picked: boolean;
  onClose: () => void;
  onDraft: () => void;
  onQueue: () => void;
}

function PlayerCard({ projection, entry, takenBy, queued, canDraft, picked, onClose, onDraft, onQueue }: CardProps) {
  const last = entry?.player.stats2026 ?? entry?.player.api2026 ?? null;
  const line = projection?.line ?? null;
  return (
    <section className={`panel room-card${picked ? ' is-picked' : ''}`}>
      <div className="room-card-head">
        <div>
          <div className="room-card-name">{projection?.name ?? entry?.player.name ?? 'Player'}</div>
          <div className="room-card-meta">
            {entry?.positions.join('/') ?? ''} | {projection?.proTeam ?? entry?.player.proTeam ?? ''}
            {projection?.espnRank ? ` | ESPN #${projection.espnRank}` : ''}
            {projection?.adp ? ` | ADP ${projection.adp.toFixed(1)}` : ''}
          </div>
        </div>
        <div className="room-card-actions">
          {takenBy
            ? <span className="room-card-taken">{takenBy.how === 'keeper' ? (takenBy.keeperStatus === 'assumed' ? 'Projected keeper' : 'Kept') : 'Drafted'} {takenBy.label} by {takenBy.owner}</span>
            : canDraft && <button type="button" className="tap-btn live-start-btn" onClick={onDraft}>DRAFT</button>}
          <button type="button" className={`tap-btn mock-mini-btn${queued ? ' is-on' : ''}`} onClick={onQueue}>{queued ? '★ QUEUED' : '☆ QUEUE'}</button>
          {picked && <button type="button" className="room-icon-btn" aria-label="Close" onClick={onClose}>✕</button>}
        </div>
      </div>
      <div className="room-card-table-wrap">
        <table className="room-card-table">
          <thead>
            <tr><th>Season</th><th>FPPG</th><th>Total</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TO</th></tr>
          </thead>
          <tbody>
            <tr>
              <th>Projected</th>
              <td>{one(projection?.fppg)}</td>
              <td>{projection?.total?.toLocaleString() ?? '–'}</td>
              <td title={projection?.gamesNote ?? undefined}>{projection?.games ?? '–'}{projection?.gamesNote ? '*' : ''}</td>
              <td>{one(line?.min)}</td><td>{one(line?.pts)}</td><td>{one(line?.reb)}</td><td>{one(line?.ast)}</td>
              <td>{one(line?.stl)}</td><td>{one(line?.blk)}</td><td>{one(line?.threes)}</td><td>{one(line?.to)}</td>
            </tr>
            <tr>
              <th>Last season</th>
              <td>{one(last && last.gp > 0 ? last.avg : null)}</td>
              <td>{last && last.gp > 0 ? Math.round(last.total).toLocaleString() : '–'}</td>
              <td>{last?.gp ?? '–'}</td>
              <td colSpan={8} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

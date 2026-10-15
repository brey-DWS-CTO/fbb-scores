import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { POSITIONS, type Position, type ValueBoard } from '../../lib/league/draftValue.js';
import { autoPick, oddsGoneByNextPick, oddsKeeperThere, type LiveChoices } from '../../lib/league/liveMock.js';
import type { MockCandidate, MockMode, MockPick, PreparedMock } from '../../lib/league/mockDraft.js';
import { editTitle, type PlayerProjection } from '../../lib/league/projections.js';
import {
  draftGrid,
  moveQueued,
  picksUntilTurn,
  queuedPick,
  replaySaved,
  rosterBySlot,
  shortName,
  toggleQueued,
  upcomingPicks,
} from '../../lib/league/draftRoom.js';
import NavIcon from './NavIcon.js';
import MockGradeCard from './MockGradeCard.js';
import MockBoardGrid, { KeeperChip } from './MockBoardGrid.js';
import { boardFromGrid, type SavedBoard } from '../../lib/league/mockBoard.js';
import ShareButton from './ShareButton.js';
import { gradeMock, mockResultId, type GradePlayer, type MockGrade } from '../../lib/league/mockGrade.js';
import { positionColor } from '../draft/boardUtils.js';

/** A position code in the board's own colour for it. */
function Pos({ positions }: { positions: readonly string[] }) {
  return <span style={{ color: positionColor([...positions]), fontWeight: 800 }}>{positions.join('/')}</span>;
}

/** Seconds on the clock at the person's pick. */
const PICK_CLOCK = 120;
/** Gap between one team's pick and the next on screen. */
const REVEAL_MS = 450;
const LIST_LIMIT = 150;
/** How far the player list scrolls sideways before names shorten, and how far back before they grow again. */
const SHORT_NAME_AT = 40;
const FULL_NAME_AT = 8;

export interface RoomProgress {
  started: boolean;
  choices: Record<number, string>;
  queue: string[];
  clockLeft: number | null;
  /** The last pick landed. */
  finished?: boolean;
}

interface Props {
  prepared: PreparedMock;
  values: ValueBoard;
  projections: ReadonlyMap<string, PlayerProjection>;
  /** Picks that move only if a switched-on pending trade goes through, to who holds them now. */
  projectedTrades?: ReadonlyMap<number, string>;
  person: string;
  seed: number;
  mode: MockMode;
  /** Where the person left off, if they did. */
  saved: RoomProgress | null;
  onProgress: (progress: RoomProgress) => void;
  onNewDraft: () => void;
  /** Called once when the last pick lands, with the draft's grade. */
  onFinished: (finished: { choices: Record<number, string>; grade: MockGrade; board: SavedBoard }) => void;
}

type CenterTab = 'players' | 'teams' | 'results';
type SortKey = 'rank' | 'adp' | 'fppg' | 'total' | 'games' | 'pi' | 'po' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'threes' | 'to' | 'gone';

const pct = (share: number) => `${Math.round(share * 100)}%`;
/** His NBA team's games in our play-in or playoff weeks. */
function PostseasonCell({ games }: { games: number | null | undefined }) {
  return <td className="room-num">{games ?? '–'}</td>;
}
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
 * pins on top, the card pins under it, and three tabs on the bottom bar
 * (Players, Teams, Draft Results) take the place of the app's own bar for as
 * long as the draft runs.
 *
 * The draft is a replay of the seed and the person's choices, the same as
 * before. What is new is that it is saved as it goes, so leaving the page and
 * coming back finds it where it was, with the clock paused.
 */
export default function DraftRoom({ prepared, values, projections, projectedTrades, person, seed, mode, saved, onProgress, onNewDraft, onFinished }: Props) {
  const navigate = useNavigate();
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
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [showDrafted, setShowDrafted] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [teamView, setTeamView] = useState(person);
  // Restart and new draft sit behind one small button.
  const [menuOpen, setMenuOpen] = useState(false);
  // On a phone the queue folds open above the player list.
  const [showQueue, setShowQueue] = useState(false);
  // The player list scrolled sideways: names shorten so the stats fit.
  const [scrolled, setScrolled] = useState(false);
  // Scrolled down into the list: the pinned clock and card slim down.
  // The page and the list each say whether they are scrolled down; either one
  // slims the stack. Kept apart so one never undoes the other mid-swipe.
  const [pageDown, setPageDown] = useState(false);
  const [listDown, setListDown] = useState(false);
  const compact = pageDown || listDown;
  // Tap a player anywhere (updates, a roster, the board) to see him in the card.
  const look = (key: string | null | undefined) => {
    if (!key) return;
    setSelected(key);
  };
  // The list first: the latest pick on top. The board is a tap away.
  const [resultsView, setResultsView] = useState<'list' | 'board'>('list');

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

  // ── The app steps aside while the draft runs (phone) ─────────────────────
  // The class on <html> hides the app's bottom bar, the section tabs and the
  // page heading, and the room's own bar takes the bottom of the screen.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('in-mock-room', started);
    return () => document.documentElement.classList.remove('in-mock-room');
  }, [started]);
  // The heights of the pinned stack (clock, card, filter row), so each piece
  // can sit right under the one above and the list can fill what is left.
  const roomRef = useRef<HTMLDivElement>(null);
  const clockRef2 = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const room = roomRef.current;
    const box = clockRef2.current;
    if (!room || !box || typeof ResizeObserver === 'undefined') return;
    const card = room.querySelector<HTMLElement>('.room-cards, .room-card.is-picked');
    const filters = room.querySelector<HTMLElement>('.room-filters-main');
    const height = (element: HTMLElement | null) => (element ? Math.round(element.getBoundingClientRect().height) : 0);
    const measure = () => {
      room.style.setProperty('--room-clock-h', `${height(box)}px`);
      room.style.setProperty('--room-card-h', `${height(card)}px`);
      room.style.setProperty('--room-filters-h', `${height(filters)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (card) observer.observe(card);
    if (filters) observer.observe(filters);
    return () => observer.disconnect();
  }, [selected, atMyKeeper, over, center, compact]);
  useEffect(() => {
    const onScroll = () => setPageDown((current) => (window.scrollY > 80 ? true : current && window.scrollY > 20));
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

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
  const progressRef = useRef<RoomProgress>({ started, choices: { ...choices }, queue, clockLeft: null, finished: saved?.finished === true });
  // A restore that could not replay every saved pick must not save over the
  // draft until the person does something: the board may only be part
  // loaded, and the full draft comes back once it is.
  const pristine = useRef(restored.dropped > 0);
  const firstReport = useRef(true);
  useEffect(() => {
    progressRef.current = { started, choices: { ...choices }, queue, clockLeft: clockLeftNow(), finished: over };
    if (firstReport.current) {
      firstReport.current = false;
      if (pristine.current) return;
    }
    pristine.current = false;
    onProgress(progressRef.current);
  }, [started, choices, queue, over, onProgress]);
  useEffect(() => {
    // Leaving the page or the app keeps the clock where it stood.
    const keep = () => {
      if (pristine.current) return;
      onProgress({ ...progressRef.current, clockLeft: clockLeftNow() });
    };
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
  // At your keeper: how often he would still have been there had you not kept him.
  const keeperOverall = atMyKeeper?.overall ?? null;
  const keeperOdds = useMemo(
    () => (keeperOverall !== null ? oddsKeeperThere(prepared, seed, person, keeperOverall, choices, 60) : null),
    [keeperOverall, prepared, seed, person, choices],
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
    // The replay runs forward again from here, so any keeper pause it had
    // passed on the way is due again.
    setSkipped((current) => new Set([...current].filter((overall) => overall < last)));
  };
  // RESTART plays the same draft over from the first pick, same room, same
  // seed, same queue. NEW DRAFT clears the room for a fresh seed.
  const restart = (fresh = false) => {
    setStarted(!fresh);
    setChoices({});
    setRevealed(0);
    setClock(null);
    setSkipped(new Set());
    setSelected(null);
    setMenuOpen(false);
    if (fresh) setQueue([]);
    // Written now, not after the next render: NEW DRAFT unmounts this room
    // straight away, and the last thing it saves must be the empty draft.
    progressRef.current = { started: !fresh, choices: {}, queue: fresh ? [] : queue, clockLeft: null, finished: false };
  };
  // Leave the room. The draft stays saved; DRAFT brings it back.
  const exit = () => navigate('/draft/start');

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
  // On your pick: the one after it, so you can tell whether a player will wait.
  const myAfter = slots.find((slot) => slot.pick.currentOwner === person && slot.pick.overall > (currentOverall ?? 1) && !slot.keeper && !slot.made) ?? null;
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
      case 'pi': return projection?.playInGames ?? null;
      case 'po': return projection?.playoffGames ?? null;
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

  // Paused at your keeper: his card stays up, and a tapped player sits beside
  // it to compare. Otherwise the card shows the tapped player, else the top of
  // the queue on your turn, else the best player left.
  const keeperKey = atMyKeeper?.playerKey ?? null;
  const focus = selected ?? keeperKey ?? (myTurn ? queuedPick(queue, availableNow)?.playerKey ?? null : null) ?? availableNow[0]?.playerKey ?? null;
  const compareKey = keeperKey !== null && selected !== null && selected !== keeperKey ? selected : null;
  const myPicks = live.run.result().rosters[person] ?? [];
  const myRoster = rosterBySlot(
    myPicks.filter((key) => shownPicks.some((pick) => pick.playerKey === key)).map((key) => ({ playerKey: key, positions: byKey.get(key)?.positions ?? [] })),
    prepared.roster,
  );
  // The grade, once the last pick lands, and one report of it to be saved.
  const grade = useMemo((): MockGrade | null => {
    if (!over) return null;
    const players = new Map<string, GradePlayer>();
    for (const [key, row] of projections) players.set(key, { name: row.name, positions: row.positions, total: row.total, fppg: row.fppg, adp: row.adp });
    return gradeMock(live.picks, person, players, prepared.roster);
  }, [over, projections, live.picks, person, prepared.roster]);
  const reported = useRef(false);
  useEffect(() => {
    if (!grade || reported.current) return;
    reported.current = true;
    onFinished({ choices: { ...choices }, grade, board: boardFromGrid(draftGrid(slots, live.picks, null)) });
  }, [grade, choices, onFinished, slots, live.picks]);
  // The link to this finished draft, the same one Past mocks keeps.
  const shareUrl = grade ? `${window.location.origin}/mock/result/${mockResultId(person, seed, mode, choices)}` : null;

  // When the last pick lands, show the board.
  const [sawEnd, setSawEnd] = useState(false);
  if (over && !sawEnd) {
    setSawEnd(true);
    setCenter('results');
  }
  if (!over && sawEnd) setSawEnd(false);
  const rosterOf = (owner: string) => rosterBySlot(
    shownPicks
      .filter((pick) => pick.owner === owner && pick.playerKey)
      .map((pick) => ({ playerKey: pick.playerKey!, positions: pick.positions })),
    prepared.roster,
  );
  const teamRoster = rosterOf(teamView);
  // Who a pick's row names, and its tag. A real trade: the holder, and whose
  // pick it was. A trade only switched on: who holds it now, and who would
  // if that trade goes through.
  const ownerShown = (overall: number, owner: string) => projectedTrades?.get(overall) ?? owner;
  const tradeTag = (overall: number, owner: string) => {
    const holderNow = projectedTrades?.get(overall);
    if (holderNow !== undefined) {
      return (
        <span className="board-traded-tag is-projected" title={`${holderNow}'s now. ${owner}'s if the trade you switched on goes through`}>
          {`${owner.toUpperCase()}'S, IF TRADED`}
        </span>
      );
    }
    const slot = slots.find((entry) => entry.pick.overall === overall);
    const original = slot ? slot.pick.originalOwner ?? slot.pick.currentOwner : owner;
    if (original === owner) return null;
    return (
      <span className="board-traded-tag" title={`${owner} holds ${original}'s pick`}>
        {`${original.toUpperCase()}'S`}
      </span>
    );
  };
  // Open a tab and bring it into view: on a phone it sits under the grade.
  const viewRef = useRef<HTMLDivElement>(null);
  const showView = (tab: CenterTab) => {
    setCenter(tab);
    setSelected(null);
    window.setTimeout(() => viewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  const seeBoard = () => {
    setResultsView('board');
    showView('results');
  };
  const seeTeam = (owner: string) => {
    setTeamView(owner);
    showView('teams');
  };
  const grid = draftGrid(slots, shownPicks, myTurn || !over ? currentOverall : null);
  const owners = grid.owners;
  const boardView = boardFromGrid(grid);

  const sortHead = (key: SortKey, label: string, title?: string, className = '') => (
    <th className={`room-num${sort.key === key ? ' is-sorted' : ''}${className ? ` ${className}` : ''}`} title={title ?? label} data-sort={key}>
      <button type="button" onClick={() => sortBy(key)}>
        {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const listTop = useRef(0);
  const onListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const left = event.currentTarget.scrollLeft;
    // A gap between the two marks, so a finger resting near one does not flicker.
    const next = scrolled ? left > FULL_NAME_AT : left > SHORT_NAME_AT;
    if (next !== scrolled) setScrolled(next);
    // A sideways swipe leaves scrollTop alone, so it never touches the stack.
    const top = event.currentTarget.scrollTop;
    if (top === listTop.current) return;
    listTop.current = top;
    const down = listDown ? top > 20 : top > 80;
    if (down !== listDown) setListDown(down);
  };
  // A sort chosen from the chips slides the list so that column lands flush
  // against the pinned name column. That column is narrower once the list is
  // scrolled, so narrow it first, let it settle, then slide once.
  const quickSort = (key: SortKey) => {
    sortBy(key);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const offset = () => {
      const column = wrap.querySelector<HTMLElement>(`th[data-sort="${key}"]`);
      const pinned = wrap.querySelector<HTMLElement>('th.room-player-col');
      return column && pinned ? column.offsetLeft - (pinned.offsetLeft + pinned.offsetWidth) : 0;
    };
    if (offset() <= SHORT_NAME_AT) {
      wrap.scrollTo({ left: Math.max(0, offset()), behavior: 'smooth' });
      return;
    }
    setScrolled(true);
    window.setTimeout(() => wrap.scrollTo({ left: Math.max(0, offset()), behavior: 'smooth' }), 260);
  };

  // On a phone a tapped card stands where the clock frame was, with the clock
  // small in its corner: the time on your pick, else the pick on the clock.
  const hasPicked = started && !over && selected !== null;
  // "Up in 3 picks at 7.9": how long until the person picks, and which pick.
  const upIn = untilTurn === null
    ? null
    : `Up in ${untilTurn} pick${untilTurn === 1 ? '' : 's'}${myNext ? ` at ${myNext.pick.round}.${myNext.pick.slot}` : ''}`;
  const miniClock = (
    <span className={`room-mini-clock${myTurn ? ' is-mine' : ''}${!myTurn && upIn ? ' is-wait' : ''}${secondsLeft !== null && secondsLeft <= 10 ? ' is-low' : ''}${paused ? ' is-paused' : ''}`} aria-live="polite">
      {myTurn ? clockLabel(secondsLeft ?? PICK_CLOCK) : upIn ?? (currentSlot ? `${currentSlot.pick.round}.${currentSlot.pick.slot}` : '…')}
    </span>
  );
  const cardFor = (key: string, extra: { role: 'keeper' | 'compare' | 'card' }) => (
    <PlayerCard
      key={`${extra.role}-${key}`}
      role={extra.role}
      corner={extra.role !== 'keeper' ? miniClock : null}
      playerKey={key}
      projection={projections.get(key) ?? null}
      entry={byKey.get(key) ?? null}
      takenBy={takenBy.get(key) ?? null}
      queued={queue.includes(key)}
      canDraft={myTurn && !takenBy.has(key)}
      picked={extra.role !== 'card' || selected !== null}
      onClose={() => setSelected(null)}
      onDraft={() => { draft(key); setSelected(null); }}
      onQueue={() => setQueue((current) => toggleQueued(current, key))}
    />
  );

  const queueList = queue.length === 0 ? (
    <div className="mock-note mock-note-dim">Tap a player, then ☆ QUEUE on his card. If your clock runs out, you take the top one still there.</div>
  ) : (
    <ol className="room-queue-list">
      {queue.map((key, index) => {
        const candidate = prepared.byKey.get(key);
        const taken = takenBy.get(key);
        return (
          <li key={key} className={taken ? 'is-taken' : ''}>
            <span className="room-upcoming-num">{index + 1}</span>
            <button type="button" className="room-queue-name" onClick={() => look(key)}>
              {candidate?.playerName ?? key}<small>{candidate?.positions.join('/')}{taken ? ` · gone ${taken.label}` : ''}</small>
            </button>
            <button type="button" className="room-icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => setQueue((current) => moveQueued(current, key, -1))}>↑</button>
            <button type="button" className="room-icon-btn" aria-label="Move down" disabled={index === queue.length - 1} onClick={() => setQueue((current) => moveQueued(current, key, 1))}>↓</button>
            <button type="button" className="room-icon-btn" aria-label="Remove" onClick={() => setQueue((current) => toggleQueued(current, key))}>✕</button>
          </li>
        );
      })}
    </ol>
  );

  const menu = (
    <div className="room-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="room-icon-btn room-menu-btn"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}
      >
        <NavIcon name="dots" size="1.2em" />
      </button>
      {menuOpen && (
        <div className="room-menu-sheet" role="menu">
          <button type="button" role="menuitem" className="tap-btn mock-mini-btn" onClick={() => restart()}>RESTART THIS DRAFT</button>
          <button type="button" role="menuitem" className="tap-btn mock-mini-btn" onClick={() => { restart(true); onNewDraft(); }}>NEW DRAFT</button>
          <button type="button" role="menuitem" className="tap-btn mock-mini-btn" onClick={exit}>LEAVE THE ROOM</button>
        </div>
      )}
    </div>
  );

  return (
    <div ref={roomRef} className={`room room-center-${center}${atMyKeeper ? ' is-at-keeper' : ''}${compact ? ' is-compact' : ''}${hasPicked ? ' has-picked' : ''}`}>
      {/* ── Left: the clock and who picks next ── */}
      <aside className="room-left">
        <div ref={clockRef2} className={`panel room-clock${myTurn ? ' is-mine' : ''}${started ? '' : ' is-before'}`}>
          {!started ? (
            <>
              <button type="button" className="tap-btn live-start-btn" onClick={() => setStarted(true)}>START DRAFT</button>
              <div className="room-clock-meta">Nine teams, one seat for you. {PICK_CLOCK / 60} minutes a pick.</div>
            </>
          ) : over ? (
            <>
              <div className="room-clock-row">
                <div className={`room-clock-big mock-grade-letter grade-${(grade?.grade ?? 'c')[0].toLowerCase()}`}>{grade?.grade ?? 'DONE'}</div>
                <div className="room-clock-meta"><span>Draft complete.</span><span>Saved to Past mocks.</span></div>
                {shareUrl && grade && <ShareButton url={shareUrl} title={`My mock draft: ${grade.grade}`} className="room-share" />}
                {menu}
              </div>
              <button type="button" className="room-link" onClick={seeBoard}>See the board</button>
            </>
          ) : (
            <>
              <div className="room-clock-row">
                <div className={`room-clock-big${secondsLeft !== null && secondsLeft <= 10 ? ' is-low' : ''}${paused ? ' is-paused' : ''}`} aria-live="polite">
                  {myTurn ? clockLabel(secondsLeft ?? PICK_CLOCK) : '…'}
                </div>
                {currentSlot && (
                  <div className="room-clock-meta">
                    <span>Round {currentSlot.pick.round}</span><span>Pick {currentSlot.pick.slot}</span><span>{ordinal(currentSlot.pick.overall)} overall</span>
                  </div>
                )}
                <button
                  type="button"
                  className="tap-btn room-undo-btn"
                  onClick={undo}
                  disabled={Object.keys(choices).length === 0}
                  title="Take back your last pick"
                >
                  <NavIcon name="undo" size="1.5em" />
                  <span>UNDO</span>
                </button>
              </div>
              {atMyKeeper ? (
                <div className="room-turn is-keeper">
                  <span>
                    Paused at your keeper: <strong>{atMyKeeper.playerName}</strong>
                    {keeperOdds !== null && (
                      <small className="room-keeper-odds">
                        Without the keep, he is still here at this pick <strong>{pct(keeperOdds)}</strong> of the time.
                      </small>
                    )}
                  </span>
                  <button
                    type="button"
                    className="tap-btn mock-mini-btn is-primary"
                    onClick={() => { setSkipped((current) => new Set(current).add(atMyKeeper.overall)); setSelected(null); }}
                  >
                    CONTINUE
                  </button>
                  {menu}
                </div>
              ) : myTurn ? (
                <div className="room-turn is-mine">
                  <span>
                    YOUR PICK
                    {myAfter && <small className="room-turn-next"> · next at {myAfter.pick.round}.{myAfter.pick.slot}</small>}
                  </span>
                  <button type="button" className="tap-btn mock-mini-btn" onClick={togglePause} aria-pressed={paused}>{paused ? 'RESUME' : 'PAUSE'}</button>
                  {menu}
                </div>
              ) : (
                <div className="room-turn">
                  {upIn ?? 'No picks left for you'}
                  {menu}
                </div>
              )}
            </>
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
                  {pick.keeper && <KeeperChip projected={pick.keeper === 'assumed'} early={null} />}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      {/* ── Center: the player card and the lists ── */}
      <main className="room-center">
        {grade && (
          <section className="panel room-grade">
            <div className="hub-heading room-head">
              HOW YOU DID
              {shareUrl && <ShareButton url={shareUrl} title={`My mock draft: ${grade.grade}`} />}
            </div>
            <MockGradeCard grade={grade} person={person} onPlayer={(key) => setSelected(key)} onTeam={seeTeam} />
          </section>
        )}

        {started && shownPicks.length > 0 && (() => {
          const last = shownPicks[shownPicks.length - 1];
          return (
            <div key={last.overall} className={`panel room-latest is-tappable${last.owner === person ? ' is-mine' : ''}`} aria-live="polite" onClick={() => look(last.playerKey)}>
              <span className="room-upcoming-num">{last.label}</span>
              <span><strong>{last.owner}</strong> {last.how === 'keeper' ? 'keeps' : 'takes'} <strong>{last.playerName ?? 'nobody'}</strong> <small><Pos positions={last.positions} /></small></span>
            </div>
          );
        })()}

        {/* At your keeper: his card, then whoever you tap to compare. */}
        {keeperKey ? (
          <div className="room-cards">
            {cardFor(keeperKey, { role: 'keeper' })}
            {compareKey && cardFor(compareKey, { role: 'compare' })}
          </div>
        ) : focus && cardFor(focus, { role: 'card' })}

        <div className="room-tabs" role="tablist">
          {(['players', 'teams', 'results'] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={center === tab} className={center === tab ? 'is-on' : ''} onClick={() => setCenter(tab)}>
              {tab === 'players' ? 'Players' : tab === 'teams' ? 'Teams' : 'Draft Results'}
            </button>
          ))}
        </div>
        <div ref={viewRef} className="room-view-anchor" />

        {center === 'players' && (
          <div className="room-players">
            <div className="room-filters room-filters-main">
              <select className="hub-input mock-select" aria-label="Position" value={position} onChange={(event) => setPosition(event.target.value as Position | 'ALL')}>
                <option value="ALL">All players</option>
                {POSITIONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              {/* Phone: sort chips, pinned with this row under the clock. Wide screens sort by the column heads. */}
              <span className="room-sort-quick" role="group" aria-label="Sort by">
                {([['rank', 'RK'], ['adp', 'ADP'], ['total', 'TOT'], ['fppg', 'FPPG'], ...(myTurn ? [['gone', 'GONE']] as const : [])] as const).map(([key, label]) => (
                  <button key={key} type="button" className={sort.key === key ? 'is-on' : ''} aria-pressed={sort.key === key} onClick={() => quickSort(key)}>
                    {label}{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className={`tap-btn mock-mini-btn room-queue-toggle${showQueue ? ' is-on' : ''}`}
                aria-expanded={showQueue}
                onClick={() => setShowQueue((current) => !current)}
              >
                {showQueue ? '★' : '☆'}<span className="room-queue-word"> QUEUE</span>{queue.length ? ` ${queue.length}` : ''}
              </button>
            </div>
            <div className="room-filters room-filters-search">
              <input className="hub-input room-search" type="search" placeholder="Search for a player" value={search} onChange={(event) => setSearch(event.target.value)} />
              <label className="proj-check"><input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} /> Show drafted</label>
            </div>
            {showQueue && <div className="panel room-queue-fold">{queueList}</div>}
            <div ref={wrapRef} className={`room-table-wrap${scrolled ? ' is-scrolled' : ''}`} onScroll={onListScroll}>
              <table className={`room-table${myTurn ? ' is-my-turn' : ''}`}>
                <thead>
                  <tr>
                    {/* DRAFT and GONE lead the row, on a phone and a wide screen alike. */}
                    {myTurn && <th className="room-draft-col room-draft-lead" />}
                    {myTurn && sortHead('gone', 'GONE', 'How often he goes before your next pick, across 60 drafts from here', 'room-gone-lead')}
                    <th className="room-star" aria-label="Queue" />
                    <th className="room-player-col">Player</th>
                    {sortHead('rank', 'RK', 'Our board rank')}
                    {sortHead('adp', 'ADP')}
                    {sortHead('fppg', 'FPPG')}
                    {sortHead('total', 'TOTAL', 'Projected season points')}
                    {sortHead('games', 'GP')}
                    {sortHead('pi', 'PI', 'Team games in our play-in weeks')}
                    {sortHead('po', 'PO', 'Team games in our playoff weeks')}
                    {sortHead('pts', 'PTS')}
                    {sortHead('reb', 'REB')}
                    {sortHead('ast', 'AST')}
                    {sortHead('stl', 'STL')}
                    {sortHead('blk', 'BLK')}
                    {sortHead('threes', '3PM')}
                    {sortHead('to', 'TO')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((candidate, index) => {
                    const projection = projections.get(candidate.playerKey);
                    const taken = takenBy.get(candidate.playerKey) ?? null;
                    const gone = odds.get(candidate.playerKey) ?? 0;
                    const fullName = projection?.name ?? candidate.playerName;
                    const draftButton = taken ? null : (
                      <button type="button" className="tap-btn mock-mini-btn is-primary" onClick={(event) => { event.stopPropagation(); draft(candidate.playerKey); }}>
                        DRAFT
                      </button>
                    );
                    const goneCell = (className: string) => (
                      <td className={`room-num ${className}${gone >= 0.5 ? ' is-hot' : ''}`}>{taken ? '–' : pct(gone)}</td>
                    );
                    return (
                      <Fragment key={candidate.playerKey}>
                      {pickLineAt === index && myNext && (
                        <tr className="room-pickline"><td colSpan={20}>Your pick {myNext.pick.round}.{myNext.pick.slot}</td></tr>
                      )}
                      <tr
                        className={`${taken ? 'is-taken' : ''}${focus === candidate.playerKey ? ' is-focus' : ''}`}
                        onClick={() => setSelected(candidate.playerKey)}
                      >
                        {myTurn && <td className="room-draft-col room-draft-lead">{draftButton}</td>}
                        {myTurn && goneCell('room-gone-lead')}
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
                        <td className="room-player-col">
                          <span className="room-player-line">
                            <span className="room-player-name">
                              <span className="room-name-full">{fullName}</span>
                              <span className="room-name-short">{shortName(fullName)}</span>
                            </span>
                            {/* On a phone the team goes and the position stays whole. */}
                            <small className="room-player-sub"><span className="room-player-team">{projection?.proTeam ?? ''} – </span><Pos positions={candidate.positions} /></small>
                            {taken && (
                              <small className="room-taken">
                                {' '}{taken.label} {taken.owner}
                                {taken.how === 'keeper' && <> <KeeperChip projected={taken.keeperStatus === 'assumed'} early={taken.keeperEarly ?? null} /></>}
                              </small>
                            )}
                          </span>
                        </td>
                        <td className="room-num">{candidate.valueRank}</td>
                        <td className="room-num">{one(projection?.adp)}</td>
                        <td className="room-num room-strong">{one(projection?.fppg)}</td>
                        <td className="room-num">{projection?.total?.toLocaleString() ?? '–'}</td>
                        <td className="room-num" title={projection ? editTitle(projection) ?? undefined : undefined}>{projection?.games ?? '–'}{projection?.edit ? '*' : ''}</td>
                        <PostseasonCell games={projection?.playInGames} />
                        <PostseasonCell games={projection?.playoffGames} />
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
            {myTurn && <div className="mock-note mock-note-dim">GONE: how often he is taken before your next pick, across 60 drafts played from here.</div>}
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
                    {['FPPG', 'TOTAL', 'GP', 'PI', 'PO', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'TO'].map((label) => (
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
                      <tr key={`${fill.slot}-${index}`} className={fill.slot === 'BE' ? 'is-bench' : ''} onClick={() => look(fill.playerKey)}>
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
                        <PostseasonCell games={projection?.playInGames} />
                        <PostseasonCell games={projection?.playoffGames} />
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
              {(['list', 'board'] as const).map((choice) => (
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
              <MockBoardGrid
                owners={owners}
                rounds={boardView.rounds}
                person={person}
                projectedTrades={projectedTrades}
                onPlayer={look}
              />
            ) : (
              <ol className="room-team-list room-results-list">
                {/* Newest pick first, so the one that just landed is on top. */}
                {[...shownPicks].reverse().map((pick) => (
                  <li key={pick.overall} className={`${pick.owner === person ? 'is-mine' : ''} is-tappable`} onClick={() => look(pick.playerKey)}>
                    <span className="room-upcoming-num">{pick.label}</span>
                    <span className="room-player-name">{pick.playerName ?? 'nobody'}</span>
                    <small><Pos positions={pick.positions} /></small>
                    {pick.how === 'keeper'
                      ? <span><KeeperChip projected={pick.keeperStatus === 'assumed'} early={pick.keeperEarly ?? null} /></span>
                      : <span />}
                    <span className="room-update-owner">{ownerShown(pick.overall, pick.owner)}{tradeTag(pick.overall, pick.owner)}</span>
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
          {queueList}
        </div>

        <div className="panel room-team">
          <div className="hub-heading room-head">MY TEAM <small>{myRoster.filter((fill) => fill.playerKey).length} of {myRoster.length}</small></div>
          <ul className="room-slots">
            {myRoster.map((fill, index) => {
              const candidate = fill.playerKey ? prepared.byKey.get(fill.playerKey) : null;
              return (
                <li key={`${fill.slot}-${index}`} className={fill.playerKey ? 'is-tappable' : ''} onClick={() => look(fill.playerKey)}>
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
              <li key={pick.overall} className={`${pick.owner === person ? 'is-mine' : ''}${pick.how === 'keeper' ? ' is-keeper' : ''} is-tappable`} onClick={() => look(pick.playerKey)}>
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

      {/* ── Phone: the room's own bottom bar, while the draft runs ── */}
      {started && (
        <nav className="room-phone-tabs" aria-label="Draft room">
          {(['players', 'teams', 'results'] as const).map((tab) => (
            <button key={tab} type="button" className={center === tab ? 'is-on' : ''} onClick={() => setCenter(tab)}>
              <span aria-hidden="true"><NavIcon name={tab === 'players' ? 'people' : tab === 'teams' ? 'home' : 'trophy'} /></span>
              <span className="hub-heading">{tab === 'players' ? 'PLAYERS' : tab === 'teams' ? 'TEAMS' : 'RESULTS'}</span>
            </button>
          ))}
          <button type="button" className="is-exit" onClick={exit}>
            <span aria-hidden="true"><NavIcon name="close" /></span>
            <span className="hub-heading">EXIT</span>
          </button>
        </nav>
      )}
    </div>
  );
}

/** Who has a player, for the list, the card and the roster. */
type Taken = Pick<MockPick, 'label' | 'owner'> & Partial<Pick<MockPick, 'how' | 'keeperStatus' | 'keeperEarly'>>;


interface CardProps {
  playerKey: string;
  /** The keeper you are paused at, a player tapped to compare with him, or the one card. */
  role: 'keeper' | 'compare' | 'card';
  projection: PlayerProjection | null;
  entry: ValueBoard['entries'][number] | null;
  takenBy: Taken | null;
  queued: boolean;
  canDraft: boolean;
  /** Tapped on purpose, rather than the default player shown. */
  picked: boolean;
  /** A small clock for the card's corner, on a phone. */
  corner?: React.ReactNode;
  onClose: () => void;
  onDraft: () => void;
  onQueue: () => void;
}

function PlayerCard({ role, projection, entry, takenBy, queued, canDraft, picked, corner, onClose, onDraft, onQueue }: CardProps) {
  // Last season stays folded until asked for; the projection is the point.
  const [showLast, setShowLast] = useState(false);
  const last = entry?.player.stats2026 ?? entry?.player.api2026 ?? null;
  const lastLine = projection?.lastLine ?? null;
  const line = projection?.line ?? null;
  const lastToggle = (
    <button type="button" className="room-card-last-toggle" aria-pressed={showLast} onClick={() => setShowLast((current) => !current)}>
      {showLast ? 'hide last season' : 'last season'}
    </button>
  );
  // A tagged or taken card has a top line already; the pill and the toggle
  // ride on it, so the card is a row shorter.
  const topLine = role !== 'card' || takenBy !== null;
  return (
    <section className={`panel room-card room-card-${role}${picked ? ' is-picked' : ''}`}>
      <div className="room-card-head">
        <div className="room-card-main">
          {topLine && (
            <div className="room-card-top">
              {role === 'keeper' && <span className="room-card-tag">YOUR KEEPER</span>}
              {role === 'compare' && <span className="room-card-tag is-compare">COMPARE</span>}
              {takenBy && <span className="room-card-taken">{takenBy.how === 'keeper' ? (takenBy.keeperStatus === 'assumed' ? 'Projected keeper' : 'Kept') : 'Drafted'} {takenBy.label} by {takenBy.owner}</span>}
              {lastToggle}
            </div>
          )}
          <div className="room-card-name">{projection?.name ?? entry?.player.name ?? 'Player'}</div>
          <div className="room-card-meta">
            {entry?.positions.join('/') ?? ''} | {projection?.proTeam ?? entry?.player.proTeam ?? ''}
            {projection?.espnRank ? ` | ESPN #${projection.espnRank}` : ''}
            {projection?.adp ? ` | ADP ${projection.adp.toFixed(1)}` : ''}
            {!topLine && lastToggle}
          </div>
        </div>
        {(!takenBy || (picked && role !== 'keeper') || corner) && (
          <div className="room-card-actions">
            {corner}
            {!takenBy && canDraft && <button type="button" className="tap-btn live-start-btn" onClick={onDraft}>DRAFT</button>}
            {!takenBy && <button type="button" className={`tap-btn mock-mini-btn${queued ? ' is-on' : ''}`} onClick={onQueue}>{queued ? '★ QUEUED' : '☆ QUEUE'}</button>}
            {picked && role !== 'keeper' && <button type="button" className="room-icon-btn" aria-label="Close" onClick={onClose}>✕</button>}
          </div>
        )}
      </div>
      <div className="room-card-table-wrap">
        <table className="room-card-table">
          <thead>
            <tr><th aria-label="Season" /><th>FPPG</th><th>Total</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>3PM</th><th>TO</th></tr>
          </thead>
          <tbody>
            <tr>
              <th>Projected</th>
              <td>{one(projection?.fppg)}</td>
              <td>{projection?.total?.toLocaleString() ?? '–'}</td>
              <td title={projection ? editTitle(projection) ?? undefined : undefined}>{projection?.games ?? '–'}{projection?.edit ? '*' : ''}</td>
              <td>{one(line?.min)}</td><td>{one(line?.pts)}</td><td>{one(line?.reb)}</td><td>{one(line?.ast)}</td>
              <td>{one(line?.stl)}</td><td>{one(line?.blk)}</td><td>{one(line?.threes)}</td><td>{one(line?.to)}</td>
            </tr>
            {showLast && <tr>
              <th>Last season</th>
              <td>{one(last && last.gp > 0 ? last.avg : null)}</td>
              <td>{last && last.gp > 0 ? Math.round(last.total).toLocaleString() : '–'}</td>
              <td>{last?.gp ?? '–'}</td>
              <td>{one(lastLine?.min)}</td><td>{one(lastLine?.pts)}</td><td>{one(lastLine?.reb)}</td><td>{one(lastLine?.ast)}</td>
              <td>{one(lastLine?.stl)}</td><td>{one(lastLine?.blk)}</td><td>{one(lastLine?.threes)}</td><td>{one(lastLine?.to)}</td>
            </tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

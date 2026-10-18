import { stateSide, type DraftRoom } from '../../lib/league/testDraft.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { BoardCell } from '../../lib/keeper/types.js';
import { availablePlayers, buildDraftBoard, pickLabel } from '../../lib/keeper/engine.js';
import { earlyKeeperNote } from '../../lib/league/keeperEarly.js';
import {
  useApplyStateResponse,
  useDraftData,
  useIdentity,
  useKeeperScenario,
} from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  checkInDraftRoom,
  clearKeeperScenario,
  endTestDraft,
  exitSandbox,
  expireDraftClock,
  joinTestDraft,
  leaveTestDraft,
  sandboxActive,
  startDraft,
  startTestDraft,
  testDraftJoined,
} from '../../lib/league/api.js';
import { clockExpired } from '../../lib/league/draftClock.js';
import { formatDraftAt } from '../../lib/league/format.js';
import { PRESENCE_POLL_MS, roomChanges } from '../../lib/league/presence.js';
import {
  projectedPlayerKeys,
  stateWithKeeperScenario,
} from '../../lib/league/keeperScenario.js';
import { DraftCountdown } from '../../hooks/useCountdown.js';
import { useDraftNumbers } from '../../hooks/useDraftNumbers.js';
import { useDraftSounds } from '../../hooks/useDraftSounds.js';
import { useTeamName } from '../../hooks/useTeamNames.js';
import IdentityChip from '../league/IdentityChip.js';
import NavIcon from '../league/NavIcon.js';
import TeamPickerModal from '../league/TeamPickerModal.js';
import BoardGrid from './BoardGrid.js';
import LiveRoom from './LiveRoom.js';
import AutoPanel from './AutoPanel.js';
import { ClockControls, ClockReadout, DraftTimingPanel } from './DraftClock.js';
import PickSheet, { ClearPickSheet } from './PickSheet.js';
import {
  ACTION_BUTTON,
  cellDisplay,
  POSITION_ORDER,
  positionColor,
  positionTheme,
  recentPicks,
} from './boardUtils.js';

/** Picks shown under the clock before SHOW ALL. */
const RECENT_LIMIT = 10;

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
  projected,
  tappable,
  onTap,
}: {
  cell: BoardCell;
  projected: boolean;
  tappable: boolean;
  onTap: (cell: BoardCell) => void;
}) {
  const d = cellDisplay(cell);
  const theme = positionTheme(d?.positions);
  const [showTrade, setShowTrade] = useState(false);
  return (
    <div
      className={cell.onClock ? 'pulse-glow' : undefined}
      onClick={tappable ? () => onTap(cell) : undefined}
      onKeyDown={
        tappable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onTap(cell);
              }
            }
          : undefined
      }
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        borderBottom: '1px solid var(--panel-border)',
        boxShadow: d
          ? `inset 3px 0 0 ${d.color}${cell.pick.viaTradeFrom ? ', inset -3px 0 0 var(--neon-yellow)' : ''}`
          : cell.pick.viaTradeFrom ? 'inset 3px 0 0 var(--neon-yellow)' : undefined,
        background: cell.onClock
          ? 'rgba(0,255,204,0.06)'
          : d
            ? `linear-gradient(100deg, ${theme.deepBackground} 0%, ${theme.background} 100%)`
            : cell.pick.viaTradeFrom ? 'rgba(255,230,0,0.06)' : 'transparent',
        outline: cell.onClock ? '2px solid var(--neon-teal)' : undefined,
        outlineOffset: cell.onClock ? -2 : undefined,
        border: projected ? '1px dashed var(--neon-purple)' : undefined,
        opacity: projected ? 0.78 : 1,
        cursor: tappable ? 'pointer' : 'default',
      }}
    >
      <div style={{ minWidth: 46, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-hi)' }}>
          {pickLabel(cell.pick)}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>#{cell.pick.overall}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-mid)', fontWeight: 600 }}>
            {cell.pick.currentOwner}
          </span>
          {cell.pick.viaTradeFrom && (
            <span
              title={cell.pick.tradeNote}
              onClick={(e) => {
                e.stopPropagation();
                setShowTrade((v) => !v);
              }}
              className="board-traded-tag"
              style={{ fontSize: '0.62rem', cursor: 'pointer' }}
            >
              TRADED · via {cell.pick.viaTradeFrom} ⓘ
            </span>
          )}
        </div>
        {showTrade && cell.pick.tradeNote && (
          <div
            style={{
              color: 'var(--neon-yellow)',
              fontSize: '0.7rem',
              background: 'rgba(255,230,0,0.06)',
              border: '1px solid rgba(255,230,0,0.3)',
              borderRadius: 6,
              padding: '4px 8px',
              margin: '4px 0',
            }}
          >
            {cell.pick.tradeDate}: {cell.pick.tradeNote}
          </div>
        )}
        {cell.keeper && d ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#fff', fontWeight: 700 }}>
              <NavIcon name="lock" size={14} label="Keeper" />
              {d.name}
            </span>
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
              {projected ? 'PROJECTED' : 'KEEPER'} · R{d.keeperRound ?? '?'}
            </span>
            {cell.keeper.bumped && (
              <span className="keeper-early-note">↑ {earlyKeeperNote(cell.keeper, pickLabel(cell.pick))}</span>
            )}
          </div>
        ) : d ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#fff', fontWeight: 700 }}>{d.name}</span>
            <PosChip positions={d.positions} />
            {d.auto ? (
              <span className="auto-tag">AUTO</span>
            ) : d.enteredBy && (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>by {d.enteredBy}</span>
            )}
          </div>
        ) : (
          <div
            style={{
              color: cell.onClock ? 'var(--neon-teal)' : cell.skipped ? 'var(--neon-red)' : 'var(--text-ghost)',
              fontWeight: cell.onClock || cell.skipped ? 700 : 400,
            }}
          >
            {cell.onClock ? 'ON THE CLOCK' : cell.skipped ? `SKIPPED · ${tappable ? 'tap to enter' : 'open any time'}` : '—'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DraftPage() {
  const [side] = useState(() => testDraftJoined() ? 'test' as const : 'league' as const);
  const { state, meta, dataset, playerPoolQuery } = useDraftData(true, side);
  const room: DraftRoom = useMemo(() => stateSide(meta) === 'test'
    ? { side: 'test', startedAt: state.draft.startedAt }
    : { side: 'league' }, [meta, state.draft.startedAt]);
  const { identity } = useIdentity();
  const teamName = useTeamName();
  const scenarioQuery = useKeeperScenario();
  const applyState = useApplyStateResponse();
  const [view, setView] = useState<'list' | 'grid'>('grid');
  const [pickTarget, setPickTarget] = useState<BoardCell | null>(null);
  // The picker opens straight to the write-in form from the player list.
  const [pickWriteIn, setPickWriteIn] = useState(false);
  const [clearTarget, setClearTarget] = useState<BoardCell | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [startArmed, setStartArmed] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const started = state.draft.startedAt !== null;
  const poolReady = playerPoolQuery.isSuccess;
  const scenario = useMemo(
    () => !started && meta?.revealed !== true ? scenarioQuery.scenario : {},
    [meta?.revealed, scenarioQuery.scenario, started],
  );
  const scenarioActive = Object.keys(scenario).length > 0;
  const projectedKeys = useMemo(() => projectedPlayerKeys(scenario), [scenario]);
  const boardState = useMemo(
    () => scenarioActive ? stateWithKeeperScenario(state, scenario, meta?.keeperStatus) : state,
    [scenario, scenarioActive, state, meta?.keeperStatus],
  );

  const clearScenario = async () => {
    if (!identity || scenarioBusy) return;
    setScenarioBusy(true);
    setScenarioError(null);
    try {
      const response = await clearKeeperScenario(identity);
      scenarioQuery.setScenario(response.scenario);
    } catch (error) {
      setScenarioError(apiErrorMessage(error));
    } finally {
      setScenarioBusy(false);
    }
  };

  const doStartDraft = async () => {
    if (!identity) return;
    setStartArmed(false);
    try {
      applyState(await startDraft(identity));
    } catch (e) {
      setStartError(apiErrorMessage(e));
    }
  };

  // The shared test draft: a copy of the league on the server that every
  // member can join from this page and pick in from their own phone. Joining
  // or leaving reloads, so every read comes from the right side.
  const [testBusy, setTestBusy] = useState(false);
  const [endArmed, setEndArmed] = useState(false);
  const inSandbox = sandboxActive();
  const inTestDraft = room.side === 'test';
  const testOpen = meta?.testDraft?.running === true;
  const doTestDraft = async () => {
    if (!identity || testBusy) return;
    setTestBusy(true);
    setStartError(null);
    try {
      await startTestDraft(identity);
      window.location.reload();
    } catch (e) {
      setStartError(apiErrorMessage(e));
      setTestBusy(false);
    }
  };
  const doEndTestDraft = async () => {
    if (!identity || testBusy) return;
    setTestBusy(true);
    setStartError(null);
    try {
      await endTestDraft(identity);
      window.location.reload();
    } catch (e) {
      setStartError(apiErrorMessage(e));
      setTestBusy(false);
    }
  };
  const doJoinTestDraft = () => {
    joinTestDraft();
    window.location.reload();
  };
  const doLeaveTestDraft = () => {
    leaveTestDraft();
    window.location.reload();
  };
  // Who has the draft open. Each open page checks in every few seconds; a
  // short note says who just came in or went out.
  const roomQuery = useQuery({
    queryKey: ['draft-room', identity?.owner ?? 'anon', inTestDraft ? 'test' : 'league'],
    queryFn: () => checkInDraftRoom(identity!, room),
    enabled: identity !== null && !inSandbox && meta !== null,
    refetchInterval: PRESENCE_POLL_MS,
  });
  const roomOwners = roomQuery.data?.owners;
  const [presence, setPresence] = useState<{ last: readonly string[] | undefined; notes: string[] }>({ last: undefined, notes: [] });
  if (roomOwners !== presence.last) {
    const { joined, left } = roomChanges(presence.last ?? null, roomOwners ?? []);
    const at = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fresh = [...joined.map((owner) => `${owner} joined ${at}`), ...left.map((owner) => `${owner} left ${at}`)];
    setPresence({ last: roomOwners, notes: [...fresh, ...presence.notes].slice(0, 3) });
  }

  const doExitTest = () => {
    exitSandbox();
    window.location.reload();
  };

  const board = useMemo(() => buildDraftBoard(dataset, boardState), [boardState, dataset]);
  const pool = useMemo(() => availablePlayers(dataset, boardState), [boardState, dataset]);
  // Every live pick, newest first. Keepers are not picks.
  const allPicks = useMemo(() => recentPicks(board, Number.POSITIVE_INFINITY), [board]);
  const [showAllPicks, setShowAllPicks] = useState(false);
  const recent = showAllPicks ? allPicks : allPicks.slice(0, RECENT_LIMIT);
  // The newest live pick, for UNDO.
  const lastLive = useMemo(
    () => (allPicks[0] ? board.find((cell) => cell.pick.overall === allPicks[0].overall) ?? null : null),
    [board, allPicks],
  );

  const onClockIdx = board.findIndex((c) => c.onClock);
  const onClock = onClockIdx >= 0 ? board[onClockIdx] : null;
  const nextUp = onClock
    ? board.slice(onClockIdx + 1).filter((c) => !c.selection && !c.keeper).slice(0, 3)
    : [];

  // The pick on the clock is yours to enter when it is your team's, or you are the commish.
  const canEnterOnClock =
    started && poolReady && onClock !== null && identity !== null
    && (identity.isCommissioner || identity.owner === onClock.pick.currentOwner);

  // Only the commissioner's screen carries numbers. Members pick from names,
  // positions and teams; nothing is fetched or simulated for them. The gone
  // odds run while he can enter the pick on the clock.
  const { numbers, projections, gone } = useDraftNumbers({
    enabled: started && identity?.isCommissioner === true,
    odds: canEnterOnClock,
    dataset,
    state: boardState,
    onClock,
    person: identity?.owner ?? null,
  });

  const rounds = useMemo(
    () => Array.from({ length: dataset.draftRounds }, (_, i) => i + 1),
    [dataset.draftRounds],
  );

  // An open cell takes a pick when it is on the clock, or was yielded (rule 2.3.2.2).
  const onCellTap = (cell: BoardCell) => {
    if (!started) return;
    if (cell.keeper) return;
    if (cell.selection) {
      if (identity?.isCommissioner) setClearTarget(cell);
      return;
    }
    if (!poolReady) return;
    if (!identity) {
      setShowSignIn(true);
      return;
    }
    if (!(cell.onClock || cell.skipped) || (!identity.isCommissioner && identity.owner !== cell.pick.currentOwner)) return;
    setPickTarget(cell);
  };

  const isTappable = (cell: BoardCell): boolean => {
    if (!started) return false;
    if (cell.keeper) return false;
    if (cell.selection) return identity?.isCommissioner === true;
    if (!poolReady) return false;
    if (!(cell.onClock || cell.skipped)) return false;
    return !identity || identity.isCommissioner || identity.owner === cell.pick.currentOwner;
  };

  // When the called clock hits zero, whoever sees it first tells the server.
  // The server checks its own clock, so a second report changes nothing.
  const clock = boardState.draft.clock;
  const reportedCall = useRef<string | null>(null);
  useEffect(() => {
    if (!identity || !clock?.call || !onClock || inSandbox === undefined) return;
    const callAt = clock.call.at;
    const report = () => {
      if (reportedCall.current === callAt) return;
      reportedCall.current = callAt;
      expireDraftClock(identity, onClock.pick.overall, room).then(applyState).catch(() => {
        reportedCall.current = null;
      });
    };
    if (clockExpired(clock, Date.now())) {
      report();
      return;
    }
    const tick = window.setInterval(() => {
      if (clockExpired(clock, Date.now())) report();
    }, 500);
    return () => window.clearInterval(tick);
  }, [identity, clock, onClock, applyState, inSandbox, room]);
  const skippedCells = board.filter((cell) => cell.skipped);

  // A chime when your pick comes up, beeps at two minutes, an alarm on CLOCK.
  const { soundOn, setSoundOn } = useDraftSounds({
    enabled: started && identity !== null,
    clock,
    onClockOverall: onClock?.pick.overall ?? null,
    mine: onClock !== null && onClock.pick.currentOwner === identity?.owner,
  });

  // While the draft runs on a phone the page works like the mock room: the
  // app's bar steps aside and the room's own bar picks Players, Board or Picks.
  const navigate = useNavigate();
  const roomMode = started && identity !== null;
  const [liveTab, setLiveTab] = useState<'players' | 'board' | 'picks'>('players');
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('in-live-room', roomMode);
    return () => document.documentElement.classList.remove('in-live-room');
  }, [roomMode]);
  const tabClass = (tab: typeof liveTab) => `live-tab${liveTab === tab ? ' is-shown' : ''}`;

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
        {roomMode && (
          <button
            className={`tap-btn live-sound-btn${soundOn ? ' is-on' : ''}`}
            type="button"
            aria-pressed={soundOn}
            onClick={() => setSoundOn(!soundOn)}
            title="Sound when you are up, at two minutes on your pick, and whenever CLOCK is called"
          >
            {soundOn ? 'SOUND ON' : 'SOUND OFF'}
          </button>
        )}
        {inSandbox && identity?.isCommissioner && (
          <button
            className="tap-btn"
            type="button"
            onClick={doExitTest}
            title="Exit the test draft and discard it"
            style={{
              padding: '6px 10px',
              border: '2px solid var(--neon-red)',
              borderRadius: 999,
              background: 'transparent',
              color: 'var(--neon-red)',
              fontSize: '0.68rem',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            EXIT TEST
          </button>
        )}
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
          <NavIcon name="tv" size={15} className="icon-in-heading" />
          TV
        </Link>
      </div>

      {identity && !inSandbox && roomOwners && (
        <div className="panel draft-room-panel" aria-live="polite">
          <div className="draft-room-line">
            <span className="hub-heading">IN THE DRAFT · {roomOwners.length}</span>
            {roomOwners.map((owner) => (
              <span key={owner} className={`draft-room-chip${owner === identity.owner ? ' is-me' : ''}`}>{owner}</span>
            ))}
          </div>
          {presence.notes.length > 0 && (
            <div className="draft-room-notes">
              {presence.notes.map((note) => <span key={note}>{note}</span>)}
            </div>
          )}
        </div>
      )}
      {inTestDraft && (
        <div className="panel test-draft-panel">
          <div className="hub-heading">
            <NavIcon name="flask" size={14} className="icon-in-heading" />
            TEST DRAFT
          </div>
          <p>Everyone who joins picks in the same copy of the draft. Nothing here counts, and the real league stays as it was.</p>
          <div className="test-draft-actions">
            {identity?.isCommissioner && (
              <button className="tap-btn" type="button" disabled={testBusy} onClick={doTestDraft}>
                START OVER
              </button>
            )}
            {identity?.isCommissioner && (
              <button
                className="tap-btn is-danger"
                type="button"
                disabled={testBusy}
                onClick={endArmed ? doEndTestDraft : () => setEndArmed(true)}
              >
                {endArmed ? 'END IT FOR EVERYONE?' : 'END TEST'}
              </button>
            )}
            <button className="tap-btn" type="button" onClick={doLeaveTestDraft}>
              LEAVE TEST
            </button>
          </div>
          {startError && <div className="test-draft-error">{startError}</div>}
        </div>
      )}
      {!inTestDraft && !inSandbox && testOpen && identity && !started && (
        <div className="panel test-draft-panel">
          <div className="hub-heading">
            <NavIcon name="flask" size={14} className="icon-in-heading" />
            TEST DRAFT OPEN
          </div>
          <p>The commish opened a practice draft. Join to make picks from your own phone. Nothing counts.</p>
          <div className="test-draft-actions">
            <button className="tap-btn is-go" type="button" onClick={doJoinTestDraft}>
              JOIN THE TEST
            </button>
          </div>
        </div>
      )}

      {/* ON THE CLOCK hero */}
      {scenarioActive && (
        <div
          className="panel"
          style={{
            border: '2px dashed var(--neon-purple)',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 12,
            color: 'var(--neon-purple)',
          }}
        >
          <div className="hub-heading" style={{ fontSize: '0.68rem' }}>PRIVATE MOCK BOARD</div>
          <div style={{ color: 'var(--text-body)', fontSize: '0.75rem', marginTop: 4 }}>
            Your projected keepers are applied below. Dashed, dimmed cells are projections, not league picks.
          </div>
          <button
            className="tap-btn"
            type="button"
            disabled={scenarioBusy}
            onClick={clearScenario}
            style={{ minHeight: 40, marginTop: 9, padding: '0 12px', border: '1px solid var(--neon-purple)', borderRadius: 8, background: 'transparent', color: 'var(--neon-purple)', fontWeight: 800, fontSize: '0.68rem' }}
          >
            {scenarioBusy ? 'CLEARING…' : 'CLEAR MY WHOLE SCENARIO'}
          </button>
          {scenarioError && (
            <div style={{ color: 'var(--neon-red)', fontSize: '0.72rem', marginTop: 7 }}>
              {scenarioError}
            </div>
          )}
        </div>
      )}
      <div
        className={`panel ${onClock ? 'pulse-glow' : ''}`}
        style={{
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 12,
          border: onClock ? '2px solid var(--neon-teal)' : undefined,
        }}
      >
        {!started ? (
          <div style={{ textAlign: 'center' }}>
            <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-purple)' }}>
              DRAFT DAY
            </div>
            {meta && (
              <div style={{ color: 'var(--text-soft)', margin: '8px 0', fontSize: '0.9rem' }}>
                <NavIcon name="calendar" size={16} className="icon-in-heading" />
                <strong>{formatDraftAt(meta.draftAt)}</strong>
              </div>
            )}
            <div style={{ margin: '12px 0 4px' }}>
              <DraftCountdown targetIso={meta?.draftAt} size="1.9rem" />
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
              The board unlocks when the commish starts the draft.
            </div>
            {identity?.isCommissioner && (
              <div style={{ marginTop: 12 }}>
                {!startArmed ? (
                  <button
                    className="tap-btn"
                    onClick={() => setStartArmed(true)}
                    style={{
                      minHeight: 48,
                      padding: '0 26px',
                      borderRadius: 10,
                      border: 'none',
                      background: 'var(--neon-teal)',
                      color: '#001a14',
                      fontWeight: 800,
                      letterSpacing: '0.05em',
                    }}
                  >
                    ▶ START DRAFT
                  </button>
                ) : (
                  <button
                    className="tap-btn"
                    onClick={doStartDraft}
                    style={{
                      minHeight: 48,
                      padding: '0 26px',
                      borderRadius: 10,
                      border: '2px solid var(--neon-yellow)',
                      background: 'rgba(255,230,0,0.1)',
                      color: 'var(--neon-yellow)',
                      fontWeight: 800,
                    }}
                  >
                    FOR REAL? TAP TO GO LIVE
                  </button>
                )}
                {!inSandbox && !inTestDraft && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="tap-btn"
                      type="button"
                      disabled={testBusy}
                      onClick={doTestDraft}
                      style={{
                        minHeight: 44,
                        padding: '0 18px',
                        borderRadius: 10,
                        border: '2px solid var(--neon-yellow)',
                        background: 'rgba(255,230,0,0.08)',
                        color: 'var(--neon-yellow)',
                        fontWeight: 800,
                        letterSpacing: '0.05em',
                      }}
                    >
                      <NavIcon name="flask" size={15} className="icon-in-heading" />
                      {testBusy ? 'SETTING UP…' : testOpen ? 'START THE TEST OVER' : 'RUN A TEST DRAFT'}
                    </button>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: 6 }}>
                      A practice copy everyone can join from this page. Nothing counts.
                    </div>
                  </div>
                )}
                {startError && (
                  <div style={{ color: 'var(--neon-red)', fontSize: '0.78rem', marginTop: 8 }}>{startError}</div>
                )}
              </div>
            )}
          </div>
        ) : onClock ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="hub-heading blink" style={{ fontSize: '0.62rem', color: 'var(--neon-yellow)' }}>
                  ON THE CLOCK
                </div>
                <div
                  className="hub-heading glow-teal"
                  style={{ fontSize: 'clamp(1rem, 6vw, 1.6rem)', color: 'var(--neon-teal)', margin: '8px 0 2px' }}
                >
                  {onClock.pick.currentOwner.toUpperCase()}
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: 4 }}>
                  {teamName(onClock.pick.currentOwner)}
                  {(boardState.draft.autoOwners ?? []).includes(onClock.pick.currentOwner) && (
                    <span className="auto-tag" style={{ marginLeft: 8 }}>ON AUTO</span>
                  )}
                </div>
                <div style={{ color: 'var(--text-soft)' }}>
                  Pick {pickLabel(onClock.pick)} · #{onClock.pick.overall} overall
                  {onClock.pick.viaTradeFrom && (
                    <span style={{ color: 'var(--neon-yellow)' }}> · via {onClock.pick.viaTradeFrom}</span>
                  )}
                </div>
              </div>
              <ClockReadout clock={boardState.draft.clock} corner />
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                marginTop: 12,
              }}
            >
              {identity?.isCommissioner && (
                <button
                  className="tap-btn"
                  type="button"
                  disabled={!lastLive}
                  onClick={() => lastLive && setClearTarget(lastLive)}
                  title={allPicks[0] ? `Clear ${allPicks[0].playerName} off ${allPicks[0].label}` : 'No pick to undo yet'}
                  style={{
                    ...ACTION_BUTTON,
                    border: '2px solid var(--panel-border)',
                    background: 'transparent',
                    color: lastLive ? 'var(--text-soft)' : 'var(--text-dim)',
                  }}
                >
                  ↶ UNDO LAST PICK
                </button>
              )}
              <ClockControls room={room} clock={boardState.draft.clock} picks={boardState.draft.picks} onClock={onClock} />
            </div>
            {skippedCells.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--neon-red)', fontWeight: 700 }}>SKIPPED:</span>
                {skippedCells.map((c) => (
                  <button
                    key={c.pick.overall}
                    className="tap-btn"
                    type="button"
                    disabled={!isTappable(c)}
                    onClick={() => onCellTap(c)}
                    title="Rule 2.3.2.2: the skipped team may pick any time"
                    style={{
                      border: '1px dashed var(--neon-red)',
                      background: 'rgba(255,34,34,0.08)',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: 'var(--text-soft)',
                    }}
                  >
                    {c.pick.currentOwner} · {pickLabel(c.pick)}{isTappable(c) ? ' · ENTER' : ''}
                  </button>
                ))}
              </div>
            )}
            {nextUp.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 700 }}>NEXT:</span>
                {nextUp.map((c) => (
                  <span
                    key={c.pick.overall}
                    style={{
                      border: '1px solid var(--panel-border)',
                      background: 'var(--chip-bg)',
                      borderRadius: 999,
                      padding: '3px 10px',
                      fontSize: '0.75rem',
                      color: 'var(--text-soft)',
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
            DRAFT COMPLETE
            <NavIcon name="trophy" size={17} className="icon-after-heading" />
          </div>
        )}
      </div>

      {started && identity?.isCommissioner && (
        <div className={tabClass('players')}>
          <AutoPanel
            room={room}
            owners={dataset.teams.map((team) => team.owner)}
            autoOwners={boardState.draft.autoOwners ?? []}
            onClockOwner={onClock?.pick.currentOwner ?? null}
          />
        </div>
      )}

      {started && poolReady && onClock && identity && (
        <div className={tabClass('players')}>
          <LiveRoom
            room={room}
            board={board}
            everyone={dataset.players}
            available={pool}
            onClock={onClock}
            person={identity.owner}
            canDraft={canEnterOnClock}
            showStats={identity.isCommissioner}
            projections={projections}
            gone={gone}
            queueKey={`fbb-live-queue-${identity.owner}-${inTestDraft ? 'test' : 'league'}`}
            onWriteIn={() => {
              setPickWriteIn(true);
              setPickTarget(onClock);
            }}
          />
        </div>
      )}

      {started && !onClock && (
        <div className={tabClass('picks')}>
          <DraftTimingPanel board={board} owners={dataset.teams.map((team) => team.owner)} />
        </div>
      )}

      {meta && !meta.revealed && started && (
        <div
          className="panel"
          style={{
            borderColor: 'var(--neon-purple)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 12,
            color: 'var(--neon-purple)',
            fontSize: '0.82rem',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          Keeper names are still hidden. The commish must reveal them before starting the draft.
        </div>
      )}

      {started && !poolReady && (
        <div
          role="alert"
          className="panel"
          style={{
            borderColor: playerPoolQuery.isError ? 'var(--neon-red)' : 'var(--neon-yellow)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 12,
            color: playerPoolQuery.isError ? 'var(--neon-red)' : 'var(--neon-yellow)',
            fontSize: '0.8rem',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {playerPoolQuery.isError
            ? `Player pool failed to load: ${apiErrorMessage(playerPoolQuery.error)}`
            : 'Loading the locked player pool…'}
        </div>
      )}

      {/* picks made, newest first, like the mock room's pick list */}
      {roomMode && allPicks.length === 0 && (
        <div className={`panel live-empty ${tabClass('picks')}`}>No picks yet.</div>
      )}
      {allPicks.length > 0 && (
        <div className={`panel ${tabClass('picks')}`} style={{ borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--text-mid)' }}>
              PICKS · {allPicks.length} MADE
            </div>
            {allPicks.length > RECENT_LIMIT && (
              <button
                className="tap-btn"
                type="button"
                onClick={() => setShowAllPicks((value) => !value)}
                style={{
                  padding: '4px 10px',
                  border: '1px solid var(--panel-border)',
                  borderRadius: 999,
                  background: 'transparent',
                  color: 'var(--text-mid)',
                  fontSize: '0.62rem',
                  fontWeight: 800,
                }}
              >
                {showAllPicks ? `LAST ${RECENT_LIMIT}` : 'SHOW ALL'}
              </button>
            )}
          </div>
          <ol className="room-team-list room-results-list">
            {recent.map((rp) => (
              <li key={rp.overall} className={rp.owner === identity?.owner ? 'is-mine' : undefined}>
                <span className="room-upcoming-num">{rp.label}</span>
                <span className="room-player-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rp.playerName}
                </span>
                <small>
                  <span style={{ color: positionColor(rp.positions), fontWeight: 800 }}>{rp.positions.join('/')}</span>
                </small>
                <span />
                <span className="room-update-owner">{rp.owner}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* view toggle */}
      <div className={tabClass('board')}>
      <div
        aria-label="Position color key"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          margin: '0 2px 10px',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        <span className="hub-heading" style={{ color: 'var(--text-dim)', fontSize: '0.55rem', marginRight: 2 }}>
          POSITION
        </span>
        {POSITION_ORDER.map((position) => {
          const theme = positionTheme([position]);
          return (
            <span
              key={position}
              style={{
                minWidth: 38,
                padding: '4px 8px',
                border: `1px solid ${theme.border}`,
                borderRadius: 999,
                background: theme.deepBackground,
                color: theme.color,
                fontSize: '0.65rem',
                fontWeight: 800,
                textAlign: 'center',
              }}
            >
              {position}
            </span>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['grid', 'list'] as const).map((v) => (
          <button
            key={v}
            className="tap-btn hub-heading"
            onClick={() => setView(v)}
            style={{
              flex: 1,
              padding: '9px 0',
              fontSize: '0.62rem',
              background: view === v ? 'rgba(0,255,204,0.1)' : 'var(--panel-bg)',
              color: view === v ? 'var(--neon-teal)' : 'var(--text-mid)',
              border: `2px solid ${view === v ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {v === 'grid' ? 'BOARD' : 'LIST'}
          </button>
        ))}
      </div>

      {view === 'list' ? (
        rounds.map((r) => (
          <section key={r}>
            <div
              className="hub-heading draft-round-head"
              style={{
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
                    projected={!!cell.keeper && projectedKeys.has(cell.keeper.selection.playerKey)}
                    tappable={isTappable(cell)}
                    onTap={onCellTap}
                  />
                ))}
            </div>
          </section>
        ))
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8 }}>
          <BoardGrid
            board={board}
            projectedKeeperKeys={projectedKeys}
            tappable={isTappable}
            onCellTap={onCellTap}
          />
        </div>
      )}
      </div>

      {roomMode && (
        <nav className="live-phone-tabs" aria-label="Draft room">
          {([['players', 'people', 'PLAYERS'], ['board', 'tiers', 'BOARD'], ['picks', 'ballot', 'PICKS']] as const).map(([tab, icon, label]) => (
            <button key={tab} type="button" className={liveTab === tab ? 'is-on' : ''} aria-pressed={liveTab === tab} onClick={() => setLiveTab(tab)}>
              <span aria-hidden="true"><NavIcon name={icon} /></span>
              <span className="hub-heading">{label}</span>
            </button>
          ))}
          <button type="button" className="is-exit" onClick={() => navigate(identity ? `/keepers/${identity.owner}` : '/')}>
            <span aria-hidden="true"><NavIcon name="close" /></span>
            <span className="hub-heading">EXIT</span>
          </button>
        </nav>
      )}

      {showSignIn && <TeamPickerModal onClose={() => setShowSignIn(false)} />}
      {pickTarget && (
        <PickSheet
          room={room}
          cell={pickTarget}
          pool={pool}
          numbers={numbers}
          startInWriteIn={pickWriteIn}
          onClose={() => {
            setPickTarget(null);
            setPickWriteIn(false);
          }}
        />
      )}
      {clearTarget && <ClearPickSheet room={room} cell={clearTarget} onClose={() => setClearTarget(null)} />}
    </div>
  );
}

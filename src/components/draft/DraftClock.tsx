import { useEffect, useState } from 'react';
import type { BoardCell, DraftClockState, DraftPickState } from '../../lib/keeper/types.js';
import {
  CALLED_CLOCK_SECONDS,
  canCallClock,
  draftTimingStats,
  elapsedMs,
  formatClock,
  isPaused,
  remainingMs,
  SOFT_CLOCK_SECONDS,
} from '../../lib/league/draftClock.js';
import { apiErrorMessage, callDraftClock, pauseDraftClock, resumeDraftClock } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity } from '../../hooks/useLeague.js';

/** A ticking clock. Only the component that calls this re-renders. */
function useNow(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs]);
  return now;
}

/**
 * The pick timer, or the CLOCK countdown once somebody called it. Shown on
 * the board and the TV. `tv` scales to the wall.
 */
export function ClockReadout({
  clock,
  tv = false,
  corner = false,
}: {
  clock: DraftClockState | null | undefined;
  tv?: boolean;
  /** Sits in the top right of the panel, beside the name, instead of under it. */
  corner?: boolean;
}) {
  const now = useNow(!!clock?.pickStartedAt);
  if (!clock?.pickStartedAt) return null;
  const box = corner
    ? ({ marginTop: 0, textAlign: 'right', flexShrink: 0 } as const)
    : ({ marginTop: tv ? 2 : 10, textAlign: 'center' } as const);
  const paused = isPaused(clock);
  const left = remainingMs(clock, now);
  const elapsed = elapsedMs(clock, now);
  const slow = elapsed >= SOFT_CLOCK_SECONDS * 1000;
  const big = tv ? 'clamp(1.4rem, 5vh, 3.4rem)' : '2rem';
  const small = tv ? 'clamp(0.55rem, 1.5vh, 0.9rem)' : '0.62rem';

  if (left !== null) {
    const out = left <= 0;
    return (
      <div style={box}>
        <div className={`hub-heading${out ? ' blink' : ''}`} style={{ fontSize: small, color: 'var(--neon-red)' }}>
          {paused ? 'CLOCK PAUSED' : out ? 'TIME' : 'CLOCK'} · CALLED BY {clock.call?.by.toUpperCase()}
        </div>
        <div
          className={out ? 'blink' : undefined}
          style={{
            fontSize: big,
            fontWeight: 900,
            fontVariantNumeric: 'tabular-nums',
            color: out ? 'var(--neon-red)' : 'var(--text-max)',
            lineHeight: 1.1,
          }}
          aria-label={out ? 'Time is up' : `${Math.ceil(left / 1000)} seconds left`}
        >
          {out ? 'TIME' : formatClock(left)}
        </div>
        {!out && !tv && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>
            {CALLED_CLOCK_SECONDS} seconds to pick, rule 2.3.2
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={box}>
      <div className="hub-heading" style={{ fontSize: small, color: paused ? 'var(--neon-yellow)' : 'var(--text-dim)' }}>
        {paused ? 'PAUSED' : 'ON THE PICK'}
      </div>
      <div
        style={{
          fontSize: big,
          fontWeight: 900,
          fontVariantNumeric: 'tabular-nums',
          color: paused ? 'var(--neon-yellow)' : slow ? 'var(--neon-yellow)' : 'var(--text-soft)',
          lineHeight: 1.1,
        }}
      >
        {formatClock(elapsed)}
      </div>
      {slow && !paused && !tv && (
        <div style={{ fontSize: '0.68rem', color: 'var(--neon-yellow)' }}>
          Past {SOFT_CLOCK_SECONDS} seconds. Anyone can call CLOCK.
        </div>
      )}
    </div>
  );
}

/**
 * CALL CLOCK for any signed-in member, once every five picks and never on
 * their own pick. PAUSE and RESUME for the commissioner.
 */
export function ClockControls({
  clock,
  picks,
  onClock,
}: {
  clock: DraftClockState | null | undefined;
  picks: Readonly<Record<string, DraftPickState>>;
  onClock: BoardCell | null;
}) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!identity || !clock?.pickStartedAt) return null;

  const check = canCallClock({ clock, picks, onClock, caller: identity.owner, isCommissioner: identity.isCommissioner });
  const paused = isPaused(clock);

  const run = async (action: () => Promise<Parameters<typeof applyState>[0]>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      applyState(await action());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const callLabel = check.ok
    ? 'CALL CLOCK'
    : check.reason === 'cooldown'
      ? `CLOCK IN ${check.picksToWait} PICK${check.picksToWait === 1 ? '' : 'S'}`
      : null;

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
      {callLabel && (
        <button
          className="tap-btn"
          type="button"
          disabled={!check.ok || busy}
          onClick={() => run(() => callDraftClock(identity))}
          title={check.ok ? 'Rule 2.3.1: the team picking gets 30 seconds' : 'Once every five picks'}
          style={{
            flex: 1,
            minWidth: 150,
            minHeight: 44,
            padding: '0 16px',
            borderRadius: 10,
            border: `2px solid ${check.ok ? 'var(--neon-red)' : 'var(--panel-border)'}`,
            background: check.ok ? 'rgba(255,34,34,0.12)' : 'transparent',
            color: check.ok ? 'var(--neon-red)' : 'var(--text-dim)',
            fontWeight: 800,
            letterSpacing: '0.05em',
          }}
        >
          ⏱ {callLabel}
        </button>
      )}
      {identity.isCommissioner && (
        <button
          className="tap-btn"
          type="button"
          disabled={busy}
          onClick={() => run(() => (paused ? resumeDraftClock(identity) : pauseDraftClock(identity)))}
          style={{
            flex: 1,
            minWidth: 120,
            minHeight: 44,
            padding: '0 16px',
            borderRadius: 10,
            border: '2px solid var(--neon-yellow)',
            background: paused ? 'rgba(255,230,0,0.14)' : 'transparent',
            color: 'var(--neon-yellow)',
            fontWeight: 800,
            letterSpacing: '0.05em',
          }}
        >
          {paused ? '▶ RESUME CLOCK' : '⏸ PAUSE CLOCK'}
        </button>
      )}
      {error && (
        <div role="alert" style={{ width: '100%', color: 'var(--neon-red)', fontSize: '0.78rem', textAlign: 'center' }}>
          {error}
        </div>
      )}
    </div>
  );
}

const seconds = (value: number | null | undefined) => (value === null || value === undefined ? '–' : formatClock(value * 1000));

/** The fun numbers once the draft is done: quick, slow, clocked, callers. */
export function DraftTimingPanel({ board, owners, tv = false }: { board: readonly BoardCell[]; owners: readonly string[]; tv?: boolean }) {
  const stats = draftTimingStats(board, owners);
  if (stats.timedPicks === 0) return null;
  const headline = [
    stats.fastest && { label: 'QUICKEST DRAW', who: stats.fastest.owner, detail: `${seconds(stats.fastest.averageSeconds)} a pick` },
    stats.slowest && { label: 'SLOWEST HAND', who: stats.slowest.owner, detail: `${seconds(stats.slowest.averageSeconds)} a pick` },
    stats.longestPick && {
      label: 'LONGEST PICK',
      who: stats.longestPick.owner,
      detail: `${seconds(stats.longestPick.seconds)} on ${stats.longestPick.playerName}`,
    },
    stats.mostClocked && { label: 'MOST CLOCKED', who: stats.mostClocked.owner, detail: `${stats.mostClocked.clocked}× CLOCK called on them` },
    stats.mostCalls && { label: 'CLOCK HAPPY', who: stats.mostCalls.owner, detail: `called CLOCK ${stats.mostCalls.calls}×` },
  ].filter((row): row is { label: string; who: string; detail: string } => row !== null && row !== undefined);
  const rows = [...stats.owners].sort((a, b) => (a.averageSeconds ?? Infinity) - (b.averageSeconds ?? Infinity));
  const size = tv ? 'clamp(0.7rem, 1.6vh, 1rem)' : '0.8rem';

  return (
    <div className="panel" style={{ borderRadius: 10, padding: tv ? '8px 14px' : '12px 14px', marginBottom: tv ? 0 : 12 }}>
      <div className="hub-heading glow-yellow" style={{ fontSize: tv ? 'clamp(0.6rem, 1.5vh, 0.9rem)' : '0.68rem', color: 'var(--neon-yellow)', marginBottom: 8 }}>
        DRAFT STATS
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${tv ? 150 : 140}px, 1fr))`, gap: 8, marginBottom: 10 }}>
        {headline.map((row) => (
          <div key={row.label} style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: '6px 10px', background: 'var(--chip-bg)' }}>
            <div className="hub-heading" style={{ fontSize: tv ? 'clamp(0.5rem, 1.2vh, 0.7rem)' : '0.55rem', color: 'var(--text-dim)' }}>{row.label}</div>
            <div style={{ fontSize: tv ? 'clamp(0.9rem, 2.2vh, 1.4rem)' : '1.05rem', fontWeight: 900, color: 'var(--text-max)' }}>{row.who}</div>
            <div style={{ fontSize: size, color: 'var(--text-soft)' }}>{row.detail}</div>
          </div>
        ))}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: size }}>
        <thead>
          <tr style={{ color: 'var(--text-dim)', fontSize: tv ? 'clamp(0.5rem, 1.2vh, 0.7rem)' : '0.6rem', letterSpacing: '0.05em' }}>
            <th style={{ textAlign: 'left', padding: '3px 4px' }}>TEAM</th>
            <th className="room-num" style={{ padding: '3px 4px' }}>AVG</th>
            <th className="room-num" style={{ padding: '3px 4px' }}>LONGEST</th>
            <th className="room-num" style={{ padding: '3px 4px' }}>CLOCKED</th>
            <th className="room-num" style={{ padding: '3px 4px' }}>CALLS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.owner} style={{ background: index % 2 ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
              <td style={{ padding: '3px 4px', fontWeight: 700, color: 'var(--text-hi)' }}>{row.owner}</td>
              <td className="room-num" style={{ padding: '3px 4px' }}>{seconds(row.averageSeconds)}</td>
              <td className="room-num" style={{ padding: '3px 4px' }}>{row.longest ? seconds(row.longest.seconds) : '–'}</td>
              <td className="room-num" style={{ padding: '3px 4px' }}>{row.clocked}</td>
              <td className="room-num" style={{ padding: '3px 4px' }}>{row.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

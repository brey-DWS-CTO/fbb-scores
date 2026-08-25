import { useMemo } from 'react';
import { buildDraftBoard, pickLabel } from '../../lib/keeper/engine.js';

import { useLeagueData } from '../../hooks/useLeague.js';
import { formatDraftAt } from '../keepers/KeepersPage.js';
import BoardGrid from './BoardGrid.js';
import { recentPicks } from './boardUtils.js';

/** Full-screen wall board for the draft-night TV. Read-only, 3s poll. */
export default function DraftTvPage() {
  const { state, meta, dataUpdatedAt, dataset } = useLeagueData(true);
  const board = useMemo(() => buildDraftBoard(dataset, state), [state, dataset]);
  const started = state.draft.startedAt !== null;
  const onClock = board.find((c) => c.onClock) ?? null;
  const last = useMemo(() => recentPicks(board, 1)[0] ?? null, [board]);

  const updated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

  return (
    <div
      style={{
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dark-bg)',
      }}
    >
      {/* top bar */}
      <div
        style={{
          minHeight: '12vh',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '6px 18px',
          borderBottom: '2px solid var(--panel-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <img src="/logo.png" alt="The Nerds" style={{ height: '10vh', width: 'auto' }} />
          <div
            className="hub-heading glow-teal"
            style={{
              color: 'var(--neon-teal)',
              fontSize: 'clamp(0.6rem, 1.6vh, 1rem)',
              lineHeight: 1.5,
              whiteSpace: 'nowrap',
            }}
          >
            2027
            <br />
            DRAFT
          </div>
        </div>

        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          {!started ? (
            <>
              <div
                className="hub-heading"
                style={{
                  color: 'var(--neon-purple)',
                  fontSize: 'clamp(0.55rem, 1.5vh, 0.9rem)',
                  lineHeight: 1.3,
                }}
              >
                DRAFT DAY
              </div>
              <div
                className="hub-heading glow-teal"
                style={{
                  color: 'var(--text-max)',
                  fontSize: 'clamp(1rem, 3.4vh, 2.4rem)',
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {meta ? formatDraftAt(meta.draftAt).toUpperCase() : 'OCT 18 · 2:00 PM'}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 'clamp(0.65rem, 1.5vh, 0.9rem)' }}>
                Board goes live when the commissioner starts the draft
              </div>
            </>
          ) : onClock ? (
            <>
              <div
                className="hub-heading blink"
                style={{
                  color: 'var(--neon-yellow)',
                  fontSize: 'clamp(0.55rem, 1.5vh, 0.9rem)',
                  lineHeight: 1.3,
                }}
              >
                ON THE CLOCK
              </div>
              <div
                className="hub-heading glow-yellow"
                style={{
                  color: 'var(--text-max)',
                  fontSize: 'clamp(1.1rem, 4.2vh, 3rem)',
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {onClock.pick.currentOwner.toUpperCase()}
              </div>
              <div style={{ color: 'var(--neon-teal)', fontSize: 'clamp(0.7rem, 1.7vh, 1rem)', lineHeight: 1.3 }}>
                PICK {pickLabel(onClock.pick)} · #{onClock.pick.overall} OVERALL
                {onClock.pick.viaTradeFrom && (
                  <span style={{ color: 'var(--neon-yellow)' }}> · VIA {onClock.pick.viaTradeFrom.toUpperCase()}</span>
                )}
              </div>
            </>
          ) : (
            <div
              className="hub-heading glow-yellow"
              style={{ color: 'var(--neon-yellow)', fontSize: 'clamp(1rem, 3.5vh, 2.4rem)' }}
            >
              DRAFT COMPLETE 🏆
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {last && (
            <div style={{ color: 'var(--text-soft)', fontSize: 'clamp(0.7rem, 1.7vh, 1rem)' }}>
              LAST: <span style={{ color: 'var(--text-max)', fontWeight: 700 }}>{last.playerName}</span> ·{' '}
              {last.owner} · {last.label}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 6,
              color: 'var(--text-dim)',
              fontSize: 'clamp(0.65rem, 1.4vh, 0.85rem)',
              marginTop: 2,
            }}
          >
            <span
              className="blink"
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: 'var(--neon-red)',
                display: 'inline-block',
              }}
            />
            LIVE · {updated}
          </div>
        </div>
      </div>

      {/* board fills the rest; horizontal scroll fallback on small screens */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '8px 10px 10px',
        }}
      >
        <BoardGrid board={board} tv />
      </div>
    </div>
  );
}

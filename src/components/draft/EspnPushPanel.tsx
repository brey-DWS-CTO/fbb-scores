import { useMemo, useState } from 'react';
import type { BoardCell, TeamInfo } from '../../lib/keeper/types.js';
import { espnPushPlan, espnPushText } from '../../lib/league/espnPush.js';
import type { TeamNameOverrides } from '../../lib/league/teamNames.js';

/**
 * Commish only, once every pick is in: the draft laid out per ESPN team, the
 * way ESPN's offline draft form takes it. Copy it, or read it on screen.
 * Nothing here talks to ESPN.
 */
export default function EspnPushPanel({
  board,
  teams,
  teamNames,
}: {
  board: readonly BoardCell[];
  teams: readonly TeamInfo[];
  teamNames?: TeamNameOverrides | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const plan = useMemo(() => espnPushPlan(board, teams, teamNames), [board, teams, teamNames]);
  const text = useMemo(() => espnPushText(plan), [plan]);
  const ready = plan.problems.length === 0;

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setOpen(true);
    }
  };

  return (
    <div className="panel" style={{ borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="hub-heading glow-yellow" style={{ fontSize: '0.68rem', color: 'var(--neon-yellow)' }}>
          PUSH TO ESPN
        </div>
        <div style={{ fontSize: '0.8rem', color: ready ? 'var(--text-soft)' : 'var(--neon-purple)', flex: 1 }}>
          {ready
            ? `${plan.filled} picks over ${plan.teams.length} teams, matched on ESPN team id. Ready to enter.`
            : `${plan.filled} of ${plan.total} picks. ${plan.problems.length === 1 ? 'One thing' : `${plan.problems.length} things`} to settle first.`}
        </div>
        <button type="button" className="tap-btn" onClick={() => void copy()}>
          {copied ? 'COPIED' : 'COPY'}
        </button>
        <button type="button" className="tap-btn" onClick={() => setOpen((value) => !value)}>
          {open ? 'HIDE' : 'SHOW'}
        </button>
      </div>
      {!ready && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.8rem', color: 'var(--neon-purple)' }}>
          {plan.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {open && (
        <pre
          style={{
            margin: '10px 0 0',
            padding: '10px 12px',
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            background: 'var(--chip-bg)',
            fontSize: '0.75rem',
            lineHeight: 1.45,
            color: 'var(--text-soft)',
            whiteSpace: 'pre-wrap',
            maxHeight: 420,
            overflow: 'auto',
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

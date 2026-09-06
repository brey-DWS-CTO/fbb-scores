import type { CSSProperties } from 'react';
import type { PlayerKeeperInfo } from '../../lib/keeper/types.js';
import NavIcon from '../league/NavIcon.js';

const chipBase: CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: '0.62rem',
  fontWeight: 800,
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

/** Keeper tier round chip — "R4" (or "ROUND 4" with `long`). */
export function RoundChip({ round, long }: { round: number; long?: boolean }) {
  return (
    <span
      style={{
        ...chipBase,
        border: '1px solid var(--neon-blue)',
        color: 'var(--neon-blue)',
        background: 'rgba(0,170,255,0.1)',
      }}
    >
      {long ? `ROUND ${round}` : `R${round}`}
    </span>
  );
}

/** Which average is feeding the cap/tier math for this player. */
export function SourceBadge({ info, compact }: { info: PlayerKeeperInfo; compact?: boolean }) {
  let label: string;
  let color: string;
  let bg: string;
  if (info.zeroGp2026) {
    label = compact ? 'R3 RULE' : "R3 RULE · didn't play 2026";
    color = 'var(--neon-orange)';
    bg = 'rgba(255,102,0,0.1)';
  } else if (info.usesPriorYear) {
    label = compact ? "'25 AVG" : '2025 AVG · ≤25 GP rule';
    color = 'var(--neon-yellow)';
    bg = 'rgba(255,230,0,0.08)';
  } else {
    label = '2026 AVG';
    color = 'var(--text-mid)';
    bg = 'rgba(136,136,170,0.08)';
  }
  return <span style={{ ...chipBase, border: `1px solid ${color}`, color, background: bg }}>{label}</span>;
}

/** Horizontal salary-cap bar; teal normally, red gradient + glow when over. */
export function CapBar({ used, limit, height = 10 }: { used: number; limit: number; height?: number }) {
  const over = used > limit;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div
      style={{
        height,
        background: 'var(--input-bg)',
        border: '1px solid var(--panel-border)',
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: 999,
          background: over
            ? 'linear-gradient(90deg, var(--neon-orange), var(--neon-red))'
            : 'linear-gradient(90deg, var(--neon-teal), var(--neon-blue))',
          boxShadow: over ? '0 0 10px var(--neon-red)' : '0 0 8px rgba(0,255,204,0.4)',
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  );
}

/** Red league-wide lock banner. */
export function LockBanner() {
  return (
    <div
      className="panel"
      style={{
        borderColor: 'var(--neon-red)',
        background: 'rgba(255,34,34,0.07)',
        padding: '12px 14px',
        borderRadius: 8,
        marginBottom: 14,
        textAlign: 'center',
      }}
    >
      <span
        className="hub-heading glow-red"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: '0.6rem',
          color: 'var(--neon-red)',
        }}
      >
        <NavIcon name="lock" size={14} />
        KEEPERS ARE LOCKED
      </span>
    </div>
  );
}

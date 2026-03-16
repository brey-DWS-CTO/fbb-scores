import type { FC } from 'react';
import type { TeamEfficiency } from '../types/index.js';

interface EfficiencyBarProps {
  efficiency: TeamEfficiency;
  label?: string;
}

const EfficiencyBar: FC<EfficiencyBarProps> = ({ efficiency, label }) => {
  const { actualScore, maxPossibleScore, efficiencyPct } = efficiency;

  const barColor =
    efficiencyPct >= 90 ? 'var(--neon-teal)' :
    efficiencyPct >= 80 ? 'var(--neon-yellow)' :
    'var(--neon-red)';

  const glowClass =
    efficiencyPct >= 90 ? 'glow-teal' :
    efficiencyPct >= 80 ? 'glow-yellow' :
    '';

  const fillPct = maxPossibleScore > 0
    ? Math.min(100, (actualScore / maxPossibleScore) * 100)
    : 0;

  return (
    <div className="w-full">
      {label && (
        <span
          className="pixel-text"
          style={{ fontSize: '0.3rem', color: '#777799', letterSpacing: '0.1em' }}
        >
          {label}
        </span>
      )}
      <div className="flex items-center gap-2 mt-1">
        {/* Bar container */}
        <div
          className="flex-1 relative"
          style={{
            height: '14px',
            border: `1px solid ${barColor}`,
            background: '#0a0a1a',
            boxShadow: `0 0 4px ${barColor}33`,
          }}
        >
          {/* Filled portion */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: `${fillPct}%`,
              background: `${barColor}44`,
              borderRight: fillPct > 0 && fillPct < 100 ? `2px solid ${barColor}` : 'none',
              transition: 'width 0.3s ease',
            }}
          />
          {/* Score labels inside bar */}
          <div
            className="absolute inset-0 flex items-center justify-between px-2"
            style={{ fontFamily: "'VT323', monospace", fontSize: '0.75rem' }}
          >
            <span style={{ color: barColor, zIndex: 1 }}>{actualScore.toFixed(1)}</span>
            <span style={{ color: '#555577', zIndex: 1 }}>{maxPossibleScore.toFixed(1)}</span>
          </div>
        </div>
        {/* Percentage label */}
        <span
          className={`pixel-text ${glowClass}`}
          style={{ fontSize: '0.35rem', color: barColor, minWidth: '3rem', textAlign: 'right' }}
        >
          {efficiencyPct.toFixed(0)}%
        </span>
      </div>
      {efficiency.missedPoints > 0 && (
        <span
          style={{ fontFamily: "'VT323', monospace", fontSize: '0.7rem', color: '#555577' }}
        >
          {efficiency.missedPoints.toFixed(1)} PTS LEFT ON BENCH
        </span>
      )}
    </div>
  );
};

export default EfficiencyBar;

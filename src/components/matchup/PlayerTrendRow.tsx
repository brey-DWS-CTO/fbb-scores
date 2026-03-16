import type { FC } from 'react';
import Sparkline from '../Sparkline.js';
import { usePlayerTrend } from '../../hooks/usePlayerTrend.js';

interface PlayerTrendRowProps {
  playerId: number;
  colSpan: number;
}

/**
 * Expandable row that shows player trend sparklines.
 * Rendered below a PlayerRow when the player is selected.
 */
const PlayerTrendRow: FC<PlayerTrendRowProps> = ({ playerId, colSpan }) => {
  const { data: trend, isLoading } = usePlayerTrend(playerId);

  if (isLoading) {
    return (
      <tr style={{ background: '#08081a' }}>
        <td colSpan={colSpan} className="px-4 py-3">
          <span className="pixel-text blink" style={{ fontSize: '0.25rem', color: '#555577' }}>
            LOADING TREND DATA...
          </span>
        </td>
      </tr>
    );
  }

  if (!trend || trend.dataPoints.length < 2) {
    return (
      <tr style={{ background: '#08081a' }}>
        <td colSpan={colSpan} className="px-4 py-3">
          <span className="pixel-text" style={{ fontSize: '0.25rem', color: '#555577' }}>
            NOT ENOUGH DATA FOR TREND
          </span>
        </td>
      </tr>
    );
  }

  const fptsData = trend.dataPoints.map(d => d.fpts);
  const avg7Data = trend.dataPoints.map(d => d.rollingAvg7).filter(v => v > 0);
  const avg30Data = trend.dataPoints.map(d => d.rollingAvg30).filter(v => v > 0);

  // Calculate trend direction
  const latest = trend.dataPoints[trend.dataPoints.length - 1];
  const earliest = trend.dataPoints[0];
  const fptsDelta = latest.fpts - earliest.fpts;

  return (
    <tr style={{ background: '#08081a', borderBottom: '2px solid var(--neon-purple)', borderTop: '1px solid #1a1a33' }}>
      <td colSpan={colSpan} className="px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="pixel-text" style={{ fontSize: '0.28rem', color: 'var(--neon-purple)' }}>
              PERFORMANCE TREND
            </span>
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '0.9rem',
                color: fptsDelta >= 0 ? 'var(--neon-teal)' : 'var(--neon-red)',
              }}
            >
              {fptsDelta >= 0 ? '▲' : '▼'} {Math.abs(fptsDelta).toFixed(1)} FPTS
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex flex-col items-center">
              <Sparkline
                data={fptsData}
                width={120}
                height={32}
                color="var(--neon-teal)"
                label="FPTS"
              />
            </div>
            {avg7Data.length >= 2 && (
              <div className="flex flex-col items-center">
                <Sparkline
                  data={avg7Data}
                  width={100}
                  height={32}
                  color="var(--neon-yellow)"
                  label="7-DAY AVG"
                />
              </div>
            )}
            {avg30Data.length >= 2 && (
              <div className="flex flex-col items-center">
                <Sparkline
                  data={avg30Data}
                  width={100}
                  height={32}
                  color="var(--neon-blue)"
                  label="30-DAY AVG"
                />
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
};

export default PlayerTrendRow;

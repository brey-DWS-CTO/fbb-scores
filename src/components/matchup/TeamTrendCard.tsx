import type { FC } from 'react';
import Sparkline from '../Sparkline.js';
import { useTeamTrend } from '../../hooks/usePlayerTrend.js';

interface TeamTrendCardProps {
  teamId: number;
  teamName: string;
}

/**
 * Displays a team's scoring trend sparkline with summary stats.
 * Shows total score and avg PPG trends over recent scoring periods.
 */
const TeamTrendCard: FC<TeamTrendCardProps> = ({ teamId, teamName }) => {
  const { data: trend, isLoading } = useTeamTrend(teamId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#0a0a14', border: '1px solid #1a1a2e' }}>
        <span className="pixel-text blink" style={{ fontSize: '0.25rem', color: '#555577' }}>
          LOADING TREND...
        </span>
      </div>
    );
  }

  if (!trend || trend.dataPoints.length < 2) {
    return null; // Not enough data for a trend
  }

  const scores = trend.dataPoints.map(d => d.totalScore);
  const avgs = trend.dataPoints.map(d => d.avgPointsPerGame);
  const latest = trend.dataPoints[trend.dataPoints.length - 1];
  const prev = trend.dataPoints[trend.dataPoints.length - 2];
  const scoreDelta = latest.totalScore - prev.totalScore;

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{
        background: '#0a0a14',
        border: '1px solid #1a1a2e',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="pixel-text" style={{ fontSize: '0.25rem', color: '#555577' }}>
          {teamName} TREND
        </span>
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '0.9rem',
            color: scoreDelta >= 0 ? 'var(--neon-teal)' : 'var(--neon-red)',
          }}
        >
          {scoreDelta >= 0 ? '+' : ''}{scoreDelta.toFixed(1)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Sparkline
          data={scores}
          width={100}
          height={28}
          color="var(--neon-teal)"
          label="TOTAL"
        />
        <Sparkline
          data={avgs}
          width={80}
          height={28}
          color="var(--neon-yellow)"
          label="AVG PPG"
        />
      </div>
    </div>
  );
};

export default TeamTrendCard;

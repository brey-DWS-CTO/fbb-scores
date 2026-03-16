import { useEffect, useCallback } from 'react';
import type { FC } from 'react';
import type { MatchupPlayer } from '../../types/index.js';
import { usePlayerTrend } from '../../hooks/usePlayerTrend.js';
import Sparkline from '../Sparkline.js';

interface PlayerCardModalProps {
  player: MatchupPlayer;
  onClose: () => void;
}

const PlayerCardModal: FC<PlayerCardModalProps> = ({ player, onClose }) => {
  const { data: trend, isLoading: trendLoading } = usePlayerTrend(player.playerId);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const gp = player.stats.gp || 1;

  // Season FPTS per game — from actual season stats (split type 0), not matchup period
  const seasonFptsPerGame = player.seasonFptsPerGame;

  // Rolling averages
  const last7 = player.averages.last7;
  const last15 = player.averages.last15;
  const last30 = player.averages.last30;

  // Color code rolling averages vs season baseline
  // 'near' = within 5% of baseline → amber instead of red
  const avgVsBaseline = (avg: number) => {
    if (avg <= 0 || seasonFptsPerGame <= 0) return 'neutral';
    const pctDiff = Math.abs(avg - seasonFptsPerGame) / seasonFptsPerGame;
    if (pctDiff <= 0.05) return 'near';
    return avg > seasonFptsPerGame ? 'up' : 'down';
  };

  const trendColor = (dir: string) =>
    dir === 'up' ? 'var(--neon-teal)' : dir === 'near' ? 'var(--neon-yellow)' : dir === 'down' ? 'var(--neon-red)' : '#aaaacc';

  const trendArrow = (dir: string) =>
    dir === 'up' ? '▲' : dir === 'near' ? '≈' : dir === 'down' ? '▼' : '—';

  // Sparkline data
  const fptsData = trend?.dataPoints.map((d) => d.fpts) ?? [];
  const avg7Data = trend?.dataPoints.map((d) => d.rollingAvg7).filter((v) => v > 0) ?? [];

  // Season per-game stats
  const statBoxes: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: 'PTS', value: (player.stats.pts / gp).toFixed(1), highlight: player.stats.pts / gp >= 20 },
    { label: 'REB', value: (player.stats.reb / gp).toFixed(1), highlight: player.stats.reb / gp >= 8 },
    { label: 'AST', value: (player.stats.ast / gp).toFixed(1), highlight: player.stats.ast / gp >= 6 },
    { label: 'STL', value: (player.stats.stl / gp).toFixed(1), highlight: player.stats.stl / gp >= 1.5 },
    { label: 'BLK', value: (player.stats.blk / gp).toFixed(1), highlight: player.stats.blk / gp >= 1.5 },
    {
      label: 'FG%',
      value: player.stats.fga > 0 ? (player.stats.fgm / player.stats.fga * 100).toFixed(0) + '%' : '-',
    },
    { label: '3PM', value: (player.stats.threepm / gp).toFixed(1) },
    { label: 'TO', value: (player.stats.to / gp).toFixed(1) },
  ];

  // Position badge color
  const posColor: Record<string, string> = {
    PG: 'var(--neon-teal)',
    SG: 'var(--neon-blue)',
    SF: 'var(--neon-yellow)',
    PF: 'var(--neon-orange)',
    C: 'var(--neon-purple)',
  };

  const badgeColor = posColor[player.position] ?? 'var(--neon-teal)';

  return (
    // Backdrop
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      {/* Card */}
      <div
        style={{
          maxWidth: 400,
          width: '92vw',
          background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
          border: '2px solid var(--neon-purple)',
          borderRadius: 12,
          boxShadow: '0 0 32px #8844ff44, 0 0 64px #8844ff22',
          position: 'relative',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: "'VT323', monospace",
            fontSize: '1.5rem',
            color: '#777799',
            zIndex: 10,
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          X
        </button>

        {/* ── Header ── */}
        <div
          className="flex items-center gap-3 px-4 pt-4 pb-3"
          style={{ borderBottom: '1px solid #1a1a33' }}
        >
          {/* Headshot */}
          <div
            style={{
              width: 120,
              height: 90,
              borderRadius: 8,
              overflow: 'hidden',
              border: '2px solid var(--neon-purple)',
              boxShadow: '0 0 16px #8844ff44',
              background: '#1a1a33',
              flexShrink: 0,
            }}
          >
            {player.imageUrl ? (
              <img
                src={player.imageUrl}
                alt={player.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div
                className="flex items-center justify-center w-full h-full"
                style={{ fontFamily: "'VT323', monospace", fontSize: '2rem', color: '#333355' }}
              >
                ?
              </div>
            )}
          </div>

          {/* Name / position / team */}
          <div className="flex flex-col gap-1 min-w-0">
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1.6rem',
                color: '#e0e0ff',
                lineHeight: 1.1,
              }}
            >
              {player.name}
            </span>
            <div className="flex items-center gap-2">
              <span
                style={{
                  fontFamily: "'VT323', monospace",
                  fontSize: '0.95rem',
                  color: '#0a0a14',
                  background: badgeColor,
                  padding: '1px 8px',
                  borderRadius: 4,
                  lineHeight: 1.3,
                }}
              >
                {player.position}
              </span>
              <span
                className="pixel-text"
                style={{ fontSize: '0.32rem', color: '#777799' }}
              >
                {player.nbaTeamAbbrev}
              </span>
            </div>
          </div>
        </div>

        {/* ── Season FPTS/G headline ── */}
        {seasonFptsPerGame > 0 && (
          <div
            className="flex items-center justify-center gap-3 px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, #00ffcc08, #0a0a14)',
              borderBottom: '1px solid #1a1a33',
            }}
          >
            <span
              className="pixel-text"
              style={{ fontSize: '0.3rem', color: '#777799', letterSpacing: '0.1em' }}
            >
              SEASON AVG
            </span>
            <span
              className="glow-teal"
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '2rem',
                color: 'var(--neon-teal)',
                letterSpacing: '0.08em',
              }}
            >
              {seasonFptsPerGame.toFixed(1)}
            </span>
            <span
              className="pixel-text"
              style={{ fontSize: '0.3rem', color: '#777799', letterSpacing: '0.1em' }}
            >
              FPTS/G
            </span>
          </div>
        )}

        {/* ── Season Stats ── */}
        <div className="px-4 pt-3 pb-2">
          <span
            className="pixel-text"
            style={{ fontSize: '0.3rem', color: 'var(--neon-purple)', letterSpacing: '0.15em' }}
          >
            SEASON STATS (PER GAME)
          </span>
          <div
            className="grid grid-cols-4 gap-2 mt-2"
          >
            {statBoxes.map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center py-1.5"
                style={{
                  background: '#0d0d1e',
                  borderRadius: 6,
                  border: '1px solid #1a1a2e',
                }}
              >
                <span
                  className="pixel-text"
                  style={{ fontSize: '0.25rem', color: '#666688' }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    fontFamily: "'VT323', monospace",
                    fontSize: '1.2rem',
                    color: s.highlight ? 'var(--neon-teal)' : '#ccccee',
                    textShadow: s.highlight ? '0 0 6px var(--neon-teal)' : 'none',
                  }}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Recent Form ── */}
        <div className="px-4 pt-2 pb-2">
          <span
            className="pixel-text"
            style={{ fontSize: '0.3rem', color: 'var(--neon-purple)', letterSpacing: '0.15em' }}
          >
            RECENT FORM
          </span>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {([
              { label: 'LAST 7', value: last7, dir: avgVsBaseline(last7) },
              { label: 'LAST 15', value: last15, dir: avgVsBaseline(last15) },
              { label: 'LAST 30', value: last30, dir: avgVsBaseline(last30) },
            ] as const).map((card) => (
              <div
                key={card.label}
                className="flex flex-col items-center py-2"
                style={{
                  background: '#0d0d1e',
                  borderRadius: 6,
                  border: '1px solid #1a1a2e',
                }}
              >
                <span
                  className="pixel-text"
                  style={{ fontSize: '0.25rem', color: '#666688' }}
                >
                  {card.label}
                </span>
                <span
                  style={{
                    fontFamily: "'VT323', monospace",
                    fontSize: '1.3rem',
                    color: card.value > 0 ? trendColor(card.dir) : '#555577',
                    textShadow: card.value > 0 && card.dir === 'up' ? '0 0 6px var(--neon-teal)' : 'none',
                  }}
                >
                  {card.value > 0 ? card.value.toFixed(1) : '-'}
                </span>
                {card.value > 0 && card.dir !== 'neutral' && (
                  <span
                    className="pixel-text"
                    style={{ fontSize: '0.22rem', color: trendColor(card.dir) }}
                  >
                    {trendArrow(card.dir)} {card.dir === 'up' ? 'ABOVE' : card.dir === 'near' ? 'NEAR' : 'BELOW'} AVG
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Matchup Performance ── */}
        <div className="px-4 pt-2 pb-2">
          <span
            className="pixel-text"
            style={{ fontSize: '0.3rem', color: 'var(--neon-purple)', letterSpacing: '0.15em' }}
          >
            MATCHUP PERFORMANCE
          </span>
          <div className="flex items-center gap-4 mt-2">
            <div
              className="flex flex-col items-center px-4 py-2"
              style={{
                background: '#0d0d1e',
                borderRadius: 6,
                border: '1px solid #1a1a2e',
                flex: 1,
              }}
            >
              <span className="pixel-text" style={{ fontSize: '0.25rem', color: '#666688' }}>
                TOTAL FPTS
              </span>
              <span
                className="glow-teal"
                style={{
                  fontFamily: "'VT323', monospace",
                  fontSize: '1.5rem',
                  color: 'var(--neon-teal)',
                }}
              >
                {player.fpts.toFixed(1)}
              </span>
            </div>
            <div
              className="flex flex-col items-center px-4 py-2"
              style={{
                background: '#0d0d1e',
                borderRadius: 6,
                border: '1px solid #1a1a2e',
                flex: 1,
              }}
            >
              <span className="pixel-text" style={{ fontSize: '0.25rem', color: '#666688' }}>
                GAMES PLAYED
              </span>
              <span
                style={{
                  fontFamily: "'VT323', monospace",
                  fontSize: '1.5rem',
                  color: '#ccccee',
                }}
              >
                {player.stats.gp}
              </span>
            </div>
          </div>
        </div>

        {/* ── Sparkline Trend ── */}
        <div className="px-4 pt-2 pb-4">
          <span
            className="pixel-text"
            style={{ fontSize: '0.3rem', color: 'var(--neon-purple)', letterSpacing: '0.15em' }}
          >
            FPTS TREND
          </span>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {trendLoading ? (
              <span className="pixel-text blink" style={{ fontSize: '0.25rem', color: '#555577' }}>
                LOADING TREND DATA...
              </span>
            ) : fptsData.length >= 2 ? (
              <>
                <Sparkline
                  data={fptsData}
                  width={160}
                  height={40}
                  color="var(--neon-teal)"
                  label="FPTS"
                />
                {avg7Data.length >= 2 && (
                  <Sparkline
                    data={avg7Data}
                    width={120}
                    height={40}
                    color="var(--neon-yellow)"
                    label="7-DAY AVG"
                  />
                )}
              </>
            ) : (
              <span className="pixel-text" style={{ fontSize: '0.25rem', color: '#555577' }}>
                NOT ENOUGH DATA FOR TREND
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerCardModal;

import type { FC } from 'react';
import { Link } from 'react-router-dom';
import type { Matchup } from '../types/index.js';
import TeamPanel from './TeamPanel.js';

interface MatchupRowProps {
  matchup: Matchup;
  index: number;
  isPlayoffs: boolean;
}

const ACCENT_COLORS = [
  'var(--neon-teal)',
  'var(--neon-purple)',
  'var(--neon-blue)',
  'var(--neon-orange)',
  'var(--neon-yellow)',
  'var(--neon-red)',
];

const MatchupRow: FC<MatchupRowProps> = ({ matchup, index, isPlayoffs }) => {
  const { home, away } = matchup;
  const homeWinning = home.currentScore > away.currentScore;
  const awayWinning = away.currentScore > home.currentScore;
  const accentColor = ACCENT_COLORS[index % ACCENT_COLORS.length];

  return (
    <Link
      to={`/matchup/${matchup.id}`}
      className="slide-in relative w-full block no-underline"
      style={{
        animationDelay: `${index * 0.1}s`,
        animationFillMode: 'both',
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      {/* Accent line on top */}
      <div
        className="w-full h-1"
        style={{
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
          opacity: 0.6,
        }}
      />

      <div
        className="w-full py-4 px-2"
        style={{
          background: 'var(--dark-bg)',
          borderBottom: '1px solid #111122',
        }}
      >
        {/* Matchup number badge */}
        <div className="flex justify-center mb-3">
          <span
            className="pixel-text px-3 py-1"
            style={{
              fontSize: '0.4rem',
              color: accentColor,
              border: `1px solid ${accentColor}`,
              background: '#0a0a0f',
              opacity: 0.8,
            }}
          >
            MATCHUP {index + 1}
            {matchup.isCompleted && ' - FINAL'}
          </span>
        </div>

        {/* Desktop: horizontal layout / Mobile: stacked */}
        <div className="flex flex-col md:flex-row items-stretch justify-center gap-3 md:gap-4">
          {/* Home team */}
          <div
            className="w-full md:w-80 flex-shrink-0"
            style={{
              borderLeft: '3px solid var(--neon-blue)',
              background: 'linear-gradient(90deg, #001a4408, transparent)',
            }}
          >
            <TeamPanel team={home} isWinner={homeWinning} side="home" isPlayoffs={isPlayoffs} />
          </div>

          {/* VS divider */}
          <div className="flex flex-row md:flex-col items-center justify-center gap-2 md:gap-1 py-1 md:py-0 md:px-4">
            <span
              className="pixel-text glow-red"
              style={{
                fontSize: 'clamp(1rem, 3vw, 1.8rem)',
                color: 'var(--neon-red)',
                textShadow: '0 0 12px var(--neon-red), 0 0 32px #ff222244',
                lineHeight: 1,
              }}
            >
              VS
            </span>
            {/* Score diff */}
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1rem',
                color: '#555577',
              }}
            >
              {Math.abs(home.currentScore - away.currentScore).toFixed(1)} PT
              {Math.abs(home.currentScore - away.currentScore) !== 1 ? 'S' : ''} GAP
            </span>
            {/* Projected scores */}
            {home.projectedScore > 0 && away.projectedScore > 0 && (
              <div className="flex flex-col items-center gap-1 mt-1">
                <span className="pixel-text" style={{ fontSize: '0.3rem', color: '#444466' }}>
                  PROJECTED
                </span>
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-purple)', opacity: 0.8 }}>
                    {home.projectedScore.toFixed(1)}
                  </span>
                  <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.8rem', color: '#333355' }}>-</span>
                  <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-purple)', opacity: 0.8 }}>
                    {away.projectedScore.toFixed(1)}
                  </span>
                </div>
              </div>
            )}
            {/* Win Probability Bar */}
            <div className="flex flex-col items-center gap-1 mt-2" style={{ width: '100%', minWidth: '140px' }}>
              <span className="pixel-text" style={{ fontSize: '0.3rem', color: '#444466' }}>
                WIN PROB
              </span>
              <div className="flex items-center gap-1" style={{ width: '100%' }}>
                <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.75rem', color: 'var(--neon-blue)', opacity: 0.7, flexShrink: 0, maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {matchup.home.name}
                </span>
                <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.9rem', color: 'var(--neon-blue)', minWidth: '2.2rem', textAlign: 'right', flexShrink: 0 }}>
                  {matchup.isCompleted
                    ? (matchup.home.currentScore > matchup.away.currentScore ? '100%' : '0%')
                    : `${matchup.winProbability.homeWinPct}%`}
                </span>
                <div style={{ flex: 1, height: '6px', background: '#111122', border: '1px solid #1a1a33', display: 'flex', overflow: 'hidden' }}>
                  {(() => {
                    const homePct = matchup.isCompleted
                      ? (matchup.home.currentScore > matchup.away.currentScore ? 100 : matchup.home.currentScore === matchup.away.currentScore ? 50 : 0)
                      : matchup.winProbability.homeWinPct;
                    const awayPct = matchup.isCompleted
                      ? (matchup.away.currentScore > matchup.home.currentScore ? 100 : matchup.away.currentScore === matchup.home.currentScore ? 50 : 0)
                      : matchup.winProbability.awayWinPct;
                    return (
                      <>
                        <div
                          style={{
                            width: `${homePct}%`,
                            background: 'var(--neon-blue)',
                            boxShadow: '0 0 4px var(--neon-blue)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                        <div
                          style={{
                            width: `${awayPct}%`,
                            background: 'var(--neon-orange)',
                            boxShadow: '0 0 4px var(--neon-orange)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </>
                    );
                  })()}
                </div>
                <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.9rem', color: 'var(--neon-orange)', minWidth: '2.2rem', textAlign: 'left', flexShrink: 0 }}>
                  {matchup.isCompleted
                    ? (matchup.away.currentScore > matchup.home.currentScore ? '100%' : '0%')
                    : `${matchup.winProbability.awayWinPct}%`}
                </span>
                <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.75rem', color: 'var(--neon-orange)', opacity: 0.7, flexShrink: 0, maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {matchup.away.name}
                </span>
              </div>
            </div>
          </div>

          {/* Away team */}
          <div
            className="w-full md:w-80 flex-shrink-0"
            style={{
              borderLeft: '3px solid var(--neon-orange)',
              background: 'linear-gradient(90deg, #33001108, transparent)',
            }}
          >
            <TeamPanel team={away} isWinner={awayWinning} side="away" isPlayoffs={isPlayoffs} />
          </div>
        </div>
      </div>
    </Link>
  );
};

export default MatchupRow;

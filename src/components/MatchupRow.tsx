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
            {/* Projected winner */}
            {home.projectedScore > 0 && away.projectedScore > 0 && (
              <div className="flex flex-col items-center gap-1 mt-1">
                <span
                  className="pixel-text"
                  style={{ fontSize: '0.3rem', color: '#444466' }}
                >
                  PROJ WINNER
                </span>
                <span
                  className="pixel-text"
                  style={{
                    fontSize: '0.4rem',
                    color: home.projectedScore > away.projectedScore
                      ? 'var(--neon-teal)'
                      : home.projectedScore < away.projectedScore
                        ? 'var(--neon-orange)'
                        : '#555577',
                    textShadow: '0 0 6px currentColor',
                  }}
                >
                  {home.projectedScore > away.projectedScore
                    ? home.name.length > 16 ? home.name.slice(0, 16) + '...' : home.name
                    : home.projectedScore < away.projectedScore
                      ? away.name.length > 16 ? away.name.slice(0, 16) + '...' : away.name
                      : 'TIE'}
                </span>
              </div>
            )}
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

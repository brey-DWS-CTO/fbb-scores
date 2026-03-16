import type { FC } from 'react';
import type { FantasyTeam } from '../types/index.js';
import SlotScore from './SlotScore.js';

interface TeamPanelProps {
  team: FantasyTeam;
  isWinner: boolean;
  side: 'home' | 'away';
  isPlayoffs: boolean;
}

const TeamPanel: FC<TeamPanelProps> = ({ team, isWinner, side, isPlayoffs: _isPlayoffs }) => {
  const hasFirePlayer = team.topPlayer && team.topPlayer.points > 50;
  const gpPercent = team.maxGames > 0 ? (team.gamesPlayed / team.maxGames) * 100 : 0;

  return (
    <div
      className="panel flex flex-col items-center gap-3 p-4 md:p-5 w-full"
      style={{
        maxWidth: '100%',
        borderColor: isWinner ? 'var(--neon-teal)' : 'var(--panel-border)',
        boxShadow: isWinner
          ? '0 0 12px #00ffcc44, 0 0 24px #00ffcc22, inset 0 0 8px #00ffcc11'
          : 'none',
        transition: 'box-shadow 0.3s ease',
      }}
    >
      {/* Side label */}
      <div className="flex items-center w-full">
        <span
          className="pixel-text"
          style={{
            fontSize: '0.45rem',
            color: side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)',
            opacity: 0.7,
          }}
        >
          {side === 'home' ? 'HOME' : 'AWAY'}
        </span>
      </div>

      {/* Logo / abbreviation fallback */}
      <div className="flex items-center gap-3 w-full">
        {team.logoUrl ? (
          <img
            src={team.logoUrl}
            alt={`${team.name} logo`}
            className="w-12 h-12 object-contain"
            style={{
              filter: 'drop-shadow(0 0 4px #00ffcc66)',
              imageRendering: 'auto',
            }}
          />
        ) : (
          <div
            className="w-12 h-12 flex items-center justify-center pixel-text"
            style={{
              background: side === 'home'
                ? 'linear-gradient(135deg, #001a44, #002266)'
                : 'linear-gradient(135deg, #330011, #440022)',
              border: `2px solid ${side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)'}`,
              fontSize: '0.55rem',
              color: side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)',
              letterSpacing: '0.05em',
              flexShrink: 0,
            }}
          >
            {team.abbreviation}
          </div>
        )}

        <div className="flex flex-col min-w-0">
          {/* Owner name */}
          <span
            className="pixel-text truncate"
            style={{
              fontSize: '0.4rem',
              color: '#777799',
            }}
          >
            {team.ownerName}
          </span>

          {/* Team name */}
          <span
            className="truncate"
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1.4rem',
              color: '#e0e0ff',
              lineHeight: 1.1,
            }}
          >
            {team.name}
          </span>
        </div>
      </div>

      {/* Score + Average side by side */}
      <div className="flex items-end justify-center gap-4 mt-1 w-full">
        {/* Score */}
        <div className="flex flex-col items-center">
          <span
            className="pixel-text"
            style={{ fontSize: '0.3rem', color: '#555577', marginBottom: '2px' }}
          >
            TOTAL
          </span>
          <SlotScore
            value={team.currentScore}
            className="score-display glow-teal"
            style={{
              color: 'var(--neon-teal)',
              fontSize: 'clamp(2rem, 6vw, 2.8rem)',
              textShadow: '0 0 16px #00ffcc, 0 0 40px #00ffcc66, 0 0 80px #00ffcc33',
            }}
          />
        </div>

        {/* Average — prominent */}
        <div className="flex flex-col items-center">
          <span
            className="pixel-text"
            style={{ fontSize: '0.3rem', color: '#555577', marginBottom: '2px' }}
          >
            AVG/GM
          </span>
          <SlotScore
            value={team.avgPointsPerGame}
            className="score-display glow-yellow"
            style={{
              color: 'var(--neon-yellow)',
              fontSize: 'clamp(1.6rem, 5vw, 2.2rem)',
              textShadow: '0 0 12px #ffe600, 0 0 32px #ffe60066',
            }}
          />
        </div>
      </div>

      {/* Games Played bar */}
      <div className="w-full flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span
            className="glow-blue"
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1.1rem',
              color: 'var(--neon-blue)',
            }}
          >
            {team.gamesPlayed}/{team.maxGames} GP
          </span>
          {team.gamesPlayed > 0 && team.gamesPlayed < team.maxGames && (
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1.1rem',
                color: 'var(--neon-purple)',
              }}
            >
              PROJ: {team.projectedScore.toFixed(1)}
            </span>
          )}
        </div>
        {/* GP progress bar */}
        <div
          className="w-full h-2"
          style={{ background: '#111122', border: '1px solid #1a1a33' }}
        >
          <div
            className="h-full"
            style={{
              width: `${Math.min(gpPercent, 100)}%`,
              background: 'linear-gradient(90deg, var(--neon-blue), var(--neon-teal))',
              boxShadow: '0 0 4px var(--neon-teal)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Top player section */}
      <div
        className="w-full mt-1 p-3"
        style={{
          background: '#0a0a14',
          border: '1px solid #1a1a2e',
        }}
      >
        <span
          className="pixel-text glow-yellow"
          style={{
            fontSize: '0.4rem',
            color: 'var(--neon-yellow)',
          }}
        >
          TOP DOG:
        </span>

        {team.topPlayer ? (
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1.3rem',
                color: '#e0e0ff',
              }}
            >
              {team.topPlayer.name}
            </span>
            <span
              className="pixel-text"
              style={{
                fontSize: '0.35rem',
                color: '#777799',
              }}
            >
              {team.topPlayer.position} - {team.topPlayer.nbaTeamAbbrev}
            </span>
            <span
              className="glow-teal"
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1.4rem',
                color: 'var(--neon-teal)',
                marginLeft: 'auto',
              }}
            >
              {team.topPlayer.points.toFixed(1)}
            </span>

            {/* Fire badge for high scorers */}
            {hasFirePlayer && (
              <span
                className="pixel-text blink"
                style={{
                  fontSize: '0.4rem',
                  color: 'var(--neon-orange)',
                  textShadow: '0 0 8px var(--neon-orange), 0 0 16px var(--neon-red)',
                  marginLeft: '4px',
                }}
              >
                ON FIRE
              </span>
            )}
          </div>
        ) : (
          <span
            className="pixel-text blink mt-1 inline-block"
            style={{ fontSize: '0.4rem', color: '#555577' }}
          >
            NO DATA
          </span>
        )}
      </div>

      {/* Winner indicator */}
      {isWinner && (
        <span
          className="pixel-text pulse-glow mt-1 px-3 py-1"
          style={{
            fontSize: '0.4rem',
            color: 'var(--neon-teal)',
            border: '1px solid var(--neon-teal)',
            background: '#00ffcc0a',
          }}
        >
          LEADING
        </span>
      )}
    </div>
  );
};

export default TeamPanel;

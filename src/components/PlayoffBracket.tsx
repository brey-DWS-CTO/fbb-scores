import type { FC } from 'react';
import type { Matchup, PlayoffInfo } from '../types/index.js';

interface PlayoffBracketProps {
  matchups: Matchup[];
  playoff: PlayoffInfo;
}

const PlayoffBracket: FC<PlayoffBracketProps> = ({ matchups, playoff }) => {
  const winnersMatchups = matchups.filter(m => m.playoffTierType === 'WINNERS_BRACKET');

  return (
    <div className="mb-8 px-2">
      {/* Bracket title */}
      <div className="flex items-center gap-3 mb-4">
        <span
          className="pixel-text glow-yellow"
          style={{
            fontSize: 'clamp(0.6rem, 2vw, 0.85rem)',
            color: 'var(--neon-yellow)',
          }}
        >
          PLAYOFF BRACKET
        </span>
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1rem',
            color: '#555577',
          }}
        >
          {playoff.roundLabel}
        </span>
      </div>

      {/* Bracket cards */}
      <div
        className="w-full p-4"
        style={{
          background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
          border: '2px solid var(--neon-yellow)',
          boxShadow: '0 0 16px #ffe60022, inset 0 0 24px #ffe60008',
        }}
      >
        <div className="flex flex-col gap-3">
          {winnersMatchups.map((matchup) => (
            <BracketMatchup key={matchup.id} matchup={matchup} />
          ))}
        </div>

        {/* Next round placeholder */}
        <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: '1px solid #1a1a33' }}>
          <span
            className="pixel-text"
            style={{ fontSize: '0.35rem', color: '#444466' }}
          >
            NEXT:
          </span>
          <span
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1rem',
              color: '#444466',
            }}
          >
            {playoff.matchupPeriod < 20 ? 'CHAMPIONSHIP' : 'TBD'}
          </span>
        </div>
      </div>
    </div>
  );
};

interface BracketMatchupProps {
  matchup: Matchup;
}

const BracketMatchup: FC<BracketMatchupProps> = ({ matchup }) => {
  const { home, away } = matchup;
  const homeWinning = home.currentScore > away.currentScore;
  const awayWinning = away.currentScore > home.currentScore;

  return (
    <div
      className="flex flex-col gap-0"
      style={{
        border: '1px solid #1a1a33',
        background: '#0a0a14',
      }}
    >
      <BracketTeamRow
        seed={home.playoffSeed}
        name={home.name}
        score={home.currentScore}
        avgPointsPerGame={home.avgPointsPerGame}
        gamesPlayed={home.gamesPlayed}
        maxGames={home.maxGames}
        isWinning={homeWinning}
      />
      <div style={{ height: '1px', background: '#1a1a33' }} />
      <BracketTeamRow
        seed={away.playoffSeed}
        name={away.name}
        score={away.currentScore}
        avgPointsPerGame={away.avgPointsPerGame}
        gamesPlayed={away.gamesPlayed}
        maxGames={away.maxGames}
        isWinning={awayWinning}
      />
    </div>
  );
};

interface BracketTeamRowProps {
  seed: number | null;
  name: string;
  score: number;
  avgPointsPerGame: number;
  gamesPlayed: number;
  maxGames: number;
  isWinning: boolean;
}

const BracketTeamRow: FC<BracketTeamRowProps> = ({
  seed,
  name,
  score,
  avgPointsPerGame,
  gamesPlayed,
  maxGames,
  isWinning,
}) => {
  return (
    <div
      className="flex items-center gap-3 px-3 py-3"
      style={{
        background: isWinning ? '#00ffcc08' : 'transparent',
        borderLeft: isWinning ? '3px solid var(--neon-teal)' : '3px solid transparent',
      }}
    >
      {/* Seed */}
      <span
        className="pixel-text"
        style={{
          fontSize: '0.35rem',
          color: '#555577',
          width: '1.5rem',
          textAlign: 'center',
        }}
      >
        #{seed ?? '?'}
      </span>

      {/* Team name */}
      <span
        className="flex-1 truncate"
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.3rem',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
        }}
      >
        {name}
      </span>

      {/* GP */}
      <span
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.2rem',
          color: 'var(--neon-blue)',
          textShadow: '0 0 6px #4488ff44',
        }}
      >
        {gamesPlayed}/{maxGames}
      </span>

      {/* Average */}
      <span
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.3rem',
          color: 'var(--neon-yellow)',
          textShadow: '0 0 6px #ffe60044',
          minWidth: '2.5rem',
          textAlign: 'right',
        }}
      >
        {avgPointsPerGame.toFixed(1)}
      </span>

      {/* Score */}
      <span
        className="score-display"
        style={{
          fontSize: '1.8rem',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
          textShadow: isWinning
            ? '0 0 12px #00ffcc88, 0 0 24px #00ffcc44'
            : '0 0 6px #aaaacc33',
          minWidth: '5rem',
          textAlign: 'right',
        }}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
};

export default PlayoffBracket;

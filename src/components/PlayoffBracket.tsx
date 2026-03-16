import type { FC } from 'react';
import { Link } from 'react-router-dom';
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

      {/* Matchups — each in its own card */}
      <div className="flex flex-col gap-4">
        {winnersMatchups.map((matchup, i) => (
          <BracketMatchup key={matchup.id} matchup={matchup} matchupNum={i + 1} />
        ))}
      </div>

      {/* Next round placeholder */}
      <div
        className="flex items-center gap-2 mt-4 px-4 py-3"
        style={{
          background: '#0a0a14',
          border: '1px solid #1a1a2e',
        }}
      >
        <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#444466' }}>
          NEXT:
        </span>
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1.1rem',
            color: '#555577',
          }}
        >
          {playoff.matchupPeriod < 20 ? 'CHAMPIONSHIP' : 'TBD'}
        </span>
      </div>
    </div>
  );
};

interface BracketMatchupProps {
  matchup: Matchup;
  matchupNum: number;
}

const BracketMatchup: FC<BracketMatchupProps> = ({ matchup, matchupNum }) => {
  const { home, away } = matchup;
  const homeWinning = home.currentScore > away.currentScore;
  const awayWinning = away.currentScore > home.currentScore;

  return (
    <Link
      to={`/matchup/${matchup.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          border: '2px solid var(--neon-yellow)',
          boxShadow: '0 0 12px #ffe60015, inset 0 0 16px #ffe60008',
          background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
        }}
      >
        {/* Matchup label */}
        <div
          className="px-4 py-1"
          style={{
            background: '#ffe60008',
            borderBottom: '1px solid #ffe60022',
          }}
        >
          <span className="pixel-text" style={{ fontSize: '0.3rem', color: 'var(--neon-yellow)', opacity: 0.7 }}>
            MATCHUP {matchupNum}
            {matchup.isCompleted && ' — FINAL'}
          </span>
        </div>
        {/* Column headers — aligned with team row data */}
        <div
          className="flex items-center gap-3 px-4 pt-2 pb-1"
          style={{ borderBottom: '1px solid #1a1a33' }}
        >
          <span className="pixel-text" style={{ fontSize: '0.3rem', color: '#444466', width: '1.8rem', textAlign: 'center' }}>#</span>
          <span className="flex-1 pixel-text" style={{ fontSize: '0.35rem', color: '#555577', letterSpacing: '0.1em' }}>TEAM</span>
          <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-blue)', textShadow: '0 0 6px #4488ff44', letterSpacing: '0.1em' }}>GP</span>
          <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-yellow)', textShadow: '0 0 6px #ffe60044', minWidth: '3rem', textAlign: 'right', letterSpacing: '0.1em' }}>AVG</span>
          <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-teal)', textShadow: '0 0 6px #00ffcc44', minWidth: '5.5rem', textAlign: 'right', letterSpacing: '0.1em' }}>TOTAL</span>
          <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-purple)', textShadow: '0 0 6px #8844ff44', minWidth: '5.5rem', textAlign: 'right', letterSpacing: '0.1em' }}>PROJ</span>
        </div>

        <BracketTeamRow
          seed={home.playoffSeed}
          name={home.name}
          score={home.currentScore}
          projectedScore={home.projectedScore}
          avgPointsPerGame={home.avgPointsPerGame}
          gamesPlayed={home.gamesPlayed}
          maxGames={home.maxGames}
          isWinning={homeWinning}
        />
        <div style={{ height: '1px', background: '#1a1a33', margin: '0 12px' }} />
        <BracketTeamRow
          seed={away.playoffSeed}
          name={away.name}
          score={away.currentScore}
          projectedScore={away.projectedScore}
          avgPointsPerGame={away.avgPointsPerGame}
          gamesPlayed={away.gamesPlayed}
          maxGames={away.maxGames}
          isWinning={awayWinning}
        />
      </div>
    </Link>
  );
};

interface BracketTeamRowProps {
  seed: number | null;
  name: string;
  score: number;
  projectedScore: number;
  avgPointsPerGame: number;
  gamesPlayed: number;
  maxGames: number;
  isWinning: boolean;
}

const BracketTeamRow: FC<BracketTeamRowProps> = ({
  seed,
  name,
  score,
  projectedScore,
  avgPointsPerGame,
  gamesPlayed,
  maxGames,
  isWinning,
}) => {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        background: isWinning ? '#00ffcc08' : 'transparent',
        borderLeft: isWinning ? '4px solid var(--neon-teal)' : '4px solid transparent',
        cursor: 'pointer',
        transition: 'background 0.2s',
      }}
    >
      {/* Seed */}
      <span
        className="pixel-text"
        style={{
          fontSize: '0.4rem',
          color: isWinning ? 'var(--neon-teal)' : '#555577',
          width: '1.8rem',
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
          fontSize: '1.5rem',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
          textShadow: isWinning ? '0 0 8px #00ffcc44' : 'none',
        }}
      >
        {name}
      </span>

      {/* GP */}
      <span
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.3rem',
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
          fontSize: '1.4rem',
          color: 'var(--neon-yellow)',
          textShadow: '0 0 6px #ffe60044',
          minWidth: '3rem',
          textAlign: 'right',
        }}
      >
        {avgPointsPerGame.toFixed(1)}
      </span>

      {/* Score */}
      <span
        className="score-display"
        style={{
          fontSize: '2rem',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
          textShadow: isWinning
            ? '0 0 12px #00ffcc88, 0 0 24px #00ffcc44'
            : '0 0 6px #aaaacc33',
          minWidth: '5.5rem',
          textAlign: 'right',
        }}
      >
        {score.toFixed(1)}
      </span>

      {/* Projected */}
      <span
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.4rem',
          color: 'var(--neon-purple)',
          textShadow: '0 0 6px #8844ff44',
          minWidth: '5.5rem',
          textAlign: 'right',
          opacity: 0.8,
        }}
      >
        {projectedScore > 0 ? projectedScore.toFixed(1) : '-'}
      </span>
    </div>
  );
};

export default PlayoffBracket;

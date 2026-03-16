import { useState, type FC } from 'react';
import { Link } from 'react-router-dom';
import type { Matchup, PlayoffInfo } from '../types/index.js';

interface PlayoffBracketProps {
  matchups: Matchup[];
  playoff: PlayoffInfo;
}

const PlayoffBracket: FC<PlayoffBracketProps> = ({ matchups, playoff }) => {
  const [showConsolation, setShowConsolation] = useState(false);

  const winnersMatchups = matchups.filter(m => m.playoffTierType === 'WINNERS_BRACKET');
  const consolationMatchups = matchups.filter(m => m.playoffTierType === 'LOSERS_CONSOLATION_LADDER');
  const allCompleted = winnersMatchups.every(m => m.isCompleted);
  const anyInProgress = !allCompleted && winnersMatchups.length > 0;

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

        {/* LIVE badge when matchups are in progress */}
        {anyInProgress && (
          <span
            className="flex items-center gap-1.5 px-2 py-0.5"
            style={{
              border: '1px solid var(--neon-red)',
              background: '#ff000010',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--neon-red)',
                boxShadow: '0 0 6px var(--neon-red), 0 0 12px var(--neon-red)',
                animation: 'pulse-dot 1.5s ease-in-out infinite',
              }}
            />
            <span
              className="pixel-text"
              style={{
                fontSize: '0.3rem',
                color: 'var(--neon-red)',
                letterSpacing: '0.15em',
              }}
            >
              LIVE
            </span>
          </span>
        )}

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

      {/* Next round indicator */}
      <NextRoundIndicator playoff={playoff} anyInProgress={anyInProgress} />

      {/* Consolation bracket (collapsible) */}
      {consolationMatchups.length > 0 && (
        <div className="mt-6" style={{ opacity: 0.7 }}>
          {/* Toggle header */}
          <button
            onClick={() => setShowConsolation(prev => !prev)}
            className="flex items-center gap-2 w-full px-4 py-3 cursor-pointer"
            style={{
              background: '#0a0a14',
              border: '1px solid #1a1a2e',
              textAlign: 'left',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#555577'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a2e'; }}
          >
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1.2rem',
                color: '#555577',
                transition: 'transform 0.2s',
                transform: showConsolation ? 'rotate(90deg)' : 'rotate(0deg)',
                display: 'inline-block',
              }}
            >
              &#9654;
            </span>
            <span
              className="pixel-text"
              style={{
                fontSize: '0.4rem',
                color: '#555577',
                letterSpacing: '0.1em',
              }}
            >
              CONSOLATION LADDER
            </span>
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '0.95rem',
                color: '#444466',
                marginLeft: 'auto',
              }}
            >
              {consolationMatchups.length} MATCHUP{consolationMatchups.length !== 1 ? 'S' : ''}
            </span>
          </button>

          {/* Consolation matchups */}
          {showConsolation && (
            <div className="flex flex-col gap-4 mt-4">
              {consolationMatchups.map((matchup, i) => (
                <BracketMatchup
                  key={matchup.id}
                  matchup={matchup}
                  matchupNum={i + 1}
                  accentColor="#555577"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pulsing dot keyframes */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
};

/* ─── Next Round Indicator ─────────────────────────────────────────────────── */

interface NextRoundIndicatorProps {
  playoff: PlayoffInfo;
  anyInProgress: boolean;
}

const NextRoundIndicator: FC<NextRoundIndicatorProps> = ({ playoff, anyInProgress }) => {
  // Determine the total number of playoff rounds from team count
  // e.g. 8 teams = 3 rounds, 6 teams = 3 rounds, 4 teams = 2 rounds
  const totalRounds = Math.ceil(Math.log2(playoff.playoffTeamCount));
  // Current round number (matchupPeriod relative to first playoff period)
  // The roundLabel already has the round info, so parse current round from it
  const currentRoundMatch = playoff.roundLabel.match(/ROUND\s+(\d+)/i);
  const currentRound = currentRoundMatch ? parseInt(currentRoundMatch[1], 10) : null;
  const isChampionship = playoff.roundLabel.toUpperCase().includes('CHAMPIONSHIP');

  // If this IS the championship round
  if (isChampionship) {
    return (
      <div
        className="flex items-center justify-center gap-2 mt-4 px-4 py-3"
        style={{
          background: 'linear-gradient(135deg, #ffe60008, #0a0a14)',
          border: '2px solid var(--neon-yellow)',
          boxShadow: '0 0 16px #ffe60022',
        }}
      >
        <span className="pixel-text glow-yellow" style={{ fontSize: '0.45rem', color: 'var(--neon-yellow)', letterSpacing: '0.15em' }}>
          &#9733; FINAL ROUND &#9733;
        </span>
        {anyInProgress && (
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--neon-yellow)',
              boxShadow: '0 0 6px var(--neon-yellow)',
              animation: 'pulse-dot 1.5s ease-in-out infinite',
              marginLeft: '4px',
            }}
          />
        )}
      </div>
    );
  }

  // Determine next round label
  let nextLabel: string;
  if (currentRound !== null) {
    const nextRound = currentRound + 1;
    if (nextRound >= totalRounds) {
      nextLabel = 'CHAMPIONSHIP';
    } else {
      nextLabel = `ROUND ${nextRound}`;
    }
  } else {
    nextLabel = 'NEXT ROUND';
  }

  return (
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
        {nextLabel}
      </span>
      {anyInProgress && (
        <span
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'var(--neon-teal)',
            boxShadow: '0 0 4px var(--neon-teal)',
            animation: 'pulse-dot 1.5s ease-in-out infinite',
            marginLeft: '4px',
          }}
        />
      )}
    </div>
  );
};

/* ─── Bracket Matchup Card ─────────────────────────────────────────────────── */

interface BracketMatchupProps {
  matchup: Matchup;
  matchupNum: number;
  accentColor?: string;
}

const BracketMatchup: FC<BracketMatchupProps> = ({ matchup, matchupNum, accentColor }) => {
  const { home, away } = matchup;
  const homeWinning = home.currentScore > away.currentScore;
  const awayWinning = away.currentScore > home.currentScore;
  const accent = accentColor ?? 'var(--neon-yellow)';
  const isConsolation = !!accentColor;

  return (
    <Link
      to={`/matchup/${matchup.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          border: `2px solid ${accent}`,
          boxShadow: isConsolation
            ? 'none'
            : '0 0 12px #ffe60015, inset 0 0 16px #ffe60008',
          background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
        }}
      >
        {/* Matchup label */}
        <div
          className="px-4 py-1"
          style={{
            background: isConsolation ? '#55557708' : '#ffe60008',
            borderBottom: `1px solid ${isConsolation ? '#55557722' : '#ffe60022'}`,
          }}
        >
          <span className="pixel-text" style={{ fontSize: '0.3rem', color: accent, opacity: 0.7 }}>
            {isConsolation ? 'CONSOLATION' : 'MATCHUP'} {matchupNum}
            {matchup.isCompleted && ' — FINAL'}
          </span>
        </div>

        {/* Column headers */}
        <div
          className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 pt-2 pb-1"
          style={{ borderBottom: '1px solid #1a1a33' }}
        >
          <span className="pixel-text" style={{ fontSize: '0.3rem', color: '#444466', width: '1.5rem', textAlign: 'center' }}>#</span>
          <span className="flex-1 pixel-text" style={{ fontSize: '0.35rem', color: '#555577', letterSpacing: '0.1em' }}>TEAM</span>
          <span className="pixel-text hidden sm:inline" style={{ fontSize: '0.35rem', color: 'var(--neon-blue)', textShadow: '0 0 6px #4488ff44', letterSpacing: '0.1em' }}>GP</span>
          <span className="pixel-text hidden md:inline" style={{ fontSize: '0.35rem', color: 'var(--neon-yellow)', textShadow: '0 0 6px #ffe60044', minWidth: '3rem', textAlign: 'right', letterSpacing: '0.1em' }}>AVG</span>
          <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-teal)', textShadow: '0 0 6px #00ffcc44', minWidth: '3.5rem', textAlign: 'right', letterSpacing: '0.1em' }}>
            <span className="sm:hidden">PTS</span>
            <span className="hidden sm:inline">TOTAL</span>
          </span>
          <span className="pixel-text hidden sm:inline" style={{ fontSize: '0.35rem', color: 'var(--neon-purple)', textShadow: '0 0 6px #8844ff44', minWidth: '3.5rem', textAlign: 'right', letterSpacing: '0.1em' }}>PROJ</span>
        </div>

        <BracketTeamRow
          seed={home.playoffSeed}
          name={home.name}
          abbreviation={home.abbreviation}
          score={home.currentScore}
          projectedScore={home.projectedScore}
          avgPointsPerGame={home.avgPointsPerGame}
          gamesPlayed={home.gamesPlayed}
          maxGames={home.maxGames}
          isWinning={homeWinning}
          isWinner={matchup.isCompleted && homeWinning}
        />
        <div style={{ height: '1px', background: '#1a1a33', margin: '0 12px' }} />
        <BracketTeamRow
          seed={away.playoffSeed}
          name={away.name}
          abbreviation={away.abbreviation}
          score={away.currentScore}
          projectedScore={away.projectedScore}
          avgPointsPerGame={away.avgPointsPerGame}
          gamesPlayed={away.gamesPlayed}
          maxGames={away.maxGames}
          isWinning={awayWinning}
          isWinner={matchup.isCompleted && awayWinning}
        />
      </div>
    </Link>
  );
};

/* ─── Bracket Team Row ─────────────────────────────────────────────────────── */

interface BracketTeamRowProps {
  seed: number | null;
  name: string;
  abbreviation: string;
  score: number;
  projectedScore: number;
  avgPointsPerGame: number;
  gamesPlayed: number;
  maxGames: number;
  isWinning: boolean;
  isWinner?: boolean;
}

const BracketTeamRow: FC<BracketTeamRowProps> = ({
  seed,
  name,
  abbreviation,
  score,
  projectedScore,
  avgPointsPerGame,
  gamesPlayed,
  maxGames,
  isWinning,
  isWinner = false,
}) => {
  return (
    <div
      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3"
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
          width: '1.5rem',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        #{seed ?? '?'}
      </span>

      {/* Team name — full on desktop, abbreviation on mobile */}
      <span
        className="flex-1 truncate"
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: 'clamp(1.1rem, 3vw, 1.5rem)',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
          textShadow: isWinning ? '0 0 8px #00ffcc44' : 'none',
        }}
      >
        <span className="hidden sm:inline">{name}</span>
        <span className="sm:hidden">{abbreviation}</span>
        {/* Winner trophy indicator */}
        {isWinner && (
          <span
            style={{
              marginLeft: '6px',
              fontSize: 'clamp(0.9rem, 2.5vw, 1.2rem)',
              color: 'var(--neon-yellow)',
              textShadow: '0 0 8px #ffe60066',
            }}
            title="Winner"
          >
            &#127942;
          </span>
        )}
      </span>

      {/* GP — hidden on mobile */}
      <span
        className="hidden sm:inline"
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.3rem',
          color: 'var(--neon-blue)',
          textShadow: '0 0 6px #4488ff44',
          flexShrink: 0,
        }}
      >
        {gamesPlayed}/{maxGames}
      </span>

      {/* Average — hidden on mobile and small tablets */}
      <span
        className="hidden md:inline"
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.4rem',
          color: 'var(--neon-yellow)',
          textShadow: '0 0 6px #ffe60044',
          minWidth: '3rem',
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {avgPointsPerGame.toFixed(1)}
      </span>

      {/* Score — always visible, responsive size */}
      <span
        className="score-display"
        style={{
          fontSize: 'clamp(1.4rem, 4vw, 2rem)',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
          textShadow: isWinning
            ? '0 0 12px #00ffcc88, 0 0 24px #00ffcc44'
            : '0 0 6px #aaaacc33',
          minWidth: '3.5rem',
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {score.toFixed(1)}
      </span>

      {/* Projected — hidden on mobile */}
      <span
        className="hidden sm:inline"
        style={{
          fontFamily: "'VT323', monospace",
          fontSize: '1.4rem',
          color: 'var(--neon-purple)',
          textShadow: '0 0 6px #8844ff44',
          minWidth: '3.5rem',
          textAlign: 'right',
          opacity: 0.8,
          flexShrink: 0,
        }}
      >
        {projectedScore > 0 ? projectedScore.toFixed(1) : '-'}
      </span>
    </div>
  );
};

export default PlayoffBracket;

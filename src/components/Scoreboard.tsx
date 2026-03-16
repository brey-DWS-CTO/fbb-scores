import { useState, useMemo, type FC } from 'react';
import type { LeagueScoreboard, Matchup } from '../types/index.js';
import MatchupRow from './MatchupRow.js';
import PlayoffBracket from './PlayoffBracket.js';

interface ScoreboardProps {
  data: LeagueScoreboard;
  selectedPeriod?: number;
}

const Scoreboard: FC<ScoreboardProps> = ({ data, selectedPeriod }) => {
  const [sortByScore, setSortByScore] = useState(false);
  const { playoff } = data;

  // Separate winner's bracket from consolation
  const { winnersBracket, consolation } = useMemo(() => {
    if (!playoff.isPlayoffs) {
      return { winnersBracket: data.matchups, consolation: [] };
    }
    const winners: Matchup[] = [];
    const losers: Matchup[] = [];
    for (const m of data.matchups) {
      if (m.playoffTierType === 'WINNERS_BRACKET') {
        winners.push(m);
      } else {
        losers.push(m);
      }
    }
    return { winnersBracket: winners, consolation: losers };
  }, [data.matchups, playoff.isPlayoffs]);

  const sortMatchups = (matchups: Matchup[]) => {
    if (!sortByScore) return matchups;
    return [...matchups].sort((a, b) => {
      const maxA = Math.max(a.home.currentScore, a.away.currentScore);
      const maxB = Math.max(b.home.currentScore, b.away.currentScore);
      return maxB - maxA;
    });
  };

  return (
    <section
      className="w-full max-w-5xl mx-auto px-2 sm:px-4 py-4 sm:py-6"
      style={{ background: 'var(--dark-bg)' }}
    >
      {/* Playoff bracket visualization */}
      {playoff.isPlayoffs && (
        <PlayoffBracket matchups={data.matchups} playoff={playoff} />
      )}

      {/* Section header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-6 px-2">
        <div className="flex flex-col items-center sm:items-start gap-1">
          <h2
            className="pixel-text glow-purple"
            style={{
              fontSize: 'clamp(0.55rem, 2vw, 0.8rem)',
              color: 'var(--neon-purple)',
            }}
          >
            {playoff.isPlayoffs ? "WINNER'S BRACKET" : "THIS WEEK'S BATTLES"}
          </h2>
          <span
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1.2rem',
              color: '#777799',
            }}
          >
            {winnersBracket.length} MATCHUP{winnersBracket.length !== 1 ? 'S' : ''} IN PLAY
          </span>
        </div>

        {/* Sort toggle */}
        <button
          onClick={() => setSortByScore((prev) => !prev)}
          className="pixel-text cursor-pointer px-4 py-2"
          style={{
            fontSize: '0.45rem',
            color: sortByScore ? 'var(--neon-teal)' : '#777799',
            background: sortByScore ? '#00ffcc0a' : 'transparent',
            border: `2px solid ${sortByScore ? 'var(--neon-teal)' : '#333355'}`,
            transition: 'all 0.2s ease',
            boxShadow: sortByScore ? '0 0 8px #00ffcc44' : 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--neon-teal)';
            e.currentTarget.style.color = 'var(--neon-teal)';
          }}
          onMouseLeave={(e) => {
            if (!sortByScore) {
              e.currentTarget.style.borderColor = '#333355';
              e.currentTarget.style.color = '#777799';
            }
          }}
        >
          {sortByScore ? 'SORTED BY SCORE' : 'SORT BY SCORE'}
        </button>
      </div>

      {/* Winner's bracket matchups */}
      <div className="flex flex-col gap-2">
        {sortMatchups(winnersBracket).map((matchup, i) => (
          <MatchupRow key={matchup.id} matchup={matchup} index={i} isPlayoffs={playoff.isPlayoffs} />
        ))}
      </div>

      {/* Consolation bracket */}
      {consolation.length > 0 && (
        <>
          <div className="flex flex-col items-center sm:items-start gap-1 mt-8 mb-6 px-2">
            <h2
              className="pixel-text"
              style={{
                fontSize: 'clamp(0.5rem, 1.8vw, 0.7rem)',
                color: '#555577',
              }}
            >
              CONSOLATION LADDER
            </h2>
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '1.1rem',
                color: '#444466',
              }}
            >
              {consolation.length} MATCHUP{consolation.length !== 1 ? 'S' : ''}
            </span>
          </div>
          <div className="flex flex-col gap-2" style={{ opacity: 0.7 }}>
            {sortMatchups(consolation).map((matchup, i) => (
              <MatchupRow
                key={matchup.id}
                matchup={matchup}
                index={i + winnersBracket.length}
                isPlayoffs={playoff.isPlayoffs}
              />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {data.matchups.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16">
          <span
            className="pixel-text glow-red"
            style={{ fontSize: '0.6rem', color: 'var(--neon-red)' }}
          >
            NO MATCHUPS FOUND
          </span>
          <span
            style={{
              fontFamily: "'VT323', monospace",
              fontSize: '1.2rem',
              color: '#555577',
            }}
          >
            CHECK BACK WHEN THE WEEK STARTS
          </span>
        </div>
      )}
    </section>
  );
};

export default Scoreboard;

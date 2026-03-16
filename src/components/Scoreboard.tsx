import { useState, useMemo, type FC } from 'react';
import type { LeagueScoreboard, Matchup } from '../types/index.js';
import MatchupRow from './MatchupRow.js';
import PlayoffBracket from './PlayoffBracket.js';
import Leaderboard from './Leaderboard.js';
import ProjectionBreakdownComponent from './ProjectionBreakdown.js';

interface ScoreboardProps {
  data: LeagueScoreboard;
  selectedPeriod?: number;
}

type ViewMode = 'list' | 'bracket' | 'leaderboard' | 'projections';

const Scoreboard: FC<ScoreboardProps> = ({ data, selectedPeriod: _selectedPeriod }) => {
  const [sortByScore, setSortByScore] = useState(false);
  const { playoff } = data;
  const [viewMode, setViewMode] = useState<ViewMode>(playoff.isPlayoffs ? 'bracket' : 'list');

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

  // Check if any matchup has projection data
  const hasProjections = data.matchups.some(
    (m) => m.home.projectionBreakdown || m.away.projectionBreakdown,
  );

  // Available view modes depend on playoff status
  const viewModes: Array<{ key: ViewMode; label: string }> = [
    ...(playoff.isPlayoffs ? [{ key: 'bracket' as ViewMode, label: 'BRACKET' }] : []),
    { key: 'list', label: 'LIST' },
    { key: 'leaderboard', label: 'STANDINGS' },
    ...(hasProjections ? [{ key: 'projections' as ViewMode, label: 'PROJECTIONS' }] : []),
  ];

  return (
    <section
      className="w-full max-w-5xl mx-auto px-2 sm:px-4 py-4 sm:py-6"
      style={{ background: 'var(--dark-bg)' }}
    >
      {/* Section header with view toggle */}
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

        <div className="flex items-center gap-2 flex-wrap justify-center">
          {/* View mode toggle */}
          <div
            className="flex"
            style={{
              border: '2px solid #333355',
              overflow: 'hidden',
            }}
          >
            {viewModes.map((mode) => (
              <ViewToggleBtn
                key={mode.key}
                label={mode.label}
                active={viewMode === mode.key}
                onClick={() => setViewMode(mode.key)}
              />
            ))}
          </div>

          {/* Sort toggle (list view only) */}
          {viewMode === 'list' && (
            <button
              onClick={() => setSortByScore((prev) => !prev)}
              className="pixel-text cursor-pointer px-5 py-2.5"
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
          )}
        </div>
      </div>

      {/* Playoff bracket view */}
      {playoff.isPlayoffs && viewMode === 'bracket' && (
        <PlayoffBracket matchups={data.matchups} playoff={playoff} />
      )}

      {/* Leaderboard view */}
      {viewMode === 'leaderboard' && (
        <Leaderboard matchups={data.matchups} />
      )}

      {/* Projections view */}
      {viewMode === 'projections' && (
        <div className="flex flex-col gap-8">
          {winnersBracket.map((matchup, i) => {
            const homeBreakdown = matchup.home.projectionBreakdown;
            const awayBreakdown = matchup.away.projectionBreakdown;
            if (!homeBreakdown && !awayBreakdown) return null;

            const accentColors = [
              'var(--neon-teal)', 'var(--neon-purple)', 'var(--neon-blue)',
              'var(--neon-orange)', 'var(--neon-yellow)', 'var(--neon-red)',
            ];
            const accentColor = accentColors[i % accentColors.length];

            return (
              <div key={matchup.id}>
                {/* Matchup header */}
                <div className="flex justify-center mb-3">
                  <span
                    className="pixel-text px-3 py-1"
                    style={{
                      fontSize: '0.4rem',
                      color: accentColor,
                      border: `1px solid ${accentColor}`,
                      background: '#0a0a0f',
                    }}
                  >
                    MATCHUP {i + 1} PROJECTION
                  </span>
                </div>

                {/* Projected score summary */}
                {homeBreakdown && awayBreakdown && (
                  <div
                    className="flex items-center justify-center gap-6 mb-4 p-4"
                    style={{ background: '#0a0a1a', border: '1px solid #1a1a33' }}
                  >
                    <div className="flex flex-col items-center">
                      <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-blue)' }}>
                        {matchup.home.name}
                      </span>
                      <span
                        className="score-display glow-teal"
                        style={{
                          fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
                          color: homeBreakdown.projectedTotal >= awayBreakdown.projectedTotal ? 'var(--neon-teal)' : '#aaaacc',
                          textShadow: homeBreakdown.projectedTotal >= awayBreakdown.projectedTotal ? '0 0 12px #00ffcc' : 'none',
                        }}
                      >
                        {homeBreakdown.projectedTotal.toFixed(1)}
                      </span>
                    </div>
                    <span className="pixel-text glow-red" style={{ fontSize: '0.5rem', color: 'var(--neon-red)' }}>VS</span>
                    <div className="flex flex-col items-center">
                      <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-orange)' }}>
                        {matchup.away.name}
                      </span>
                      <span
                        className="score-display glow-teal"
                        style={{
                          fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
                          color: awayBreakdown.projectedTotal >= homeBreakdown.projectedTotal ? 'var(--neon-teal)' : '#aaaacc',
                          textShadow: awayBreakdown.projectedTotal >= homeBreakdown.projectedTotal ? '0 0 12px #00ffcc' : 'none',
                        }}
                      >
                        {awayBreakdown.projectedTotal.toFixed(1)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Side-by-side breakdowns */}
                <div className="flex flex-col lg:flex-row gap-4">
                  {homeBreakdown && (
                    <ProjectionBreakdownComponent
                      breakdown={homeBreakdown}
                      teamName={matchup.home.name}
                      side="home"
                    />
                  )}
                  {awayBreakdown && (
                    <ProjectionBreakdownComponent
                      breakdown={awayBreakdown}
                      teamName={matchup.away.name}
                      side="away"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view: Winner's bracket matchups */}
      {viewMode === 'list' && (
        <div className="flex flex-col gap-2">
          {sortMatchups(winnersBracket).map((matchup, i) => (
            <MatchupRow key={matchup.id} matchup={matchup} index={i} isPlayoffs={playoff.isPlayoffs} />
          ))}
        </div>
      )}

      {/* Consolation bracket (list view only) */}
      {consolation.length > 0 && viewMode === 'list' && (
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

// ─── View Toggle Button ──────────────────────────────────────────────────────

interface ViewToggleBtnProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

const ViewToggleBtn: FC<ViewToggleBtnProps> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className="pixel-text cursor-pointer px-4 py-2.5"
    style={{
      fontSize: '0.4rem',
      color: active ? 'var(--neon-yellow)' : '#555577',
      background: active ? '#ffe60012' : 'transparent',
      border: 'none',
      borderRight: '1px solid #333355',
      transition: 'all 0.15s ease',
      boxShadow: active ? 'inset 0 0 8px #ffe60015' : 'none',
    }}
    onMouseEnter={(e) => {
      if (!active) e.currentTarget.style.color = 'var(--neon-yellow)';
    }}
    onMouseLeave={(e) => {
      if (!active) e.currentTarget.style.color = '#555577';
    }}
  >
    {label}
  </button>
);

export default Scoreboard;

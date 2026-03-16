import type { FC } from 'react';
import type { MatchupDetail } from '../../types/index.js';
import { computeProjectedScore } from '../../lib/espn/calculations.js';

interface MatchupDetailHeaderProps {
  data: MatchupDetail;
}

const MatchupDetailHeader: FC<MatchupDetailHeaderProps> = ({ data }) => {
  return (
    <div
      className="w-full p-4 sm:p-6 mb-6"
      style={{
        background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
        border: '2px solid var(--neon-purple)',
        boxShadow: '0 0 16px #8844ff22',
      }}
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <TeamScore
          team={data.home}
          opponent={data.away}
          glowColor="#00ffcc66"
        />

        <div className="flex flex-col items-center gap-1">
          <span className="pixel-text glow-red" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.4rem)', color: 'var(--neon-red)' }}>VS</span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: '#444466' }}>
            {Math.abs(data.home.currentScore - data.away.currentScore).toFixed(1)} PTS GAP
          </span>
          {data.isCompleted && (
            <span className="pixel-text" style={{ fontSize: '0.4rem', color: 'var(--neon-yellow)' }}>FINAL</span>
          )}
        </div>

        <TeamScore
          team={data.away}
          opponent={data.home}
          glowColor="#ff884466"
        />
      </div>
    </div>
  );
};

interface TeamScoreProps {
  team: MatchupDetail['home'];
  opponent: MatchupDetail['away'];
  glowColor: string;
}

const TeamScore: FC<TeamScoreProps> = ({ team, opponent, glowColor }) => {
  const isWinning = team.currentScore > opponent.currentScore;

  return (
    <div className="flex flex-col items-center gap-1 flex-1">
      {team.logoUrl && (
        <img src={team.logoUrl} alt="" className="w-12 h-12 object-contain mb-1" style={{ filter: `drop-shadow(0 0 4px ${glowColor})` }} />
      )}
      <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.4rem', color: '#e0e0ff' }}>{team.name}</span>
      <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>{team.ownerName}</span>
      <span
        className="score-display"
        style={{
          fontSize: 'clamp(2rem, 6vw, 3rem)',
          color: isWinning ? 'var(--neon-teal)' : '#aaaacc',
          textShadow: isWinning ? '0 0 16px #00ffcc, 0 0 40px #00ffcc66' : 'none',
        }}
      >
        {team.currentScore.toFixed(1)}
      </span>
      <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-blue)' }}>
        {team.gamesPlayed}/{team.maxGames} GP
      </span>
      {team.gamesPlayed > 0 && (
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-purple)', opacity: 0.8 }}>
          PROJ {computeProjectedScore(team.currentScore, team.gamesPlayed, team.maxGames).toFixed(1)}
        </span>
      )}
    </div>
  );
};

export default MatchupDetailHeader;

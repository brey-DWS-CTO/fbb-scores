import { useParams, Link } from 'react-router-dom';
import { useMatchupDetail } from '../hooks/useMatchupDetail.js';
import MatchupDetailHeader from './matchup/MatchupDetailHeader.js';
import TeamRoster from './matchup/TeamRoster.js';
import type { FC } from 'react';

const MatchupDetailPage: FC = () => {
  const { matchupId } = useParams<{ matchupId: string }>();
  const id = parseInt(matchupId ?? '0', 10);
  const { data, isLoading, isError, error } = useMatchupDetail(id);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <span className="pixel-text blink glow-teal" style={{ fontSize: '0.6rem', color: 'var(--neon-teal)' }}>
          LOADING MATCHUP...
        </span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <span className="pixel-text glow-red" style={{ fontSize: '0.6rem', color: 'var(--neon-red)' }}>
          ERROR LOADING MATCHUP
        </span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.2rem', color: '#555577' }}>
          {error instanceof Error ? error.message : 'Unknown error'}
        </span>
        <Link
          to="/"
          className="pixel-text px-4 py-2"
          style={{ fontSize: '0.45rem', color: 'var(--neon-teal)', border: '1px solid var(--neon-teal)', textDecoration: 'none' }}
        >
          BACK TO SCOREBOARD
        </Link>
      </div>
    );
  }

  return (
    <section className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6">
      <Link
        to="/"
        className="pixel-text inline-block mb-4 px-3 py-1"
        style={{ fontSize: '0.4rem', color: 'var(--neon-teal)', border: '1px solid #333355', textDecoration: 'none' }}
      >
        &lt; BACK TO SCOREBOARD
      </Link>

      <MatchupDetailHeader data={data} />

      <div className="flex flex-col lg:flex-row gap-4">
        <TeamRoster team={data.home} side="home" />
        <TeamRoster team={data.away} side="away" />
      </div>
    </section>
  );
};

export default MatchupDetailPage;

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMatchupDetail } from '../hooks/useMatchupDetail.js';
import { useDailyView } from '../hooks/useDailyView.js';
import MatchupDetailHeader from './matchup/MatchupDetailHeader.js';
import TeamRoster from './matchup/TeamRoster.js';
import DailyView from './DailyView.js';
import type { FC } from 'react';

type ViewTab = 'matchup' | 'today';

const MatchupDetailPage: FC = () => {
  const { matchupId } = useParams<{ matchupId: string }>();
  const id = parseInt(matchupId ?? '0', 10);
  const [activeTab, setActiveTab] = useState<ViewTab>('matchup');
  const { data, isLoading, isError, error } = useMatchupDetail(id);
  const { data: dailyData, isLoading: dailyLoading } = useDailyView(id);

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

      {/* View toggle tabs */}
      <div className="flex gap-2 mb-4">
        <TabButton
          label="MATCHUP"
          isActive={activeTab === 'matchup'}
          onClick={() => setActiveTab('matchup')}
        />
        <TabButton
          label="TODAY"
          isActive={activeTab === 'today'}
          onClick={() => setActiveTab('today')}
        />
      </div>

      {/* Tab content */}
      {activeTab === 'matchup' && (
        <div className="flex flex-col lg:flex-row gap-4">
          <TeamRoster team={data.home} side="home" />
          <TeamRoster team={data.away} side="away" />
        </div>
      )}

      {activeTab === 'today' && (
        dailyLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="pixel-text blink glow-teal" style={{ fontSize: '0.5rem', color: 'var(--neon-teal)' }}>
              LOADING TODAY...
            </span>
          </div>
        ) : dailyData ? (
          <DailyView data={dailyData} />
        ) : (
          <div className="flex items-center justify-center py-12">
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.2rem', color: '#555577' }}>
              No daily data available
            </span>
          </div>
        )
      )}
    </section>
  );
};

// ─── Tab Button ──────────────────────────────────────────────────────────────

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const TabButton: FC<TabButtonProps> = ({ label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className="pixel-text px-4 py-2"
    style={{
      fontSize: '0.4rem',
      color: isActive ? '#0a0a14' : 'var(--neon-teal)',
      background: isActive ? 'var(--neon-teal)' : 'transparent',
      border: `1px solid ${isActive ? 'var(--neon-teal)' : '#333355'}`,
      cursor: 'pointer',
      textShadow: isActive ? 'none' : '0 0 4px #00ffcc44',
      transition: 'all 0.15s ease',
    }}
  >
    {label}
  </button>
);

export default MatchupDetailPage;

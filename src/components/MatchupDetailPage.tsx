import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMatchupDetail } from '../hooks/useMatchupDetail.js';
import { useDailyView } from '../hooks/useDailyView.js';
import MatchupDetailHeader from './matchup/MatchupDetailHeader.js';
import TeamRoster from './matchup/TeamRoster.js';
import DailyView from './DailyView.js';
import type { FC } from 'react';
import type { MatchupDetail } from '../types/index.js';

type ViewTab = 'today' | 'matchup';

const MatchupDetailPage: FC = () => {
  const { matchupId } = useParams<{ matchupId: string }>();
  const id = parseInt(matchupId ?? '0', 10);
  const [activeTab, setActiveTab] = useState<ViewTab>('today');
  const [isScrolled, setIsScrolled] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError, error } = useMatchupDetail(id);
  const { data: dailyData, isLoading: dailyLoading } = useDailyView(id);

  // Detect when user scrolls past the full header
  useEffect(() => {
    const onScroll = () => {
      const threshold = headerRef.current
        ? headerRef.current.offsetTop + headerRef.current.offsetHeight
        : 200;
      setIsScrolled(window.scrollY > threshold);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

      {/* Full header (scrolls away) */}
      <div ref={headerRef}>
        <MatchupDetailHeader data={data} />
      </div>

      {/* Sticky compact header (slides in when scrolled past full header) */}
      <StickyCompactHeader data={data} visible={isScrolled} />

      {/* View toggle tabs */}
      <div className="flex gap-2 mb-4">
        <TabButton
          label="TODAY"
          isActive={activeTab === 'today'}
          onClick={() => setActiveTab('today')}
        />
        <TabButton
          label="MATCHUP"
          isActive={activeTab === 'matchup'}
          onClick={() => setActiveTab('matchup')}
        />
      </div>

      {/* Tab content */}
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

      {activeTab === 'matchup' && (
        <div className="flex flex-col lg:flex-row gap-4">
          <TeamRoster team={data.home} side="home" />
          <TeamRoster team={data.away} side="away" />
        </div>
      )}
    </section>
  );
};

// ─── Sticky Compact Header ──────────────────────────────────────────────────

interface StickyCompactHeaderProps {
  data: MatchupDetail;
  visible: boolean;
}

const StickyCompactHeader: FC<StickyCompactHeaderProps> = ({ data, visible }) => {
  const homeWinning = data.home.currentScore > data.away.currentScore;
  const awayWinning = data.away.currentScore > data.home.currentScore;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: '#0a0a14ee',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1a1a33',
        boxShadow: '0 2px 12px #00000066',
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.25s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
        {/* Home team */}
        <div className="flex items-center gap-2 flex-1 justify-start">
          {data.home.logoUrl && (
            <img src={data.home.logoUrl} alt="" className="w-6 h-6 object-contain" />
          )}
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: '#e0e0ff' }}>
            {data.home.abbreviation}
          </span>
          <span
            className="score-display"
            style={{
              fontSize: '1.4rem',
              color: homeWinning ? 'var(--neon-teal)' : '#aaaacc',
              textShadow: homeWinning ? '0 0 8px #00ffcc' : 'none',
            }}
          >
            {data.home.currentScore.toFixed(1)}
          </span>
        </div>

        {/* VS */}
        <span className="pixel-text" style={{ fontSize: '0.4rem', color: 'var(--neon-red)' }}>VS</span>

        {/* Away team */}
        <div className="flex items-center gap-2 flex-1 justify-end">
          <span
            className="score-display"
            style={{
              fontSize: '1.4rem',
              color: awayWinning ? 'var(--neon-teal)' : '#aaaacc',
              textShadow: awayWinning ? '0 0 8px #00ffcc' : 'none',
            }}
          >
            {data.away.currentScore.toFixed(1)}
          </span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: '#e0e0ff' }}>
            {data.away.abbreviation}
          </span>
          {data.away.logoUrl && (
            <img src={data.away.logoUrl} alt="" className="w-6 h-6 object-contain" />
          )}
        </div>
      </div>
    </div>
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

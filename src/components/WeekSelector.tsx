import { useRef, useEffect, type FC } from 'react';
import type { LeagueInfo } from '../types/index.js';

interface WeekSelectorProps {
  leagueInfo: LeagueInfo;
  selectedPeriod: number;
  onSelectPeriod: (period: number) => void;
}

const WeekSelector: FC<WeekSelectorProps> = ({ leagueInfo, selectedPeriod, onSelectPeriod }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const { regularSeasonWeeks, totalMatchupPeriods, playoffTeamCount, currentMatchupPeriod } = leagueInfo;
  const totalPlayoffRounds = Math.ceil(Math.log2(playoffTeamCount));

  // Build list of all periods with labels
  const periods: Array<{ period: number; label: string; isPlayoff: boolean }> = [];
  for (let p = 1; p <= totalMatchupPeriods; p++) {
    if (p <= regularSeasonWeeks) {
      periods.push({ period: p, label: `WK ${p}`, isPlayoff: false });
    } else {
      const playoffRound = p - regularSeasonWeeks;
      if (playoffRound >= totalPlayoffRounds) {
        periods.push({ period: p, label: 'FINALS', isPlayoff: true });
      } else {
        periods.push({ period: p, label: `RD ${playoffRound}`, isPlayoff: true });
      }
    }
  }

  // Scroll selected button into view on mount and when selection changes
  useEffect(() => {
    if (selectedRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const button = selectedRef.current;
      const containerRect = container.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const scrollLeft = button.offsetLeft - container.offsetLeft - containerRect.width / 2 + buttonRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [selectedPeriod]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const amount = direction === 'left' ? -200 : 200;
      scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  return (
    <div
      className="w-full max-w-5xl mx-auto px-2 sm:px-4 pt-3"
      style={{ background: 'var(--dark-bg)' }}
    >
      <div
        className="flex items-center gap-1"
        style={{
          background: '#0f0f22',
          border: '1px solid #1a1a2e',
          borderRadius: '2px',
          padding: '4px',
        }}
      >
        {/* Left arrow */}
        <button
          onClick={() => scroll('left')}
          className="pixel-text cursor-pointer shrink-0 px-3 py-2"
          style={{
            fontSize: '0.4rem',
            color: 'var(--neon-teal)',
            background: 'transparent',
            border: '1px solid #333355',
            lineHeight: 1,
          }}
        >
          {'<'}
        </button>

        {/* Scrollable week buttons */}
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            flex: 1,
          }}
        >
          {periods.map(({ period, label, isPlayoff }) => {
            const isSelected = period === selectedPeriod;
            const isCurrent = period === currentMatchupPeriod;

            let color = '#555577';
            let borderColor = '#1a1a2e';
            let bg = 'transparent';
            let shadow = 'none';

            if (isSelected) {
              color = isPlayoff ? 'var(--neon-yellow)' : 'var(--neon-teal)';
              borderColor = isPlayoff ? 'var(--neon-yellow)' : 'var(--neon-teal)';
              bg = isPlayoff ? '#ffe60010' : '#00ffcc0a';
              shadow = isPlayoff
                ? '0 0 8px #ffe60044, 0 0 16px #ffe60022'
                : '0 0 8px #00ffcc44, 0 0 16px #00ffcc22';
            } else if (isCurrent) {
              color = 'var(--neon-purple)';
              borderColor = '#333355';
            } else if (isPlayoff) {
              color = '#777744';
            }

            return (
              <button
                key={period}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => onSelectPeriod(period)}
                className="pixel-text cursor-pointer shrink-0 px-3 py-2 whitespace-nowrap"
                style={{
                  fontSize: '0.4rem',
                  color,
                  background: bg,
                  border: `1px solid ${borderColor}`,
                  boxShadow: shadow,
                  transition: 'all 0.15s ease',
                  lineHeight: 1,
                  minWidth: '44px',
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.color = isPlayoff ? 'var(--neon-yellow)' : 'var(--neon-teal)';
                    e.currentTarget.style.borderColor = '#333355';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.color = color;
                    e.currentTarget.style.borderColor = borderColor;
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Right arrow */}
        <button
          onClick={() => scroll('right')}
          className="pixel-text cursor-pointer shrink-0 px-3 py-2"
          style={{
            fontSize: '0.4rem',
            color: 'var(--neon-teal)',
            background: 'transparent',
            border: '1px solid #333355',
            lineHeight: 1,
          }}
        >
          {'>'}
        </button>
      </div>
    </div>
  );
};

export default WeekSelector;

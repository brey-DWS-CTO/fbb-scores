import type { FC } from 'react';
import type { DailyMatchup, DailyTeam, DailyPlayer } from '../types/index.js';

const LINEUP_SLOT_LABELS: Record<number, string> = {
  0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 11: 'UTL',
  12: 'BE', 13: 'IR', 20: 'BE', 21: 'IR', 23: 'IR+',
};

interface DailyViewProps {
  data: DailyMatchup;
}

const DailyView: FC<DailyViewProps> = ({ data }) => {
  const formattedDate = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="w-full">
      {/* Date header */}
      <div className="text-center mb-4">
        <span
          className="pixel-text glow-yellow"
          style={{ fontSize: '0.5rem', color: 'var(--neon-yellow)' }}
        >
          {formattedDate.toUpperCase()}
        </span>
      </div>

      {/* Today's score summary */}
      <div
        className="flex items-center justify-center gap-6 mb-6 p-4"
        style={{
          background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
          border: '1px solid #1a1a33',
        }}
      >
        <div className="flex flex-col items-center">
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-blue)' }}>
            {data.home.abbreviation}
          </span>
          <span
            className="score-display"
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
              color: data.home.todayScore >= data.away.todayScore ? 'var(--neon-teal)' : '#aaaacc',
              textShadow: data.home.todayScore >= data.away.todayScore ? '0 0 12px #00ffcc' : 'none',
            }}
          >
            {data.home.todayScore.toFixed(1)}
          </span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.85rem', color: '#555577' }}>
            TODAY
          </span>
        </div>

        <span className="pixel-text glow-red" style={{ fontSize: '0.6rem', color: 'var(--neon-red)' }}>
          VS
        </span>

        <div className="flex flex-col items-center">
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-orange)' }}>
            {data.away.abbreviation}
          </span>
          <span
            className="score-display"
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.5rem)',
              color: data.away.todayScore >= data.home.todayScore ? 'var(--neon-teal)' : '#aaaacc',
              textShadow: data.away.todayScore >= data.home.todayScore ? '0 0 12px #00ffcc' : 'none',
            }}
          >
            {data.away.todayScore.toFixed(1)}
          </span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.85rem', color: '#555577' }}>
            TODAY
          </span>
        </div>
      </div>

      {/* Side-by-side rosters */}
      <div className="flex flex-col lg:flex-row gap-4">
        <DailyTeamRoster team={data.home} side="home" />
        <DailyTeamRoster team={data.away} side="away" />
      </div>
    </div>
  );
};

// ─── Daily Team Roster ───────────────────────────────────────────────────────

interface DailyTeamRosterProps {
  team: DailyTeam;
  side: 'home' | 'away';
}

const DailyTeamRoster: FC<DailyTeamRosterProps> = ({ team, side }) => {
  const sideColor = side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)';

  return (
    <div className="flex-1 min-w-0">
      {/* Team header */}
      <div
        className="flex items-center gap-2 px-3 py-2 mb-2"
        style={{
          borderLeft: `3px solid ${sideColor}`,
          background: side === 'home' ? '#001a4410' : '#33001110',
        }}
      >
        <span className="pixel-text" style={{ fontSize: '0.4rem', color: sideColor }}>
          {side === 'home' ? 'HOME' : 'AWAY'}
        </span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.3rem', color: '#e0e0ff' }}>
          {team.name}
        </span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-teal)', marginLeft: 'auto' }}>
          {team.todayScore.toFixed(1)}
        </span>
      </div>

      {/* Player table */}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '420px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #222244' }}>
              <th className="text-left px-2 py-2" style={{ width: '8%' }}>
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>SLOT</span>
              </th>
              <th className="text-left px-2 py-2" style={{ width: '36%' }}>
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>PLAYER</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-teal)' }}>FPTS</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#aaaacc' }}>PTS</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#aaaacc' }}>REB</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#aaaacc' }}>AST</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#aaaacc' }}>MIN</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {team.players.map((player, i) => (
              <DailyPlayerRow key={player.playerId} player={player} isEven={i % 2 === 0} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Daily Player Row ────────────────────────────────────────────────────────

interface DailyPlayerRowProps {
  player: DailyPlayer;
  isEven: boolean;
}

const DailyPlayerRow: FC<DailyPlayerRowProps> = ({ player, isEven }) => {
  const slotLabel = LINEUP_SLOT_LABELS[player.lineupSlotId] ?? '??';
  const isBenched = !player.isStarted;

  return (
    <tr
      style={{
        borderBottom: '1px solid #1a1a2e',
        background: isEven ? '#0a0a1400' : '#0f0f2233',
        opacity: isBenched ? 0.5 : 1,
      }}
    >
      {/* Slot */}
      <td className="px-2 py-2">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '0.85rem',
            color: isBenched ? '#555577' : 'var(--neon-purple)',
          }}
        >
          {slotLabel}
        </span>
      </td>

      {/* Player info */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          {/* Started indicator */}
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: player.isStarted ? '#00ff88' : '#444466',
              boxShadow: player.isStarted ? '0 0 4px #00ff88' : 'none',
              flexShrink: 0,
            }}
          />
          {player.imageUrl && (
            <img
              src={player.imageUrl}
              alt=""
              className="w-6 h-5 object-cover"
              style={{ borderRadius: '2px', flexShrink: 0 }}
              loading="lazy"
            />
          )}
          <div className="flex flex-col min-w-0">
            <span
              style={{
                fontFamily: "'VT323', monospace",
                fontSize: '0.9rem',
                color: '#e0e0ff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {player.name}
            </span>
            <span
              style={{ fontFamily: "'VT323', monospace", fontSize: '0.7rem', color: '#555577' }}
            >
              {player.position} - {player.nbaTeamAbbrev}
            </span>
          </div>
        </div>
      </td>

      {/* FPTS */}
      <td className="text-right px-2 py-2">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1rem',
            color: player.todayFpts > 0 ? 'var(--neon-teal)' : '#555577',
            textShadow: player.todayFpts >= 30 ? '0 0 6px #00ffcc' : 'none',
          }}
        >
          {player.todayFpts.toFixed(1)}
        </span>
      </td>

      {/* PTS */}
      <td className="text-right px-2 py-2">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.9rem', color: '#aaaacc' }}>
          {player.todayStats.pts}
        </span>
      </td>

      {/* REB */}
      <td className="text-right px-2 py-2">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.9rem', color: '#aaaacc' }}>
          {player.todayStats.reb}
        </span>
      </td>

      {/* AST */}
      <td className="text-right px-2 py-2">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.9rem', color: '#aaaacc' }}>
          {player.todayStats.ast}
        </span>
      </td>

      {/* MIN */}
      <td className="text-right px-2 py-2">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.9rem', color: '#555577' }}>
          {player.todayStats.min > 0 ? Math.round(player.todayStats.min) : '-'}
        </span>
      </td>
    </tr>
  );
};

export default DailyView;

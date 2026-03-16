import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMatchupDetail } from '../hooks/useMatchupDetail.js';
import type { MatchupDetailTeam, MatchupPlayer } from '../types/index.js';
import type { FC } from 'react';

type SortKey =
  | 'fpts' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg' | 'threepm' | 'to'
  | 'last7' | 'last15' | 'last30';

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
      {/* Back button */}
      <Link
        to="/"
        className="pixel-text inline-block mb-4 px-3 py-1"
        style={{ fontSize: '0.4rem', color: 'var(--neon-teal)', border: '1px solid #333355', textDecoration: 'none' }}
      >
        &lt; BACK TO SCOREBOARD
      </Link>

      {/* Matchup header — scores */}
      <div
        className="w-full p-4 sm:p-6 mb-6"
        style={{
          background: 'linear-gradient(135deg, #0a0a1a, #0f0f22)',
          border: '2px solid var(--neon-purple)',
          boxShadow: '0 0 16px #8844ff22',
        }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col items-center gap-1 flex-1">
            {data.home.logoUrl && (
              <img src={data.home.logoUrl} alt="" className="w-12 h-12 object-contain mb-1" style={{ filter: 'drop-shadow(0 0 4px #00ffcc66)' }} />
            )}
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.4rem', color: '#e0e0ff' }}>{data.home.name}</span>
            <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>{data.home.ownerName}</span>
            <span
              className="score-display glow-teal"
              style={{
                fontSize: 'clamp(2rem, 6vw, 3rem)',
                color: data.home.currentScore > data.away.currentScore ? 'var(--neon-teal)' : '#aaaacc',
                textShadow: data.home.currentScore > data.away.currentScore ? '0 0 16px #00ffcc, 0 0 40px #00ffcc66' : 'none',
              }}
            >
              {data.home.currentScore.toFixed(1)}
            </span>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-blue)' }}>
              {data.home.gamesPlayed}/{data.home.maxGames} GP
            </span>
            {data.home.gamesPlayed > 0 && (
              <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-purple)', opacity: 0.8 }}>
                PROJ {(data.home.currentScore / data.home.gamesPlayed * data.home.maxGames).toFixed(1)}
              </span>
            )}
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="pixel-text glow-red" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.4rem)', color: 'var(--neon-red)' }}>VS</span>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: '#444466' }}>
              {Math.abs(data.home.currentScore - data.away.currentScore).toFixed(1)} PTS GAP
            </span>
            {data.isCompleted && (
              <span className="pixel-text" style={{ fontSize: '0.4rem', color: 'var(--neon-yellow)' }}>FINAL</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-1 flex-1">
            {data.away.logoUrl && (
              <img src={data.away.logoUrl} alt="" className="w-12 h-12 object-contain mb-1" style={{ filter: 'drop-shadow(0 0 4px #ff884466)' }} />
            )}
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.4rem', color: '#e0e0ff' }}>{data.away.name}</span>
            <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>{data.away.ownerName}</span>
            <span
              className="score-display"
              style={{
                fontSize: 'clamp(2rem, 6vw, 3rem)',
                color: data.away.currentScore > data.home.currentScore ? 'var(--neon-teal)' : '#aaaacc',
                textShadow: data.away.currentScore > data.home.currentScore ? '0 0 16px #00ffcc, 0 0 40px #00ffcc66' : 'none',
              }}
            >
              {data.away.currentScore.toFixed(1)}
            </span>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-blue)' }}>
              {data.away.gamesPlayed}/{data.away.maxGames} GP
            </span>
            {data.away.gamesPlayed > 0 && (
              <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-purple)', opacity: 0.8 }}>
                PROJ {(data.away.currentScore / data.away.gamesPlayed * data.away.maxGames).toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Team rosters side by side */}
      <div className="flex flex-col lg:flex-row gap-4">
        <TeamRoster team={data.home} side="home" />
        <TeamRoster team={data.away} side="away" />
      </div>
    </section>
  );
};

interface TeamRosterProps {
  team: MatchupDetailTeam;
  side: 'home' | 'away';
}

function getSortValue(player: MatchupPlayer, key: SortKey): number {
  const gp = player.stats.gp || 1;
  switch (key) {
    case 'fpts': return player.fpts;
    case 'pts': return player.stats.pts / gp;
    case 'reb': return player.stats.reb / gp;
    case 'ast': return player.stats.ast / gp;
    case 'stl': return player.stats.stl / gp;
    case 'blk': return player.stats.blk / gp;
    case 'fg': return player.stats.fga > 0 ? player.stats.fgm / player.stats.fga : 0;
    case 'threepm': return player.stats.threepm / gp;
    case 'to': return player.stats.to / gp;
    case 'last7': return player.averages.last7;
    case 'last15': return player.averages.last15;
    case 'last30': return player.averages.last30;
  }
}

const COLUMNS: Array<{ key: SortKey; label: string; color: string; isAvg?: boolean }> = [
  { key: 'fpts', label: 'FPTS', color: 'var(--neon-teal)' },
  { key: 'pts', label: 'PTS', color: '#aaaacc', isAvg: true },
  { key: 'reb', label: 'REB', color: '#aaaacc', isAvg: true },
  { key: 'ast', label: 'AST', color: '#aaaacc', isAvg: true },
  { key: 'stl', label: 'STL', color: '#aaaacc', isAvg: true },
  { key: 'blk', label: 'BLK', color: '#aaaacc', isAvg: true },
  { key: 'fg', label: 'FG%', color: '#aaaacc' },
  { key: 'threepm', label: '3PM', color: '#aaaacc', isAvg: true },
  { key: 'to', label: 'TO', color: '#aaaacc', isAvg: true },
  { key: 'last7', label: '7D', color: 'var(--neon-yellow)' },
  { key: 'last15', label: '15D', color: 'var(--neon-yellow)' },
  { key: 'last30', label: '30D', color: 'var(--neon-yellow)' },
];

const TeamRoster: FC<TeamRosterProps> = ({ team, side }) => {
  const sideColor = side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)';
  const [sortKey, setSortKey] = useState<SortKey>('fpts');
  const [sortDesc, setSortDesc] = useState(true);

  const sortedPlayers = useMemo(() => {
    const sorted = [...team.players].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      return sortDesc ? bv - av : av - bv;
    });
    return sorted;
  }, [team.players, sortKey, sortDesc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

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
        <span className="pixel-text" style={{ fontSize: '0.4rem', color: sideColor }}>{side === 'home' ? 'HOME' : 'AWAY'}</span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.3rem', color: '#e0e0ff' }}>{team.name}</span>
      </div>

      {/* Player stats table */}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '650px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #222244' }}>
              <th className="text-left px-2 py-3" style={{ width: '28%' }}>
                <span className="pixel-text" style={{ fontSize: '0.4rem', color: '#777799', letterSpacing: '0.1em' }}>PLAYER</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="text-right px-2 py-3"
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  onClick={() => handleSort(col.key)}
                >
                  <span
                    className="pixel-text"
                    style={{
                      fontSize: '0.4rem',
                      color: sortKey === col.key ? '#ffffff' : col.color,
                      textShadow: sortKey === col.key ? `0 0 8px ${col.color}` : 'none',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDesc ? ' \u25BC' : ' \u25B2') : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((player, i) => (
              <PlayerRow key={player.playerId ?? i} player={player} isEven={i % 2 === 0} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface PlayerRowProps {
  player: MatchupPlayer;
  isEven: boolean;
}

const PlayerRow: FC<PlayerRowProps> = ({ player, isEven }) => {
  const rowBg = isEven ? '#0a0a14' : '#0f0f1a';
  const benchStyle = !player.isStarter ? { opacity: 0.5 } : {};
  const gp = player.stats.gp || 1;

  return (
    <tr style={{ background: rowBg, borderBottom: '1px solid #111122', ...benchStyle }}>
      {/* Player info */}
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          {player.imageUrl && (
            <img
              src={player.imageUrl}
              alt=""
              className="w-8 h-6 object-cover rounded"
              style={{ background: '#1a1a33' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate" style={{ fontFamily: "'VT323', monospace", fontSize: '1.1rem', color: '#e0e0ff' }}>
              {player.name}
            </span>
            <span className="pixel-text" style={{ fontSize: '0.25rem', color: '#555577' }}>
              {player.position} - {player.nbaTeamAbbrev}
              {!player.isStarter && ' (BENCH)'}
            </span>
          </div>
        </div>
      </td>

      {/* FPTS — total, not per-game */}
      <td className="text-right px-2 py-2">
        <span className="glow-teal" style={{ fontFamily: "'VT323', monospace", fontSize: '1.2rem', color: 'var(--neon-teal)' }}>
          {player.fpts.toFixed(1)}
        </span>
      </td>

      {/* Per-game averages: PTS, REB, AST, STL, BLK */}
      <AvgStatCell value={player.stats.pts / gp} />
      <AvgStatCell value={player.stats.reb / gp} />
      <AvgStatCell value={player.stats.ast / gp} />
      <AvgStatCell value={player.stats.stl / gp} />
      <AvgStatCell value={player.stats.blk / gp} />

      {/* FG% */}
      <td className="text-right px-2 py-2">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: '#aaaacc' }}>
          {player.stats.fga > 0 ? (player.stats.fgm / player.stats.fga * 100).toFixed(0) + '%' : '-'}
        </span>
      </td>

      {/* 3PM per game */}
      <AvgStatCell value={player.stats.threepm / gp} />

      {/* TO per game (negative = bad) */}
      <td className="text-right px-2 py-2">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: (player.stats.to / gp) > 3 ? 'var(--neon-red)' : '#aaaacc' }}>
          {(player.stats.to / gp).toFixed(1)}
        </span>
      </td>

      {/* Rolling averages */}
      <RollingCell value={player.averages.last7} />
      <RollingCell value={player.averages.last15} />
      <RollingCell value={player.averages.last30} />
    </tr>
  );
};

const AvgStatCell: FC<{ value: number }> = ({ value }) => (
  <td className="text-right px-2 py-2">
    <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: '#aaaacc' }}>
      {value.toFixed(1)}
    </span>
  </td>
);

const RollingCell: FC<{ value: number }> = ({ value }) => (
  <td className="text-right px-2 py-2">
    <span
      style={{
        fontFamily: "'VT323', monospace",
        fontSize: '1rem',
        color: value > 0 ? 'var(--neon-yellow)' : '#555577',
        textShadow: value > 0 ? '0 0 4px #ffe60022' : 'none',
      }}
    >
      {value > 0 ? value.toFixed(1) : '-'}
    </span>
  </td>
);

export default MatchupDetailPage;

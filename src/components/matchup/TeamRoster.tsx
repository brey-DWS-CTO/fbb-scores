import { useState, useMemo } from 'react';
import type { FC } from 'react';
import type { MatchupDetailTeam, MatchupPlayer } from '../../types/index.js';
import PlayerRow from './PlayerRow.js';
import PlayerCardModal from './PlayerCardModal.js';
import EfficiencyBar from '../EfficiencyBar.js';

type SortKey =
  | 'fpts' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg' | 'threepm' | 'to'
  | 'last7' | 'last15' | 'last30';

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

interface TeamRosterProps {
  team: MatchupDetailTeam;
  side: 'home' | 'away';
}

// const TOTAL_COLUMNS = COLUMNS.length + 1; // +1 for player name column

const TeamRoster: FC<TeamRosterProps> = ({ team, side }) => {
  const sideColor = side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)';
  const [sortKey, setSortKey] = useState<SortKey>('fpts');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<MatchupPlayer | null>(null);

  const sortedPlayers = useMemo(() => {
    return [...team.players].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      return sortDesc ? bv - av : av - bv;
    });
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

      {/* Lineup efficiency */}
      <div className="px-3 mb-3">
        <EfficiencyBar efficiency={team.efficiency} label="LINEUP EFFICIENCY" />
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
              <PlayerRow
                key={player.playerId ?? i}
                player={player}
                isEven={i % 2 === 0}
                onPlayerClick={setSelectedPlayer}
              />
            ))}
          </tbody>
        </table>
      </div>

      {selectedPlayer && (
        <PlayerCardModal
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
};

export default TeamRoster;

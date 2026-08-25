import { useState, useMemo } from 'react';
import type { FC } from 'react';
import type { MatchupDetailTeam, MatchupPlayer } from '../../types/index.js';
import PlayerCardModal from './PlayerCardModal.js';
import EfficiencyBar from '../EfficiencyBar.js';

type SortKey = 'fpts' | 'fptsPerGame' | 'last7' | 'last15' | 'last30';

const COLUMNS: Array<{ key: SortKey; label: string; color: string }> = [
  { key: 'fpts', label: 'FPTS', color: 'var(--neon-teal)' },
  { key: 'fptsPerGame', label: 'FP/G', color: 'var(--neon-teal)' },
  { key: 'last7', label: 'L7', color: 'var(--neon-yellow)' },
  { key: 'last15', label: 'L15', color: 'var(--neon-yellow)' },
  { key: 'last30', label: 'L30', color: 'var(--neon-yellow)' },
];

function getSortValue(player: MatchupPlayer, key: SortKey): number {
  const gp = player.stats.gp || 1;
  switch (key) {
    case 'fpts': return player.fpts;
    case 'fptsPerGame': return player.fpts / gp;
    case 'last7': return player.averages.last7;
    case 'last15': return player.averages.last15;
    case 'last30': return player.averages.last30;
  }
}

interface TeamRosterProps {
  team: MatchupDetailTeam;
  side: 'home' | 'away';
}

const TeamRoster: FC<TeamRosterProps> = ({ team, side }) => {
  const sideColor = side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)';
  const [sortKey, setSortKey] = useState<SortKey>('fpts');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState<MatchupPlayer | null>(null);

  const starters = useMemo(
    () => team.players.filter(p => p.isStarter),
    [team.players],
  );
  const benched = useMemo(
    () => team.players.filter(p => !p.isStarter),
    [team.players],
  );

  const sortFn = (a: MatchupPlayer, b: MatchupPlayer) => {
    const av = getSortValue(a, sortKey);
    const bv = getSortValue(b, sortKey);
    return sortDesc ? bv - av : av - bv;
  };

  const sortedStarters = useMemo(() => [...starters].sort(sortFn), [starters, sortKey, sortDesc]);
  const sortedBenched = useMemo(() => [...benched].sort(sortFn), [benched, sortKey, sortDesc]);

  const starterFpts = useMemo(() => starters.reduce((s, p) => s + p.fpts, 0), [starters]);
  const benchFpts = useMemo(() => benched.reduce((s, p) => s + p.fpts, 0), [benched]);

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
        <span className="pixel-text" style={{ fontSize: '0.58rem', color: sideColor }}>{side === 'home' ? 'HOME' : 'AWAY'}</span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.3rem', color: '#e0e0ff' }}>{team.name}</span>
      </div>

      {/* Lineup efficiency */}
      <div className="px-3 mb-3">
        <EfficiencyBar efficiency={team.efficiency} label="LINEUP EFFICIENCY" />
      </div>

      {/* Started vs Benched summary */}
      <div className="flex gap-3 px-3 mb-3">
        <div className="flex-1 py-2 px-3" style={{ background: '#0f0f1a', border: '1px solid #1a1a33' }}>
          <span className="pixel-text" style={{ fontSize: '0.58rem', color: '#00ff88' }}>STARTED</span>
          <div className="flex items-baseline gap-2">
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.4rem', color: 'var(--neon-teal)' }}>
              {starterFpts.toFixed(1)}
            </span>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.8rem', color: '#555577' }}>
              FPTS
            </span>
          </div>
        </div>
        <div className="flex-1 py-2 px-3" style={{ background: '#0f0f1a', border: '1px solid #1a1a33' }}>
          <span className="pixel-text" style={{ fontSize: '0.58rem', color: '#555577' }}>BENCHED</span>
          <div className="flex items-baseline gap-2">
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.4rem', color: '#888899' }}>
              {benchFpts.toFixed(1)}
            </span>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.8rem', color: '#555577' }}>
              FPTS
            </span>
          </div>
        </div>
      </div>

      {/* Player stats table */}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #222244' }}>
              <th className="text-left px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.52rem', color: '#777799' }}>PLAYER</span>
              </th>
              <th className="text-center px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.52rem', color: '#777799' }}>GP</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="text-right px-2 py-2"
                  style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  onClick={() => handleSort(col.key)}
                >
                  <span
                    className="pixel-text"
                    style={{
                      fontSize: '0.52rem',
                      color: sortKey === col.key ? '#e0e0ff' : col.color,
                      textShadow: sortKey === col.key ? `0 0 4px ${col.color}` : 'none',
                    }}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDesc ? ' ▼' : ' ▲') : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Started section */}
            <tr>
              <td colSpan={99} className="px-2 pt-2 pb-1">
                <span className="pixel-text" style={{ fontSize: '0.58rem', color: '#00ff88' }}>
                  STARTED ({sortedStarters.length})
                </span>
              </td>
            </tr>
            {sortedStarters.map((player, i) => (
              <MatchupPlayerRow
                key={player.playerId ?? i}
                player={player}
                isEven={i % 2 === 0}
                onClick={() => setSelectedPlayer(player)}
              />
            ))}

            {/* Benched section */}
            {sortedBenched.length > 0 && (
              <>
                <tr>
                  <td colSpan={99} className="px-2 pt-3 pb-1" style={{ borderTop: '1px solid #222244' }}>
                    <span className="pixel-text" style={{ fontSize: '0.58rem', color: '#555577' }}>
                      BENCHED ({sortedBenched.length})
                    </span>
                  </td>
                </tr>
                {sortedBenched.map((player, i) => (
                  <MatchupPlayerRow
                    key={player.playerId ?? i}
                    player={player}
                    isEven={i % 2 === 0}
                    dimmed
                    onClick={() => setSelectedPlayer(player)}
                  />
                ))}
              </>
            )}
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

// ─── Matchup Player Row ─────────────────────────────────────────────────────

interface MatchupPlayerRowProps {
  player: MatchupPlayer;
  isEven: boolean;
  dimmed?: boolean;
  onClick: () => void;
}

const MatchupPlayerRow: FC<MatchupPlayerRowProps> = ({ player, isEven, dimmed, onClick }) => {
  const rowBg = isEven ? '#0a0a14' : '#0f0f1a';
  const gp = player.stats.gp || 1;
  const fptsPerGame = player.fpts / gp;

  return (
    <tr
      style={{
        background: rowBg,
        borderBottom: '1px solid #111122',
        cursor: 'pointer',
        opacity: dimmed ? 0.5 : 1,
      }}
      onClick={onClick}
    >
      {/* Player info */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          {player.imageUrl && (
            <img
              src={player.imageUrl}
              alt=""
              className="w-7 h-5 object-cover hidden sm:block"
              style={{ borderRadius: '2px', background: '#1a1a33' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div className="flex flex-col min-w-0">
            <span className="truncate" style={{ fontFamily: "'VT323', monospace", fontSize: '0.95rem', color: '#e0e0ff' }}>
              {player.name}
            </span>
            <div className="flex items-center gap-1">
              <span className="pixel-text" style={{ fontSize: '0.58rem', color: '#555577' }}>
                {player.position} - {player.nbaTeamAbbrev}
              </span>
              {player.injuryStatus === 'OUT' && (
                <span className="pixel-text" style={{ fontSize: '0.58rem', color: 'var(--neon-red)', border: '1px solid var(--neon-red)', padding: '0 2px', lineHeight: 1.4 }}>OUT</span>
              )}
              {player.injuryStatus === 'DAY_TO_DAY' && (
                <span className="pixel-text" style={{ fontSize: '0.58rem', color: 'var(--neon-yellow)', border: '1px solid var(--neon-yellow)', padding: '0 2px', lineHeight: 1.4 }}>DTD</span>
              )}
              {player.injuryStatus === 'SUSPENSION' && (
                <span className="pixel-text" style={{ fontSize: '0.58rem', color: 'var(--neon-red)', border: '1px solid var(--neon-red)', padding: '0 2px', lineHeight: 1.4 }}>SUSP</span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* GP */}
      <td className="text-center px-2 py-1.5">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.85rem', color: '#777799' }}>
          {player.stats.gp}
        </span>
      </td>

      {/* FPTS total */}
      <td className="text-right px-2 py-1.5">
        <span
          className="glow-teal"
          style={{ fontFamily: "'VT323', monospace", fontSize: '1.05rem', color: 'var(--neon-teal)' }}
        >
          {player.fpts.toFixed(1)}
        </span>
      </td>

      {/* FPTS per game */}
      <td className="text-right px-2 py-1.5">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.95rem', color: 'var(--neon-teal)', opacity: 0.7 }}>
          {fptsPerGame.toFixed(1)}
        </span>
      </td>

      {/* L7 */}
      <RollingCell value={player.averages.last7} />

      {/* L15 */}
      <RollingCell value={player.averages.last15} />

      {/* L30 */}
      <RollingCell value={player.averages.last30} />
    </tr>
  );
};

const RollingCell: FC<{ value: number }> = ({ value }) => (
  <td className="text-right px-2 py-1.5">
    <span
      style={{
        fontFamily: "'VT323', monospace",
        fontSize: '0.9rem',
        color: value > 0 ? 'var(--neon-yellow)' : '#555577',
        textShadow: value > 0 ? '0 0 4px #ffe60022' : 'none',
      }}
    >
      {value > 0 ? value.toFixed(1) : '-'}
    </span>
  </td>
);

export default TeamRoster;

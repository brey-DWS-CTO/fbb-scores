import { useState, useMemo } from 'react';
import type { FC } from 'react';
import type { ProjectionBreakdown as ProjectionBreakdownType, PlayerProjectionBreakdown, MatchupPlayer } from '../types/index.js';
import PlayerCardModal from './matchup/PlayerCardModal.js';

type SortKey = 'name' | 'team' | 'avg' | 'games' | 'proj';
type SortDir = 'asc' | 'desc';

interface ProjectionBreakdownProps {
  breakdown: ProjectionBreakdownType;
  teamName: string;
  side: 'home' | 'away';
  /** Optional player lookup map — when provided, clicking a player opens the detail modal */
  playerMap?: Map<number, MatchupPlayer>;
}

function sortPlayers(players: PlayerProjectionBreakdown[], key: SortKey, dir: SortDir): PlayerProjectionBreakdown[] {
  const sorted = [...players].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'team': cmp = a.nbaTeamAbbrev.localeCompare(b.nbaTeamAbbrev); break;
      case 'avg': cmp = a.rollingAvg15 - b.rollingAvg15; break;
      case 'games': cmp = a.projectedGames - b.projectedGames; break;
      case 'proj': cmp = a.projectedFpts - b.projectedFpts; break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

const ProjectionBreakdown: FC<ProjectionBreakdownProps> = ({ breakdown, teamName, side, playerMap }) => {
  const [selectedPlayer, setSelectedPlayer] = useState<MatchupPlayer | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('proj');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sideColor = side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)';

  const allStarters = useMemo(
    () => breakdown.players.filter((p) => p.isStarter || p.isSmartFilled),
    [breakdown.players],
  );
  const allUnused = useMemo(
    () => breakdown.players.filter((p) => !p.isStarter && !p.isSmartFilled),
    [breakdown.players],
  );

  const starters = useMemo(() => sortPlayers(allStarters, sortKey, sortDir), [allStarters, sortKey, sortDir]);
  const unused = useMemo(() => sortPlayers(allUnused, sortKey, sortDir), [allUnused, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'team' ? 'asc' : 'desc');
    }
  };

  const handlePlayerClick = (player: PlayerProjectionBreakdown) => {
    const full = playerMap?.get(player.playerId);
    if (full) setSelectedPlayer(full);
  };

  return (
    <div className="flex-1 min-w-0">
      {/* Team header */}
      <div
        className="flex items-center justify-between px-3 py-2 mb-2"
        style={{
          borderLeft: `3px solid ${sideColor}`,
          background: side === 'home' ? '#001a4410' : '#33001110',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="pixel-text" style={{ fontSize: '0.4rem', color: sideColor }}>
            {side === 'home' ? 'HOME' : 'AWAY'}
          </span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '1.3rem', color: '#e0e0ff' }}>
            {teamName}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span
            className="glow-teal"
            style={{ fontFamily: "'VT323', monospace", fontSize: '1.6rem', color: 'var(--neon-teal)' }}
          >
            {breakdown.projectedTotal.toFixed(1)}
          </span>
          <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.8rem', color: '#555577' }}>
            {breakdown.gameSlotsFilled}/{breakdown.maxGames} SLOTS
          </span>
        </div>
      </div>

      {/* Player projection table */}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #222244' }}>
              <SortHeader label="PLAYER" sortKey="name" current={sortKey} dir={sortDir} onClick={handleSort} color="#777799" align="left" />
              <SortHeader label="TEAM" sortKey="team" current={sortKey} dir={sortDir} onClick={handleSort} color="#777799" align="center" className="hidden sm:table-cell" />
              <SortHeader label="L15" sortKey="avg" current={sortKey} dir={sortDir} onClick={handleSort} color="var(--neon-yellow)" />
              <SortHeader label="GM" sortKey="games" current={sortKey} dir={sortDir} onClick={handleSort} color="var(--neon-blue)" />
              <SortHeader label="PROJ" sortKey="proj" current={sortKey} dir={sortDir} onClick={handleSort} color="var(--neon-teal)" />
            </tr>
          </thead>
          <tbody>
            {starters.map((player, i) => (
              <ProjectionPlayerRow key={player.playerId} player={player} isEven={i % 2 === 0} clickable={!!playerMap} onClick={() => handlePlayerClick(player)} />
            ))}
            {unused.length > 0 && (
              <tr>
                <td colSpan={99} className="px-2 py-2">
                  <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#444466' }}>
                    NOT PROJECTED ({unused.length})
                  </span>
                </td>
              </tr>
            )}
            {unused.map((player, i) => (
              <ProjectionPlayerRow
                key={player.playerId}
                player={player}
                isEven={i % 2 === 0}
                dimmed
                clickable={!!playerMap}
                onClick={() => handlePlayerClick(player)}
              />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #333355' }}>
              <td colSpan={3} className="px-2 py-2">
                <span
                  className="pixel-text glow-teal"
                  style={{ fontSize: '0.4rem', color: 'var(--neon-teal)' }}
                >
                  PROJECTED TOTAL
                </span>
              </td>
              <td className="text-right px-2 py-2">
                <span style={{ fontFamily: "'VT323', monospace", fontSize: '1rem', color: 'var(--neon-blue)' }}>
                  {breakdown.gameSlotsFilled}
                </span>
              </td>
              <td className="text-right px-2 py-2">
                <span
                  className="glow-teal"
                  style={{
                    fontFamily: "'VT323', monospace",
                    fontSize: '1.3rem',
                    color: 'var(--neon-teal)',
                    textShadow: '0 0 8px #00ffcc',
                  }}
                >
                  {breakdown.projectedTotal.toFixed(1)}
                </span>
              </td>
            </tr>
          </tfoot>
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

// ─── Sortable Header ────────────────────────────────────────────────────────

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  color: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

const SortHeader: FC<SortHeaderProps> = ({ label, sortKey, current, dir, onClick, color, align = 'right', className = '' }) => {
  const isActive = sortKey === current;
  const arrow = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <th
      className={`text-${align} px-2 py-2 ${className}`}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onClick(sortKey)}
    >
      <span
        className="pixel-text"
        style={{
          fontSize: '0.35rem',
          color: isActive ? '#e0e0ff' : color,
          textShadow: isActive ? `0 0 4px ${color}` : 'none',
        }}
      >
        {label}{arrow}
      </span>
    </th>
  );
};

// ─── Projection Player Row ──────────────────────────────────────────────────

interface ProjectionPlayerRowProps {
  player: PlayerProjectionBreakdown;
  isEven: boolean;
  dimmed?: boolean;
  clickable?: boolean;
  onClick?: () => void;
}

const ProjectionPlayerRow: FC<ProjectionPlayerRowProps> = ({ player, isEven, dimmed, clickable, onClick }) => {
  const rowBg = isEven ? '#0a0a1400' : '#0f0f2233';

  return (
    <tr
      onClick={clickable ? onClick : undefined}
      style={{
        borderBottom: '1px solid #1a1a2e',
        background: rowBg,
        opacity: dimmed ? 0.4 : 1,
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* Player info */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          {player.imageUrl && (
            <img
              src={player.imageUrl}
              alt=""
              className="w-6 h-5 object-cover hidden sm:block"
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
            <div className="flex items-center gap-1">
              <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.7rem', color: '#555577' }}>
                {player.position}
              </span>
              <span className="sm:hidden" style={{ fontFamily: "'VT323', monospace", fontSize: '0.7rem', color: '#444466' }}>
                {player.nbaTeamAbbrev}
              </span>
              {player.isSmartFilled && (
                <span
                  className="pixel-text"
                  style={{
                    fontSize: '0.25rem',
                    color: 'var(--neon-purple)',
                    border: '1px solid var(--neon-purple)',
                    padding: '0 3px',
                    lineHeight: 1.4,
                  }}
                >
                  BENCH
                </span>
              )}
              {player.injuryStatus === 'OUT' && (
                <span
                  className="pixel-text"
                  style={{
                    fontSize: '0.25rem',
                    color: 'var(--neon-red)',
                    border: '1px solid var(--neon-red)',
                    padding: '0 3px',
                    lineHeight: 1.4,
                  }}
                >
                  OUT
                </span>
              )}
              {player.injuryStatus === 'DAY_TO_DAY' && (
                <span
                  className="pixel-text"
                  style={{
                    fontSize: '0.25rem',
                    color: 'var(--neon-yellow)',
                    border: '1px solid var(--neon-yellow)',
                    padding: '0 3px',
                    lineHeight: 1.4,
                  }}
                >
                  DTD
                </span>
              )}
              {player.injuryStatus === 'SUSPENSION' && (
                <span
                  className="pixel-text"
                  style={{
                    fontSize: '0.25rem',
                    color: 'var(--neon-red)',
                    border: '1px solid var(--neon-red)',
                    padding: '0 3px',
                    lineHeight: 1.4,
                  }}
                >
                  SUSP
                </span>
              )}
              {player.injuryStatus === 'RETURNING' && (
                <span
                  className="pixel-text"
                  style={{
                    fontSize: '0.25rem',
                    color: 'var(--neon-teal)',
                    border: '1px solid var(--neon-teal)',
                    padding: '0 3px',
                    lineHeight: 1.4,
                  }}
                >
                  RETURNING
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* NBA Team (hidden on mobile) */}
      <td className="text-center px-2 py-1.5 hidden sm:table-cell">
        <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.85rem', color: '#777799' }}>
          {player.nbaTeamAbbrev}
        </span>
      </td>

      {/* L15 Average */}
      <td className="text-right px-2 py-1.5">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '0.95rem',
            color: player.rollingAvg15 > 0 ? 'var(--neon-yellow)' : '#555577',
          }}
        >
          {player.rollingAvg15 > 0 ? player.rollingAvg15.toFixed(1) : '-'}
        </span>
      </td>

      {/* Games: included/total */}
      <td className="text-right px-2 py-1.5">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '0.95rem',
            color: player.projectedGames > 0 ? 'var(--neon-blue)' : '#555577',
          }}
        >
          {player.projectedGames > 0 ? (
            <>
              {player.projectedGames}
              {player.excludedGames > 0 && (
                <span style={{ color: '#555577', fontSize: '0.8rem' }}>/{player.remainingGames}</span>
              )}
            </>
          ) : player.remainingGames > 0 ? (
            <span style={{ color: '#333355' }}>0/{player.remainingGames}</span>
          ) : '-'}
        </span>
      </td>

      {/* Projected FPTS */}
      <td className="text-right px-2 py-1.5">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '1rem',
            color: player.projectedFpts > 0 ? 'var(--neon-teal)' : '#555577',
            textShadow: player.projectedFpts >= 100 ? '0 0 4px #00ffcc' : 'none',
          }}
        >
          {player.projectedFpts > 0 ? player.projectedFpts.toFixed(1) : '-'}
        </span>
      </td>
    </tr>
  );
};

export default ProjectionBreakdown;

import type { FC } from 'react';
import type { ProjectionBreakdown as ProjectionBreakdownType, PlayerProjectionBreakdown } from '../types/index.js';

interface ProjectionBreakdownProps {
  breakdown: ProjectionBreakdownType;
  teamName: string;
  side: 'home' | 'away';
}

const ProjectionBreakdown: FC<ProjectionBreakdownProps> = ({ breakdown, teamName, side }) => {
  const sideColor = side === 'home' ? 'var(--neon-blue)' : 'var(--neon-orange)';
  const starters = breakdown.players.filter((p) => p.isStarter || p.isSmartFilled);
  const unused = breakdown.players.filter((p) => !p.isStarter && !p.isSmartFilled);

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
        <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '380px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #222244' }}>
              <th className="text-left px-2 py-2" style={{ width: '40%' }}>
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>PLAYER</span>
              </th>
              <th className="text-center px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>TEAM</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-yellow)' }}>L15 AVG</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-blue)' }}>GAMES</span>
              </th>
              <th className="text-right px-2 py-2">
                <span className="pixel-text" style={{ fontSize: '0.35rem', color: 'var(--neon-teal)' }}>PROJ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {starters.map((player, i) => (
              <ProjectionPlayerRow key={player.playerId} player={player} isEven={i % 2 === 0} />
            ))}
            {unused.length > 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-2">
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
    </div>
  );
};

// ─── Projection Player Row ──────────────────────────────────────────────────

interface ProjectionPlayerRowProps {
  player: PlayerProjectionBreakdown;
  isEven: boolean;
  dimmed?: boolean;
}

const ProjectionPlayerRow: FC<ProjectionPlayerRowProps> = ({ player, isEven, dimmed }) => {
  const rowBg = isEven ? '#0a0a1400' : '#0f0f2233';

  return (
    <tr
      style={{
        borderBottom: '1px solid #1a1a2e',
        background: rowBg,
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      {/* Player info */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
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
            <div className="flex items-center gap-1">
              <span style={{ fontFamily: "'VT323', monospace", fontSize: '0.7rem', color: '#555577' }}>
                {player.position}
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
                  FILL
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* NBA Team */}
      <td className="text-center px-2 py-1.5">
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

      {/* Remaining Games */}
      <td className="text-right px-2 py-1.5">
        <span
          style={{
            fontFamily: "'VT323', monospace",
            fontSize: '0.95rem',
            color: player.remainingGames > 0 ? 'var(--neon-blue)' : '#555577',
          }}
        >
          {player.remainingGames}
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

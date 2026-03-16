import type { FC } from 'react';
import type { MatchupPlayer } from '../../types/index.js';

interface PlayerRowProps {
  player: MatchupPlayer;
  isEven: boolean;
  isExpanded?: boolean;
  onToggleTrend?: () => void;
}

const PlayerRow: FC<PlayerRowProps> = ({ player, isEven, isExpanded, onToggleTrend }) => {
  const rowBg = isEven ? '#0a0a14' : '#0f0f1a';
  const benchStyle = !player.isStarter ? { opacity: 0.5 } : {};
  const gp = player.stats.gp || 1;

  return (
    <tr
      style={{
        background: isExpanded ? '#0d0d20' : rowBg,
        borderBottom: isExpanded ? 'none' : '1px solid #111122',
        cursor: 'pointer',
        ...benchStyle,
      }}
      onClick={onToggleTrend}
    >
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

      {/* TO per game */}
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

export default PlayerRow;

import { useState, useMemo, type FC } from 'react';
import type { FantasyTeam, Matchup } from '../types/index.js';

interface LeaderboardProps {
  matchups: Matchup[];
}

type SortColumn = 'pts' | 'ppg' | 'gp' | 'proj' | 'pctProj';
type SortDir = 'asc' | 'desc';

const Leaderboard: FC<LeaderboardProps> = ({ matchups }) => {
  const [sortCol, setSortCol] = useState<SortColumn>('pts');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Extract unique teams from all matchups
  const teams = useMemo(() => {
    const map = new Map<number, FantasyTeam>();
    for (const m of matchups) {
      if (!map.has(m.home.id)) map.set(m.home.id, m.home);
      if (!map.has(m.away.id)) map.set(m.away.id, m.away);
    }
    return Array.from(map.values());
  }, [matchups]);

  // Sort teams
  const sorted = useMemo(() => {
    const getSortValue = (t: FantasyTeam): number => {
      switch (sortCol) {
        case 'pts': return t.currentScore;
        case 'ppg': return t.avgPointsPerGame;
        case 'gp': return t.gamesPlayed;
        case 'proj': return t.projectedScore;
        case 'pctProj': return t.projectedScore > 0 ? (t.currentScore / t.projectedScore) * 100 : 0;
      }
    };
    return [...teams].sort((a, b) => {
      const va = getSortValue(a);
      const vb = getSortValue(b);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [teams, sortCol, sortDir]);

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const arrow = (col: SortColumn) => {
    if (sortCol !== col) return '';
    return sortDir === 'desc' ? ' ▼' : ' ▲';
  };

  const colStyle = (col: SortColumn): React.CSSProperties => ({
    color: sortCol === col ? 'var(--neon-teal)' : '#777799',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  });

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '500px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #222244' }}>
            <th className="text-center px-2 py-3" style={{ width: '40px' }}>
              <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#555577' }}>#</span>
            </th>
            <th className="text-left px-2 py-3">
              <span className="pixel-text" style={{ fontSize: '0.35rem', color: '#777799' }}>TEAM</span>
            </th>
            <th className="text-right px-2 py-3" onClick={() => handleSort('pts')}>
              <span className="pixel-text" style={{ fontSize: '0.35rem', ...colStyle('pts') }}>
                PTS{arrow('pts')}
              </span>
            </th>
            <th className="text-right px-2 py-3" onClick={() => handleSort('ppg')}>
              <span className="pixel-text" style={{ fontSize: '0.35rem', ...colStyle('ppg') }}>
                PPG{arrow('ppg')}
              </span>
            </th>
            <th className="text-right px-2 py-3" onClick={() => handleSort('gp')}>
              <span className="pixel-text" style={{ fontSize: '0.35rem', ...colStyle('gp') }}>
                GP{arrow('gp')}
              </span>
            </th>
            <th className="text-right px-2 py-3" onClick={() => handleSort('proj')}>
              <span className="pixel-text" style={{ fontSize: '0.35rem', ...colStyle('proj') }}>
                PROJ{arrow('proj')}
              </span>
            </th>
            <th className="text-right px-2 py-3 hidden sm:table-cell" onClick={() => handleSort('pctProj')}>
              <span className="pixel-text" style={{ fontSize: '0.35rem', ...colStyle('pctProj') }}>
                % PROJ{arrow('pctProj')}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((team, i) => {
            const rank = i + 1;
            const pctProj = team.projectedScore > 0
              ? ((team.currentScore / team.projectedScore) * 100).toFixed(1)
              : '-';

            // Highlight colors for top 3
            const rankColor = rank === 1
              ? 'var(--neon-yellow)'
              : rank === 2
                ? 'var(--neon-teal)'
                : rank === 3
                  ? 'var(--neon-orange)'
                  : '#555577';

            return (
              <tr
                key={team.id}
                style={{
                  borderBottom: '1px solid #1a1a2e',
                  background: i % 2 === 0 ? '#0a0a1400' : '#0f0f2233',
                }}
              >
                {/* Rank */}
                <td className="text-center px-2 py-3">
                  <span
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: '1.1rem',
                      color: rankColor,
                      textShadow: rank <= 3 ? `0 0 6px ${rankColor}` : 'none',
                    }}
                  >
                    {rank}
                  </span>
                </td>

                {/* Team name + logo */}
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {team.logoUrl ? (
                      <img
                        src={team.logoUrl}
                        alt=""
                        className="w-7 h-7 object-contain shrink-0"
                        style={{ filter: 'drop-shadow(0 0 2px #00ffcc44)' }}
                      />
                    ) : (
                      <div
                        className="w-7 h-7 flex items-center justify-center pixel-text shrink-0"
                        style={{
                          background: '#0d0d1e',
                          border: '1px solid #1a1a2e',
                          fontSize: '0.3rem',
                          color: '#555577',
                        }}
                      >
                        {team.abbreviation}
                      </div>
                    )}
                    <div className="flex flex-col min-w-0">
                      <span
                        className="truncate"
                        style={{
                          fontFamily: "'VT323', monospace",
                          fontSize: '1.1rem',
                          color: '#e0e0ff',
                          lineHeight: 1.1,
                        }}
                      >
                        {team.name}
                      </span>
                      <span
                        className="pixel-text truncate"
                        style={{ fontSize: '0.25rem', color: '#555577' }}
                      >
                        {team.ownerName}
                      </span>
                    </div>
                  </div>
                </td>

                {/* PTS */}
                <td className="text-right px-2 py-3">
                  <span
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: '1.2rem',
                      color: 'var(--neon-teal)',
                      textShadow: rank <= 3 ? '0 0 4px #00ffcc44' : 'none',
                    }}
                  >
                    {team.currentScore.toFixed(1)}
                  </span>
                </td>

                {/* PPG */}
                <td className="text-right px-2 py-3">
                  <span
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: '1.1rem',
                      color: 'var(--neon-yellow)',
                    }}
                  >
                    {team.avgPointsPerGame.toFixed(1)}
                  </span>
                </td>

                {/* GP */}
                <td className="text-right px-2 py-3">
                  <span
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: '1rem',
                      color: '#aaaacc',
                    }}
                  >
                    {team.gamesPlayed}/{team.maxGames}
                  </span>
                </td>

                {/* PROJ */}
                <td className="text-right px-2 py-3">
                  <span
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: '1.1rem',
                      color: 'var(--neon-purple)',
                    }}
                  >
                    {team.projectedScore > 0 ? team.projectedScore.toFixed(1) : '-'}
                  </span>
                </td>

                {/* % PROJ (hidden on mobile) */}
                <td className="text-right px-2 py-3 hidden sm:table-cell">
                  <span
                    style={{
                      fontFamily: "'VT323', monospace",
                      fontSize: '1rem',
                      color: Number(pctProj) >= 100 ? 'var(--neon-teal)' : Number(pctProj) >= 90 ? 'var(--neon-yellow)' : '#aaaacc',
                    }}
                  >
                    {pctProj}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default Leaderboard;

import { useState } from 'react';
import { useMatchupEnvironment } from '../../hooks/useMatchupEnvironment.js';
import { MATCHUP_POSITIONS, type MatchupPosition } from '../../lib/league/matchupProjection.js';
import { matchupTableRows } from '../../lib/league/matchupTables.js';
import { LEAGUE_SCORING, type ScoringItem } from '../../lib/league/partyScore.js';
import TeamLogo from './TeamLogo.js';
import './matchupTables.css';

/** Collapsed by default so research tables never push the weekly lineup down. */
export default function MatchupTables({ season, scoring = LEAGUE_SCORING }: { season: number; scoring?: readonly ScoringItem[] }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'pace' | 'defense'>('pace');
  const [position, setPosition] = useState<MatchupPosition>('PG');
  const [ascending, setAscending] = useState(false);
  const query = useMatchupEnvironment(season, open);
  const environment = query.data?.environment;
  const rows = environment ? matchupTableRows(environment, view, position, scoring) : [];
  const ordered = ascending ? [...rows].sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity) || a.team.localeCompare(b.team)) : rows;
  const metric = view === 'pace' ? 'Pace' : 'Pts/GP';
  const failed = query.isError || !!query.data?.error;
  return <details className="matchup-tables panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Matchup data <span>Pace / vs position</span></summary>
    {open && <div className="matchup-tables-body">
      <div className="matchup-table-controls">
        <div className="matchup-table-views" role="group" aria-label="Matchup table">
          <button type="button" aria-pressed={view === 'pace'} onClick={() => setView('pace')}>Pace</button>
          <button type="button" aria-pressed={view === 'defense'} onClick={() => setView('defense')}>Vs position</button>
        </div>
        {view === 'defense' && <label>Position <select className="hub-input" aria-label="Position" value={position} onChange={event => setPosition(event.target.value as MatchupPosition)}>
          {MATCHUP_POSITIONS.map(p => <option key={p}>{p}</option>)}
        </select></label>}
      </div>
      {query.isPending && <p role="status">Loading matchup data...</p>}
      {failed && <p role="alert">Matchup data is unavailable. <button type="button" className="tap-btn" onClick={() => void query.refetch()}>Retry</button></p>}
      {environment && !failed && <>
        <p className="matchup-table-note">{view === 'pace' ? 'Possessions per 48 minutes. Rank 1 = fastest.' : `${position}: shared-stat points allowed per game. Rank 1 = most allowed.`}</p>
        <div className="matchup-table-scroll" role="region" tabIndex={0} aria-label={`${view === 'pace' ? 'Team pace' : position + ' points allowed'} table; scroll for all teams`}>
          <table>
            <caption className="sr-only">{season - 1}-{season} season-to-date {view === 'pace' ? 'team pace' : position + ' points allowed using shared league-scored categories'}</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Team</th>{view === 'defense' && <th scope="col">GP</th>}<th scope="col" aria-sort={ascending ? 'ascending' : 'descending'}><button type="button" onClick={() => setAscending(value => !value)} aria-label={`Sort ${metric} ${ascending ? 'descending' : 'ascending'}`}>{metric} {ascending ? '\u2191' : '\u2193'}</button></th></tr></thead>
            <tbody>{ordered.map(row => <tr key={row.team}><td>{row.rank ?? '\u2014'}</td><th scope="row"><span className="matchup-team-label">{row.team}<TeamLogo code={row.team} size={16} /></span></th>{view === 'defense' && <td>{row.games}</td>}<td>{row.value?.toFixed(1) ?? '\u2014'}</td></tr>)}</tbody>
          </table>
        </div>
        {view === 'defense' && <p className="matchup-table-note">Our weights for PTS, REB, AST, 3PM, STL, BLK and TO only. Excludes shooting misses and DD/TD bonuses. These are raw allowances; the planner also adjusts for pace and sample size.</p>}
        <p className="matchup-table-note">Season to date. <a href={`https://www.fantasypros.com/daily-fantasy/nba/fanduel-defense-vs-position.php?year=${season - 1}`} target="_blank" rel="noreferrer">FantasyPros</a> / <a href={`https://www.espn.com/nba/hollinger/teamstats/_/year/${season}`} target="_blank" rel="noreferrer">ESPN pace</a>. Captured <time dateTime={environment.fetchedAt}>{new Date(environment.fetchedAt).toLocaleString()}</time>.</p>
      </>}
    </div>}
  </details>;
}

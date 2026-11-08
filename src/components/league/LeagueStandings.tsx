import { useState } from 'react';
import { useLeagueOverview } from '../../hooks/useLeagueOverview.js';
import type { TeamInfo } from '../../lib/keeper/types.js';
import type { Standing } from '../../lib/league/leagueOverview.js';

const columns = [
  { key: 'rank', label: 'Rank', ascending: true },
  { key: 'name', label: 'Team', ascending: true },
  { key: 'record', label: 'W–L–T', ascending: false },
  { key: 'pointsFor', label: 'Total pts', ascending: false },
  { key: 'pointsAgainst', label: 'Pts against', ascending: false },
  { key: 'faab', label: 'FAAB left', ascending: false },
  { key: 'waiver', label: 'Waiver', ascending: true },
] as const;

type SortKey = typeof columns[number]['key'];
const points = (n: number | null) => n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 });

function sortValue(team: Standing, key: Exclude<SortKey, 'name'>): number | null {
  if (key !== 'record') return team[key];
  if (team.wins === null || team.losses === null) return null;
  const ties = team.ties ?? 0;
  const games = team.wins + team.losses + ties;
  return games ? (team.wins + ties / 2) / games : null;
}

export default function LeagueStandings({ owners }: { owners: readonly TeamInfo[] }) {
  const { data, isPending, isError } = useLeagueOverview();
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'rank', ascending: true });
  const names = new Map(owners.map(team => [
    team.espnTeamId,
    (team.fullName.trim() || team.owner.trim()).split(/\s+/)[0],
  ]));
  const direction = sort.ascending ? 1 : -1;
  const teams = (data?.teams ?? []).toSorted((a, b) => {
    if (sort.key === 'name') return direction * a.name.localeCompare(b.name);
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return direction * (left - right);
  });

  return <section className="panel league-standings">
    <h2 className="hub-heading">STANDINGS</h2>
    {teams.length ? <div className="league-standings-scroll"><table>
      <thead><tr>{columns.map(column => {
        const selected = sort.key === column.key;
        return <th key={column.key} scope="col" aria-sort={selected ? sort.ascending ? 'ascending' : 'descending' : undefined}>
          <button type="button" className="tap-btn" onClick={() => setSort(current => ({
            key: column.key,
            ascending: current.key === column.key ? !current.ascending : column.ascending,
          }))}>
            {column.label} <span aria-hidden="true">{selected ? sort.ascending ? '↑' : '↓' : '↕'}</span>
          </button>
        </th>;
      })}</tr></thead>
      <tbody>{teams.map(team => {
        const owner = names.get(team.id);
        return <tr key={team.id}>
          <td>{team.rank ?? '—'}</td>
          <th scope="row">{team.name}{owner && <span className="league-standings-owner"> ({owner})</span>}</th>
          <td>{team.wins === null || team.losses === null ? '—' : `${team.wins}–${team.losses}–${team.ties ?? 0}`}</td>
          <td>{points(team.pointsFor)}</td>
          <td>{points(team.pointsAgainst)}</td>
          <td>{team.faab === null ? '—' : `$${team.faab}`}</td>
          <td>{team.waiver ?? '—'}</td>
        </tr>;
      })}</tbody>
    </table></div> : <p>{isPending ? 'Loading standings…' : isError ? 'Standings are unavailable right now.' : 'No standings available yet.'}</p>}
    <small>Season totals · W–L–T sorts by win percentage · — = unavailable · Waiver 1 has first priority.</small>
  </section>;
}

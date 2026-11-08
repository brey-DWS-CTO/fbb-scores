import { useLeagueOverview } from '../../hooks/useLeagueOverview.js';
const points = (n: number | null) => n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 });
export default function LeagueStandings() {
  const { data, isPending, isError } = useLeagueOverview();
  return <section className="panel league-standings"><h2 className="hub-heading">STANDINGS</h2>
    {data?.teams.length ? <div className="league-standings-scroll"><table><thead><tr>{['Rank', 'Team', 'W–L–T', 'Total pts', 'Pts against', 'FAAB left', 'Waiver'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.teams.map(team => <tr key={team.id}><td>{team.rank ?? '—'}</td><th scope="row">{team.name}</th><td>{team.wins === null || team.losses === null ? '—' : `${team.wins}–${team.losses}–${team.ties ?? 0}`}</td><td>{points(team.pointsFor)}</td><td>{points(team.pointsAgainst)}</td><td>{team.faab === null ? '—' : `$${team.faab}`}</td><td>{team.waiver ?? '—'}</td></tr>)}</tbody></table></div>
      : <p>{isPending ? 'Loading standings…' : isError ? 'Standings are unavailable right now.' : 'No standings available yet.'}</p>}
    <small>Season totals · — = unavailable · Waiver 1 has first priority.</small>
  </section>;
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLeagueOverview } from '../../hooks/useLeagueOverview.js';
import { fetchTransactions } from '../../lib/league/api.js';

const moveLabels = { add: 'Added by', drop: 'Dropped by', waiver: 'Claimed on waivers by', trade: 'Traded by' };
const moveDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default function PlayerAcquisition({ playerId }: { playerId: number }) {
  const overview = useLeagueOverview();
  const feed = useQuery({ queryKey: ['player-acquisition-transactions'], queryFn: fetchTransactions, staleTime: 300_000, retry: 1 });
  const pick = overview.data?.picks.find(row => row.playerId === playerId);
  const moves = (feed.data?.rows ?? []).filter(row => row.playerId === playerId).sort((a, b) => b.at.localeCompare(a.at));
  const draft = pick ? `Drafted R${pick.round}, Pick ${pick.pick} (${pick.overall})` : null;
  return <small className="player-acquisition">
    {draft && <Link className="player-draft-link" to={`/draft/recap?player=${playerId}`}>{draft} · View draft board</Link>}
    {moves.map(row => <span key={`${row.season}:${row.espnId}:${row.kind}`}>
      {moveLabels[row.kind]} {row.owner}
      {row.kind === 'trade' && row.toOwner && ` to ${row.toOwner}`}
      {row.bid !== null && ` · $${row.bid} FAAB`}
      {' · '}<time dateTime={row.at}>{moveDate.format(new Date(row.at))}</time>
    </span>)}
    {!draft && moves.length === 0 && <span>{overview.isPending || feed.isPending ? 'Loading history…' : 'Acquisition history unavailable'}</span>}
  </small>;
}

import { useQuery } from '@tanstack/react-query';
import { useLeagueOverview } from '../../hooks/useLeagueOverview.js';
import { fetchTransactions } from '../../lib/league/api.js';
export default function PlayerAcquisition({ playerId }: { playerId: number }) {
  const overview = useLeagueOverview();
  const feed = useQuery({ queryKey: ['player-acquisition-transactions'], queryFn: fetchTransactions, staleTime: 300_000, retry: 1 });
  const pick = overview.data?.picks.find(row => row.playerId === playerId);
  const moves = (feed.data?.rows ?? []).filter(row => row.playerId === playerId).sort((a,b) => b.at.localeCompare(a.at));
  const draft = pick ? `Drafted R${pick.round}, Pick ${pick.pick} (${pick.overall})` : null;
  const latest = moves[0];
  const moveText = latest ? `${latest.kind === 'drop' ? 'Dropped' : latest.kind === 'trade' ? 'Traded' : 'Added'}${latest.bid !== null ? ` · $${latest.bid} FAAB` : ''} · ${new Date(latest.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null;
  return <small className="player-acquisition" title={[draft, ...moves.map(row => `${row.kind} · ${row.owner}${row.bid !== null ? ` · $${row.bid} FAAB` : ''} · ${new Date(row.at).toLocaleDateString('en-US')}`)].filter(Boolean).join('\n')}>
    {draft && <span>{draft}</span>}{moveText && <span>{moveText}</span>}{!draft && !moveText && <span>{overview.isPending || feed.isPending ? 'Loading history…' : 'Acquisition history unavailable'}</span>}
  </small>;
}

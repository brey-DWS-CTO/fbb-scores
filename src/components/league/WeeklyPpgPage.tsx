import { Link, useSearchParams } from 'react-router-dom';
import { useScoresWeek } from '../../hooks/useScores.js';
import LineupFppg from './LineupFppg.js';
import IdentityChip from './IdentityChip.js';
import { ScoresNotice, WeekPicker } from './ScoresBits.js';
import { numberParam, scoresQuery } from './scoresUi.js';

export default function WeeklyPpgPage() {
  const [params, setParams] = useSearchParams();
  const demo = params.get('demo') === '1';
  const requestedWeek = numberParam(params.get('week'));
  const query = useScoresWeek(requestedWeek, demo);
  const week = query.data;
  return <div className="mock-page scores-page weekly-ppg-page">
    <div className="mock-head"><Link className="hub-heading score-back" to={`/scores${scoresQuery({ week: week?.matchupPeriodId ?? requestedWeek, demo })}`}>← SCORES</Link><IdentityChip /></div>
    <h1 className="hub-heading">WEEKLY PPG</h1>
    <WeekPicker weeks={week?.weeks ?? []} selected={week?.matchupPeriodId ?? requestedWeek} onChange={id => {
      const next = new URLSearchParams(params);
      next.set('week', String(id));
      setParams(next);
    }} />
    {demo && <div className="score-demo" role="status">Demo numbers.</div>}
    {query.isLoading && <ScoresNotice>Loading weekly PPG...</ScoresNotice>}
    {query.isError && <ScoresNotice onRetry={() => { void query.refetch(); }}>ESPN did not answer. Try again in a minute.</ScoresNotice>}
    {week && (week.matchups.length ? <LineupFppg week={week} /> : <ScoresNotice>No scores for this week yet.</ScoresNotice>)}
  </div>;
}

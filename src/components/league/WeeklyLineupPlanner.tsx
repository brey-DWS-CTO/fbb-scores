import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGamesCaps, apiErrorMessage } from '../../lib/league/api.js';
import { capForWeek } from '../../lib/league/gamesCap.js';
import { useScoresWeek, useExpectedPoints } from '../../hooks/useScores.js';
import type { LineupSnapshot } from '../../lib/league/lineup.js';
import { planWeeklyLineup } from '../../lib/league/weeklyLineup.js';
import { WeekPicker } from './ScoresBits.js';

export default function WeeklyLineupPlanner({ snapshot }: { snapshot: LineupSnapshot }) {
  const [requested, setRequested] = useState<number | null>(null);
  const query = useScoresWeek(requested, false);
  const caps = useQuery({ queryKey: ['games-caps'], queryFn: fetchGamesCaps, staleTime: 60_000 });
  const expected = useExpectedPoints();
  const week = query.data;
  const side = week?.matchups.flatMap(m => [m.home, m.away]).find(s => s.teamId === snapshot.teamId);
  const cap = week && caps.data ? capForWeek(caps.data.caps.filter(row => row.season === week.season), week.matchupPeriodId, week.gamesCap) : null;
  const plan = useMemo(() => side && week && cap !== null ? planWeeklyLineup(snapshot, side, week, cap, expected) : null, [snapshot, side, week, cap, expected]);
  return <section className="weekly-planner panel" aria-labelledby="weekly-planner-title">
    <h2 id="weekly-planner-title">{side?.name ?? 'Weekly projections'}</h2>
    <WeekPicker weeks={week?.weeks ?? []} selected={week?.matchupPeriodId ?? requested} onChange={setRequested} />
    {(query.isPending || caps.isPending) && <p role="status">Loading schedule and weekly limit…</p>}
    {(query.isError || caps.isError) && <p role="alert">{apiErrorMessage(query.error ?? caps.error)} <button className="tap-btn" onClick={() => { void query.refetch(); void caps.refetch(); }}>Retry</button></p>}
    {week && !side && <p>No matchup found for your team this week.</p>}
    {plan && week && <>
      <div className="weekly-planner-totals"><div><strong>{plan.used + plan.starts.length}<small> / {cap}</small></strong><span>Games - {plan.used} started</span></div><div><strong>{plan.projectedTotal.toFixed(1)}</strong><span>Projected points</span></div></div>
      <details className="weekly-planner-help"><summary>How projections work</summary><p>Best remaining starts within daily slots and the weekly cap, using Scores estimates. Out and reserve players are excluded. Live games use the greater of current points and the pregame estimate. Full-week points include every scheduled game; suggested points cover remaining recommended starts. Recommendations do not change your roster.</p></details>
      {plan.warnings.map(w => <p role="status" key={w}>{w}</p>)}
      <div className="weekly-planner-scroll"><table><caption className="sr-only">Weekly player projections</caption><thead><tr><th>Player</th><th title="Scheduled games">GP</th><th title="Full-week projected points">Proj</th><th title="Suggested remaining starts">Starts</th><th title="Points from suggested starts">Pts</th></tr></thead><tbody>
        {snapshot.players.map(p => {
          const chosen = plan.starts.filter(s => s.playerId === p.id);
          return <tr key={p.id}><th scope="row">{p.name}</th><td>{plan.scheduled.get(p.id) ?? '—'}</td><td>{plan.weeklyPoints.get(p.id)?.toFixed(1) ?? '—'}</td><td>{chosen.length}</td><td>{chosen.reduce((sum, s) => sum + s.points, 0).toFixed(1)}</td></tr>;
        })}
      </tbody></table></div>
      {week.days.map(day => {
        const starts = plan.starts.filter(s => s.period === day.scoringPeriodId);
        return starts.length > 0 && <details key={day.scoringPeriodId}><summary>{day.date} · {starts.length} suggested starts</summary><ul>{starts.map(s => <li key={s.playerId}>{s.slot} · {snapshot.players.find(p => p.id === s.playerId)?.name} · {s.points.toFixed(1)} pts</li>)}</ul></details>;
      })}
      <p className="my-team-footnote">GP: scheduled games - Proj: full week - Starts/Pts: remaining suggestions</p>
    </>}
  </section>;
}

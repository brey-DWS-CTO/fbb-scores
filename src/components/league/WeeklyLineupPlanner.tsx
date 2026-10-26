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
    <h2 id="weekly-planner-title">Weekly lineup planner</h2><p>Commissioner preview · Your current roster</p>
    <WeekPicker weeks={week?.weeks ?? []} selected={week?.matchupPeriodId ?? requested} onChange={setRequested} />
    {(query.isPending || caps.isPending) && <p role="status">Loading schedule and weekly limit…</p>}
    {(query.isError || caps.isError) && <p role="alert">{apiErrorMessage(query.error ?? caps.error)} <button className="tap-btn" onClick={() => { void query.refetch(); void caps.refetch(); }}>Retry</button></p>}
    {week && !side && <p>No matchup found for your team this week.</p>}
    {plan && week && <>
      <p><strong>{plan.used + plan.starts.length} / {cap} games</strong> · {plan.used} already started · <strong>{plan.projectedTotal.toFixed(1)} projected points</strong></p>
      <p>Best remaining starts within daily slots and this week’s limit. Projections use the same estimates as Scores. Out and reserve players are excluded from suggested starts. Live games use the greater of their current score and pregame estimate.</p>
      {plan.warnings.map(w => <p role="status" key={w}>{w}</p>)}
      <div className="weekly-planner-scroll"><table><caption>Weekly player projections</caption><thead><tr><th>Player</th><th>Games</th><th>Full-week proj</th><th>Suggested starts</th><th>Suggested points</th></tr></thead><tbody>
        {snapshot.players.map(p => {
          const chosen = plan.starts.filter(s => s.playerId === p.id);
          return <tr key={p.id}><th scope="row">{p.name}</th><td>{plan.scheduled.get(p.id) ?? '—'}</td><td>{plan.weeklyPoints.get(p.id)?.toFixed(1) ?? '—'}</td><td>{chosen.length}</td><td>{chosen.reduce((sum, s) => sum + s.points, 0).toFixed(1)}</td></tr>;
        })}
      </tbody></table></div>
      {week.days.map(day => {
        const starts = plan.starts.filter(s => s.period === day.scoringPeriodId);
        return starts.length > 0 && <details key={day.scoringPeriodId}><summary>{day.date} · {starts.length} suggested starts</summary><ul>{starts.map(s => <li key={s.playerId}>{s.slot} · {snapshot.players.find(p => p.id === s.playerId)?.name} · {s.points.toFixed(1)} pts</li>)}</ul></details>;
      })}
      <p>Full-week projections include all scheduled games before the cap; suggested points cover remaining recommended starts. Missing data appears as —. No lineup changes are submitted.</p>
    </>}
  </section>;
}


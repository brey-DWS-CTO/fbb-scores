import type { LineupSnapshot } from './lineup.js';
import type { ExpectedPoints, ScoresWeek, ScoreSide } from './scores.js';

export interface PlannedStart { playerId: number; period: number; slot: string; points: number }
/** Maximum-weight matching across player-days and daily slot instances, with a weekly budget. */
export function planWeeklyLineup(snapshot: LineupSnapshot, side: ScoreSide, week: ScoresWeek, cap: number, expected: ExpectedPoints, now = Date.now()) {
  const players = side.players.filter(p => snapshot.players.some(q => q.id === p.id));
  const slots = snapshot.slots.filter(s => s.kind === 'starter');
  const starts: PlannedStart[] = [];
  let used = 0;
  let fixed = 0;
  const warnings = new Set<string>();
  type Edge = { to: number; rev: number; capacity: number; cost: number };
  const graph: Edge[][] = [[], []];
  const node = () => { graph.push([]); return graph.length - 1; };
  const edge = (a: number, b: number, cost = 0) => {
    const forward = { to: b, rev: graph[b].length, capacity: 1, cost };
    graph[a].push(forward); graph[b].push({ to: a, rev: graph[a].length - 1, capacity: 0, cost: -cost });
    return forward;
  };
  const candidates: Array<{ edge: Edge; start: PlannedStart }> = [];
  const scheduled = new Map<number, number>();
  const weeklyPoints = new Map<number, number>();
  for (const day of week.days) {
    if (day.games === null) { warnings.add('Some NBA schedule data is unavailable.'); continue; }
    const occupied = new Set<string>();
    const open: Array<{ id: number; points: number }> = [];
    for (const p of side.players) {
      const game = day.games[p.proTeam];
      if (!game || game.status === 'off') continue;
      scheduled.set(p.id, (scheduled.get(p.id) ?? 0) + 1);
      const value = expected(p, day.scoringPeriodId);
      const points = Number.isFinite(value) ? Math.max(0, value) : 0;
      weeklyPoints.set(p.id, (weeklyPoints.get(p.id) ?? 0) + points);
      const record = p.days[String(day.scoringPeriodId)];
      const begun = game.status !== 'upcoming' || (game.tipoff !== null && Date.parse(game.tipoff) <= now);
      if (begun) {
        if (record?.started && (record.played || game.status !== 'final')) {
          used++;
          fixed += game.status === 'final' ? record.points : Math.max(record.points, points);
          const slot = slots.find(s => s.eligibilityId === record.lineupSlotId && !occupied.has(s.id));
          if (slot) occupied.add(slot.id);
        }
        continue;
      }
      if (!players.some(current => current.id === p.id)) continue;
      if (!game.tipoff || !Number.isFinite(Date.parse(game.tipoff))) { warnings.add('Games without a confirmed tip-off are excluded from recommendations.'); continue; }
      if (snapshot.slots.some(s => s.kind === 'reserve' && s.playerId === p.id) || ['OUT', 'SUSPENSION'].includes(p.injuryStatus ?? '')) continue;
      open.push({ id: p.id, points });
    }
    const dailySlots = slots.filter(s => !occupied.has(s.id)).map(slot => {
      const n = node(); edge(n, 1); return { slot, n };
    });
    for (const p of open) {
      if (p.points <= 0) continue;
      const eligibility = snapshot.players.find(q => q.id === p.id)!.eligibleSlotIds;
      const n = node(); edge(0, n);
      for (const { slot, n: destination } of dailySlots) {
        if (!eligibility.includes(slot.eligibilityId)) continue;
        candidates.push({ edge: edge(n, destination, -p.points), start: { playerId: p.id, period: day.scoringPeriodId, slot: slot.label, points: p.points } });
      }
    }
  }
  // Successive shortest augmenting paths include reverse edges, allowing prior assignments to move.
  for (let count = used; count < cap; count++) {
    const distance = graph.map(() => Infinity); distance[0] = 0;
    const prev: Array<[number, number] | undefined> = graph.map(() => undefined);
    for (let pass = 0; pass < graph.length - 1; pass++) {
      let changed = false;
      for (let a = 0; a < graph.length; a++) graph[a].forEach((e, i) => {
        if (e.capacity && distance[a] + e.cost < distance[e.to] - 1e-8) {
          distance[e.to] = distance[a] + e.cost; prev[e.to] = [a, i]; changed = true;
        }
      });
      if (!changed) break;
    }
    if (!prev[1] || distance[1] >= 0) break;
    let n = 1;
    while (n !== 0) { const [a, i] = prev[n]!; const e = graph[a][i]; e.capacity--; graph[n][e.rev].capacity++; n = a; }
  }
  for (const candidate of candidates) if (candidate.edge.capacity === 0) starts.push(candidate.start);
  if (used > cap) warnings.add('Already-started games exceed the weekly cap; check Scores for overage deductions.');
  if (snapshot.lockMode !== 'individual') warnings.add('This plan assumes daily changes. Check the league’s lineup lock rules before using it.');
  return { starts, used, projectedTotal: fixed + starts.reduce((sum, s) => sum + s.points, 0), scheduled, weeklyPoints, warnings: [...warnings] };
}


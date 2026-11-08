export interface Standing {
  id: number; name: string; rank: number | null;
  wins: number | null; losses: number | null; ties: number | null;
  pointsFor: number | null; pointsAgainst: number | null;
  faab: number | null; waiver: number | null;
}
export interface DraftOrigin { playerId: number; round: number; pick: number; overall: number }
export interface LeagueOverview { teams: Standing[]; picks: DraftOrigin[] }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function readLeagueOverview(raw: unknown): LeagueOverview {
  const root = obj(raw);
  const budget = num(obj(obj(root.settings).acquisitionSettings).acquisitionBudget);
  const teams = (Array.isArray(root.teams) ? root.teams : []).flatMap(value => {
    const team = obj(value), id = num(team.id);
    if (id === null) return [];
    const record = obj(obj(team.record).overall), transaction = obj(team.transactionCounter);
    const spent = num(transaction.acquisitionBudgetSpent);
    return [{ id, name: typeof team.name === 'string' ? team.name : [team.location, team.nickname].filter(v => typeof v === 'string').join(' ') || `Team ${id}`,
      rank: num(team.playoffSeed), wins: num(record.wins), losses: num(record.losses), ties: num(record.ties),
      pointsFor: num(record.pointsFor), pointsAgainst: num(record.pointsAgainst),
      faab: budget !== null && spent !== null ? budget - spent : null, waiver: num(team.waiverRank) }];
  }).sort((a,b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id - b.id);
  const draft = obj(root.draftDetail);
  const picks = (Array.isArray(draft.picks) ? draft.picks : []).flatMap(value => {
    const p = obj(value), playerId = num(p.playerId), round = num(p.roundId), pick = num(p.roundPickNumber), overall = num(p.overallPickNumber);
    return playerId !== null && round !== null && pick !== null && overall !== null ? [{ playerId, round, pick, overall }] : [];
  });
  return { teams, picks };
}

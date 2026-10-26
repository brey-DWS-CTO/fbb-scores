import { capForWeek, type GamesCapRow } from './gamesCap.js';
import type { ScoresWeek, WeekRef } from './scores.js';
export const MAX_MISSED_WEEKS = 3;
export interface MissedWeek {
  season: number; matchupPeriodId: number; label: string; endDate: string;
  espnCap: number | null; status: 'provisional' | 'final' | 'incomplete'; fetchedAt: string;
  teams: Array<{ teamId: number; name: string; played: number }>;
}
export interface MissedExemption { season: number; matchupPeriodId: number; teamId: number; reason: string; approvals: string[] }
export interface MissedGamesLedger { weeks: Record<string, MissedWeek>; calendar: WeekRef[]; exemptions: MissedExemption[] }
export const emptyMissedLedger = (): MissedGamesLedger => ({ weeks: {}, calendar: [], exemptions: [] });
export const missedWeekKey = (season: number, period: number) => `${season}:${period}`;
export function reportDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** Only complete, closed regular-season matchups may affect eligibility. */
export function readMissedWeek(week: ScoresWeek, teamIds: number[], now: Date): MissedWeek {
  const ref = week.weeks.find(w => w.matchupPeriodId === week.matchupPeriodId);
  if (!ref || ref.phase !== 'regular') throw new Error('Only regular-season matchups count.');
  const sides = week.matchups.flatMap(m => [m.home, m.away]);
  const past = ref.endDate < reportDate(now);
  let complete = week.days.length === ref.scoringPeriodIds.length && ref.scoringPeriodIds.every(id => week.days.some(d => d.scoringPeriodId === id));
  complete &&= week.days.every(d => d.games !== null && (!past || Object.values(d.games).every(g => g.status === 'final' || g.status === 'off')));
  const teams = teamIds.map(teamId => {
    const matches = sides.filter(s => s.teamId === teamId);
    const side = matches[0];
    if (matches.length !== 1 || !side || week.days.some(d => !side.players.some(p => p.days[String(d.scoringPeriodId)]))) complete = false;
    const played = side?.players.reduce((sum, p) => sum + week.days.filter(d => {
      const entry = p.days[String(d.scoringPeriodId)];
      if (!entry?.started) return false;
      return entry.stats ? entry.stats.gp >= 1 || entry.stats.min > 0 || entry.points !== 0 : entry.played;
    }).length, 0) ?? 0;
    return { teamId, name: side?.name ?? `Team ${teamId}`, played };
  });
  return { season: week.season, matchupPeriodId: week.matchupPeriodId, label: ref.label, endDate: ref.endDate, espnCap: week.gamesCap,
    status: !complete ? 'incomplete' : past ? 'final' : 'provisional', fetchedAt: week.fetchedAt, teams };
}
export function missedGamesReport(ledger: MissedGamesLedger, season: number, teams: Array<{ espnTeamId: number; owner: string }>, caps: GamesCapRow[], now: Date) {
  const calendar = ledger.calendar.filter(w => w.phase === 'regular');
  const pendingWeeks = calendar.filter(w => w.endDate < reportDate(now) && ledger.weeks[missedWeekKey(season, w.matchupPeriodId)]?.status !== 'final').map(w => w.matchupPeriodId);
  const weeks = Object.values(ledger.weeks).filter(w => w.season === season).sort((a, b) => a.matchupPeriodId - b.matchupPeriodId).map(w => ({ ...w, cap: capForWeek(caps.filter(c => c.season === season), w.matchupPeriodId, w.espnCap) }));
  const rows = teams.map(team => {
    const history = weeks.map(w => {
      const entry = w.teams.find(t => t.teamId === team.espnTeamId);
      const exemption = ledger.exemptions.find(e => e.season === season && e.matchupPeriodId === w.matchupPeriodId && e.teamId === team.espnTeamId);
      const exempt = new Set(exemption?.approvals ?? []).size >= 2;
      return { week: w.matchupPeriodId, label: w.label, status: w.status, cap: w.cap, played: entry?.played ?? null,
        missed: entry ? Math.max(0, w.cap - entry.played) : null, exempt, exemption };
    });
    const final = history.filter(w => w.status === 'final' && w.missed !== null);
    const missedWeeks = final.filter(w => w.missed! > 0).length;
    const countedWeeks = final.filter(w => w.missed! > 0 && !w.exempt).length;
    const complete = calendar.length > 0 && pendingWeeks.length === 0;
    return { teamId: team.espnTeamId, owner: team.owner, missedWeeks, countedWeeks,
      totalGamesMissed: final.reduce((sum, w) => sum + w.missed!, 0),
      playInEligible: countedWeeks > MAX_MISSED_WEEKS ? false : complete ? true : null, history };
  });
  return { season, maxMissedWeeks: MAX_MISSED_WEEKS, pendingWeeks, calendarKnown: calendar.length > 0, weeks, teams: rows };
}
export type MissedGamesReport = ReturnType<typeof missedGamesReport>;

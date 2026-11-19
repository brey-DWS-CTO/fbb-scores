import type { LeagueTransaction, EspnTransactionsResponse } from './transactions.js';
import { pacific, waiverHourFor, waiverRunAt, type DayGame } from './lmWeekend.js';

export interface AutoBenchWindow { date: string; waiverAt: string; runAt: string }
export function autoBenchSchedule(date: string, games: readonly DayGame[]): AutoBenchWindow {
  const waiverAt = waiverRunAt(date, waiverHourFor(games).hourPT);
  return { date, waiverAt, runAt: new Date(Date.parse(waiverAt) + 15 * 60_000).toISOString() };
}
export interface AutoBenchPreview {
  checkedAt: string; runAt: string; optedIn: boolean;
  rows: Array<{ playerId: number; name: string; decision: string }>;
}
/** One daily run, fifteen minutes after the same waiver time used by the LM clock. */
export function autoBenchWindow(now: Date, games: readonly DayGame[]): AutoBenchWindow | null {
  const date = pacific(now).date;
  const schedule = autoBenchSchedule(date, games);
  const due = Date.parse(schedule.runAt);
  // Allow a little cron jitter, without catching up at a later clock tick.
  return now.getTime() >= due && now.getTime() < due + 5 * 60_000
    ? schedule : null;
}

export interface AutoBenchPreference { enabled: boolean; enabledAt: string; leagueId: string; season: number; teamId: number }
export interface AutoBenchReceipt {
  owner: string; teamId: number; playerId: number; at: string;
  expected?: { scoringPeriodId: number; slots: string };
  status: 'processing' | 'benched' | 'skipped' | 'failed' | 'unknown'; note: string;
}
export interface AutoBenchState {
  dailyRuns?: Record<string, { token: string; at: string }>;
  preferences: Record<string, AutoBenchPreference>;
  receipts: Record<string, AutoBenchReceipt>;
  locks: Record<string, string>;
}
export const emptyAutoBenchState = (): AutoBenchState => ({ preferences: {}, receipts: {}, locks: {} });
export const pickupKey = (row: LeagueTransaction): string => `${row.season}:${row.espnId}:${row.teamId}:${row.playerId}`;

/** Only new completed pickups after explicit consent. No delayed catch-up into later lineup choices. */
export function autoBenchCandidates(rows: readonly LeagueTransaction[], preferences: AutoBenchState['preferences'], leagueId: string, season: number, period: number, now: Date): LeagueTransaction[] {
  const latest = new Map<string, LeagueTransaction>();
  for (const row of rows) {
    const key = `${row.teamId}:${row.playerId}`;
    if (!latest.has(key) || row.at > latest.get(key)!.at) latest.set(key, row);
  }
  return [...latest.values()].filter(row => {
    const pref = preferences[row.owner];
    const age = now.getTime() - Date.parse(row.at);
    return !row.byLeagueManager && (row.kind === 'waiver' || row.kind === 'add') && row.season === season
      && row.scoringPeriodId === period && pref?.enabled === true && pref.teamId === row.teamId
      && pref.leagueId === leagueId && pref.season === season && row.at > pref.enabledAt
      && Number.isFinite(age) && age >= 0 && age <= 45 * 60_000;
  });
}

/** Respect any explicit lineup move made after the pickup, including starting it intentionally. */
export function lineupChangedAfter(raw: EspnTransactionsResponse, pickup: LeagueTransaction): boolean {
  return (raw.transactions ?? []).some(tx => tx.status === 'EXECUTED' && tx.teamId === pickup.teamId
    && ['ROSTER', 'FUTURE_ROSTER', 'LINEUP'].includes(tx.type ?? '')
    && Number.isFinite(tx.processDate) && tx.processDate! >= Date.parse(pickup.at)
    && (tx.items ?? []).some(item => item.type === 'LINEUP' && item.playerId === pickup.playerId));
}

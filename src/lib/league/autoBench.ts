import type { LeagueTransaction, EspnTransactionsResponse } from './transactions.js';

export interface AutoBenchPreference { enabled: boolean; enabledAt: string; leagueId: string; season: number; teamId: number }
export interface AutoBenchReceipt {
  owner: string; teamId: number; playerId: number; at: string;
  expected?: { scoringPeriodId: number; slots: string };
  status: 'processing' | 'benched' | 'skipped' | 'failed' | 'unknown'; note: string;
}
export interface AutoBenchState {
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
    return (row.kind === 'waiver' || row.kind === 'add') && row.season === season
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

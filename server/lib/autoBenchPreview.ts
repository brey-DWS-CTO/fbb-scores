import { autoBenchCandidates, autoBenchSchedule, autoBenchWindow, lineupChangedAfter, type AutoBenchPreview, type AutoBenchState } from '../../src/lib/league/autoBench.js';
import { normalizeTransactions, type EspnTransactionsResponse } from '../../src/lib/league/transactions.js';
import { firstTip, pacific, type DayGame } from '../../src/lib/league/lmWeekend.js';
import type { EspnLeagueResponse } from '../../src/types/index.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import { CONFIG_TEAMS, getState } from './leagueStore.js';
import { espnLmConfig, type EspnLmConfig } from './espnLm.js';
import { gamesOn } from './nbaDay.js';

/** Pure, read-only evaluation. It neither claims a daily batch nor calls the write transport. */
export function buildAutoBenchPreview(owner: string, config: EspnLmConfig, state: AutoBenchState | undefined,
  roster: EspnLeagueResponse, transactions: EspnTransactionsResponse, games: readonly DayGame[], now: Date): AutoBenchPreview {
  const team = CONFIG_TEAMS.find(team => team.owner === owner);
  if (!team || String(roster.id) !== config.leagueId || roster.seasonId !== config.seasonId) throw new Error('ESPN team configuration does not match.');
  const schedule = autoBenchSchedule(pacific(now).date, games);
  const preference = state?.preferences[owner];
  const optedIn = preference?.enabled === true && preference.leagueId === config.leagueId && preference.teamId === team.espnTeamId && preference.season === config.seasonId;
  const entries = roster.teams.find(entry => entry.id === team.espnTeamId)?.roster?.entries;
  if (!entries) throw new Error('ESPN did not return your roster.');
  const names = new Map(entries.map(entry => [entry.playerPoolEntry.id, { name: entry.playerPoolEntry.player?.fullName ?? `Player ${entry.playerPoolEntry.id}`, proTeam: '' }]));
  const moves = normalizeTransactions(transactions, { season: config.seasonId, teams: CONFIG_TEAMS, players: names });
  const pickups = moves.filter(row => row.owner === owner && ['waiver', 'add'].includes(row.kind) && row.at >= schedule.waiverAt);
  const eligible = new Set(autoBenchCandidates(moves, state?.preferences ?? {}, config.leagueId, config.seasonId, roster.scoringPeriodId, now).map(row => row.espnId + ':' + row.playerId));
  const settings = roster.settings.rosterSettings as typeof roster.settings.rosterSettings & { lineupSlotCounts?: Record<string, number>; isBenchUnlimited?: boolean };
  const capacity = settings.lineupSlotCounts?.['12'];
  let room = settings.isBenchUnlimited === true ? Infinity : Number.isSafeInteger(capacity) ? Math.max(0, capacity! - entries.filter(entry => entry.lineupSlotId === 12).length) : 0;
  const tip = firstTip(games);
  const dailyKey = `${config.leagueId}:${config.seasonId}:${schedule.date}:${owner}`;
  const seen = new Set<number>();
  const rows: AutoBenchPreview['rows'] = [];
  for (const pickup of pickups) {
    if (seen.has(pickup.playerId)) continue;
    seen.add(pickup.playerId);
    const entry = entries.find(entry => entry.playerPoolEntry.id === pickup.playerId);
    let decision: string;
    if (pickup.byLeagueManager) decision = 'Skipped: LM add';
    else if (!optedIn) decision = 'Skipped: auto-benching is off';
    else if (!entry || entry.lineupSlotId < 0 || entry.lineupSlotId > 11) decision = 'Skipped: not in your starting lineup';
    else if (state?.dailyRuns?.[dailyKey]) decision = 'Skipped: your daily batch already ran';
    else if (!eligible.has(pickup.espnId + ':' + pickup.playerId)) decision = 'Skipped: outside the eligible pickup window';
    else if (lineupChangedAfter(transactions, pickup)) decision = 'Skipped: you changed this player’s lineup';
    else if (!autoBenchWindow(now, games)) decision = 'Skipped: outside today’s scheduled run window';
    else if (tip && now.getTime() >= Date.parse(tip) - 10 * 60_000) decision = 'Skipped: too close to tip-off';
    else if (state?.locks[`${config.leagueId}:${team.espnTeamId}`]) decision = 'Skipped: a prior move needs verification';
    else if (room <= 0) decision = 'Skipped: no confirmed bench space';
    else { decision = 'Would bench'; room--; }
    rows.push({ playerId: pickup.playerId, name: names.get(pickup.playerId)?.name ?? pickup.playerName, decision });
  }
  return { checkedAt: now.toISOString(), runAt: schedule.runAt, optedIn, rows };
}

export async function previewAutoBench(owner: string, now = new Date()): Promise<AutoBenchPreview> {
  const config = espnLmConfig();
  if (!config) throw new Error('ESPN is unavailable.');
  const client = new EspnClient({ leagueId: config.leagueId, seasonId: config.seasonId, cookieOverride: config.cookie });
  const saved = await getState();
  const team = CONFIG_TEAMS.find(team => team.owner === owner);
  const pref = saved.state.autoBench?.preferences[owner];
  if (!pref?.enabled || pref.leagueId !== config.leagueId || pref.season !== config.seasonId || pref.teamId !== team?.espnTeamId) throw new Error('Enable auto-benching first.');
  const [roster, transactions, games] = await Promise.all([client.fetchScoreboard(), client.fetchTransactions(), gamesOn(pacific(now).date)]);
  return buildAutoBenchPreview(owner, config, saved.state.autoBench, roster, transactions, games, now);
}

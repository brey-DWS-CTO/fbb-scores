import { randomUUID } from 'node:crypto';
import { autoBenchCandidates, emptyAutoBenchState, lineupChangedAfter, pickupKey, type AutoBenchReceipt, type AutoBenchState } from '../../src/lib/league/autoBench.js';
import { normalizeTransactions, type EspnTransactionsResponse } from '../../src/lib/league/transactions.js';
import type { EspnLeagueResponse } from '../../src/types/index.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import { CONFIG_TEAMS, getState, mutateState, appendAudit } from './leagueStore.js';
import { espnLmConfig, lmBench, type EspnLmConfig, type EspnWriteResult } from './espnLm.js';
import { gamesOn } from './nbaDay.js';
import { pacific } from '../../src/lib/league/lmWeekend.js';

export interface AutoBenchDependencies {
  clock?: () => Date;
  readState(): Promise<{ autoBench?: AutoBenchState; lineupManagement?: { rosterLocks: Record<string, string> } }>;
  mutate(fn: (state: AutoBenchState) => void): Promise<void>;
  roster(): Promise<EspnLeagueResponse>;
  transactions(): Promise<EspnTransactionsResponse>;
  firstTip(): Promise<string | null>;
  bench(input: { teamId: number; playerId: number; scoringPeriodId: number; fromLineupSlotId: number }): Promise<EspnWriteResult>;
  audit(receipt: AutoBenchReceipt): Promise<void>;
}
const content = (raw: EspnLeagueResponse, teamId: number): string => JSON.stringify((raw.teams.find(t => t.id === teamId)?.roster?.entries ?? [])
  .map(e => [e.playerPoolEntry.id, e.lineupSlotId]).sort((a, b) => a[0] - b[0]));
function checkRoster(raw: EspnLeagueResponse, config: EspnLmConfig): void {
  if (String(raw.id) !== config.leagueId || raw.seasonId !== config.seasonId || !Number.isSafeInteger(raw.scoringPeriodId)) throw new Error('ESPN roster binding mismatch.');
}

/** The existing LM clock calls this after its waiver settings and adds have run. */
export async function executeAutoBench(config: EspnLmConfig, now: Date, deps: AutoBenchDependencies): Promise<AutoBenchReceipt[]> {
  const initial = await deps.readState();
  if (!Object.values(initial.autoBench?.preferences ?? {}).some(pref => pref.enabled && pref.leagueId === config.leagueId && pref.season === config.seasonId)) return [];
  // Avoid LM privileges bypassing ordinary lineup locks. Unknown schedule means no writes.
  const tip = await deps.firstTip();
  if (tip !== null && (!Number.isFinite(Date.parse(tip)) || now.getTime() >= Date.parse(tip) - 10 * 60_000)) return [];
  const raw = await deps.transactions();
  const roster = await deps.roster();
  checkRoster(roster, config);
  // Reconcile uncertain writes by reading only. Never send the same pickup again.
  for (const [key, receipt] of Object.entries(initial.autoBench?.receipts ?? {})) {
    if (!['processing', 'unknown'].includes(receipt.status) || now.getTime() - Date.parse(receipt.at) < 120_000) continue;
    if (!receipt.expected) {
      await deps.mutate(state => {
        const current = state.receipts[key];
        if (current?.status !== 'processing' || current.expected) return;
        current.status = 'skipped'; current.note = 'Interrupted before submission; pickup was not retried.';
        if (state.locks[`${config.leagueId}:${receipt.teamId}`] === key) delete state.locks[`${config.leagueId}:${receipt.teamId}`];
      });
      continue;
    }
    if (roster.scoringPeriodId === receipt.expected.scoringPeriodId && content(roster, receipt.teamId) === receipt.expected.slots) {
      await deps.mutate(state => {
        const current = state.receipts[key];
        if (!current || !['processing', 'unknown'].includes(current.status)) return;
        current.status = 'benched'; current.note = 'ESPN confirmed the pickup is on the bench.';
        if (state.locks[`${config.leagueId}:${receipt.teamId}`] === key) delete state.locks[`${config.leagueId}:${receipt.teamId}`];
      });
    }
  }
  const rows = normalizeTransactions(raw, { season: config.seasonId, teams: CONFIG_TEAMS, players: new Map() });
  const candidates = autoBenchCandidates(rows, initial.autoBench?.preferences ?? {}, config.leagueId, config.seasonId, roster.scoringPeriodId, now);
  const results: AutoBenchReceipt[] = [];
  for (const row of candidates) {
    const key = pickupKey(row);
    const teamKey = `${config.leagueId}:${row.teamId}`;
    const token = randomUUID();
    // Durable claim before touching ESPN. Callback may be retried by optimistic storage.
    await deps.mutate(state => {
      if (state.receipts[key] || state.locks[teamKey]) return;
      if (!autoBenchCandidates([row], state.preferences, config.leagueId, config.seasonId, roster.scoringPeriodId, now).length) return;
      state.receipts[key] = { owner: row.owner, teamId: row.teamId, playerId: row.playerId, at: now.toISOString(), status: 'processing', note: token };
      state.locks[teamKey] = key;
    });
    const claimed = (await deps.readState()).autoBench?.receipts[key];
    if (claimed?.note !== token) continue;
    let submitted = false;
    let receipt: AutoBenchReceipt = { ...claimed };
    try {
      const state = await deps.readState();
      if (state.lineupManagement?.rosterLocks[teamKey]) throw new Error('Another lineup operation needs verification.');
      const freshRaw = await deps.transactions();
      const freshRows = normalizeTransactions(freshRaw, { season: config.seasonId, teams: CONFIG_TEAMS, players: new Map() });
      if (!autoBenchCandidates(freshRows, state.autoBench?.preferences ?? {}, config.leagueId, config.seasonId, roster.scoringPeriodId, now).some(candidate => pickupKey(candidate) === key)) throw new Error('The pickup changed after it was selected.');
      if (lineupChangedAfter(freshRaw, row)) throw new Error('A later lineup choice was preserved.');
      const before = await deps.roster();
      checkRoster(before, config);
      if (before.scoringPeriodId !== roster.scoringPeriodId) throw new Error('The scoring day changed.');
      const team = before.teams.find(team => team.id === row.teamId);
      const entries = team?.roster?.entries;
      const entry = entries?.find(entry => entry.playerPoolEntry.id === row.playerId);
      if (!entry || entry.lineupSlotId < 0 || entry.lineupSlotId > 11) throw new Error('Pickup is already benched or no longer in an active slot.');
      const settings = before.settings.rosterSettings as typeof before.settings.rosterSettings & { lineupSlotCounts?: Record<string, number>; isBenchUnlimited?: boolean };
      const capacity = settings.lineupSlotCounts?.['12'];
      if (settings.isBenchUnlimited !== true && (!Number.isSafeInteger(capacity) || entries!.filter(entry => entry.lineupSlotId === 12).length >= capacity!)) throw new Error('No confirmed open bench spot.');
      const current = await deps.readState();
      if (!autoBenchCandidates([row], current.autoBench?.preferences ?? {}, config.leagueId, config.seasonId, before.scoringPeriodId, now).length) throw new Error('Auto-benching was turned off.');
      // Do not execute a read that ran across the cutoff.
      const clock = (deps.clock?.() ?? new Date()).getTime();
      if (tip && clock >= Date.parse(tip) - 10 * 60_000) throw new Error('The lineup safety cutoff has passed.');
      const expected = structuredClone(before);
      expected.teams.find(team => team.id === row.teamId)!.roster!.entries.find(entry => entry.playerPoolEntry.id === row.playerId)!.lineupSlotId = 12;
      receipt.expected = { scoringPeriodId: before.scoringPeriodId, slots: content(expected, row.teamId) };
      // Save verification evidence before sending, so a timeout or crashed process can be reconciled.
      await deps.mutate(state => {
        if (state.receipts[key]?.note !== token || state.locks[teamKey] !== key) throw new Error('Pickup claim changed.');
        if (!autoBenchCandidates([row], state.preferences, config.leagueId, config.seasonId, before.scoringPeriodId, deps.clock?.() ?? new Date()).length) throw new Error('Auto-benching is off or the pickup expired.');
        state.receipts[key].expected = receipt.expected;
      });
      submitted = true;
      const result = await deps.bench({ teamId: row.teamId, playerId: row.playerId, scoringPeriodId: before.scoringPeriodId, fromLineupSlotId: entry.lineupSlotId });
      if (result.dryRun) {
        // Dry runs never consume a pickup or leave a roster locked.
        await deps.mutate(state => { delete state.receipts[key]; delete state.locks[teamKey]; });
        continue;
      }
      if (!result.ok) { receipt = { ...receipt, status: 'unknown', note: 'ESPN did not confirm the request. Check the roster; this pickup will not be retried.' }; }
      else {
        const after = await deps.roster();
        checkRoster(after, config);
        const verified = after.scoringPeriodId === before.scoringPeriodId && content(after, row.teamId) === content(expected, row.teamId);
        receipt = { ...receipt, status: verified ? 'benched' : 'unknown', note: verified ? 'ESPN confirmed the pickup is on the bench.' : 'ESPN lineup differs from the expected result. Check the roster; further automation is blocked.' };
      }
    } catch (error) {
      receipt = { ...receipt, status: submitted ? 'unknown' : 'skipped', note: submitted ? 'Could not verify ESPN. Check the roster; this pickup will not be retried.' : error instanceof Error ? error.message : 'Pickup was not moved.' };
    }
    await deps.mutate(state => {
      state.receipts[key] = receipt;
      if (receipt.status !== 'unknown') delete state.locks[teamKey];
    });
    await deps.audit(receipt);
    results.push(receipt);
  }
  return results;
}

export async function runAutoBench(now = new Date()): Promise<AutoBenchReceipt[]> {
  const config = espnLmConfig();
  if (!config) return [];
  const client = new EspnClient({ leagueId: config.leagueId, seasonId: config.seasonId, cookieOverride: config.cookie });
  return executeAutoBench(config, now, {
    async readState() { return (await getState()).state; },
    async mutate(fn) { await mutateState(state => { state.autoBench ??= emptyAutoBenchState(); fn(state.autoBench); }); },
    roster: () => client.fetchScoreboard(), transactions: () => client.fetchTransactions(),
    async firstTip() { return (await gamesOn(pacific(now).date))[0]?.tipoff ?? null; },
    bench: input => lmBench(config, input),
    async audit(receipt) { await appendAudit(receipt.owner, 'lineup.autoBench', receipt); },
  });
}

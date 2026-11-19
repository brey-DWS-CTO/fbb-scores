import assert from 'node:assert/strict';
import test from 'node:test';
import { executeAutoBench, type AutoBenchDependencies } from '../server/lib/autoBenchService.js';
import { CONFIG_TEAMS } from '../server/lib/leagueStore.js';
import { autoBenchCandidates, autoBenchWindow, emptyAutoBenchState, type AutoBenchState } from '../src/lib/league/autoBench.js';
import { normalizeTransactions, type EspnTransactionsResponse } from '../src/lib/league/transactions.js';
import type { EspnLeagueResponse } from '../src/types/index.js';

const now = new Date('2026-11-18T20:15:00Z');
const team = CONFIG_TEAMS[0];
const config = { leagueId: '123', seasonId: 2027, cookie: 'fixture', dryRun: false };
function fixture() {
  const state: { autoBench: AutoBenchState; lineupManagement?: { rosterLocks: Record<string, string> } } = { autoBench: emptyAutoBenchState() };
  state.autoBench.preferences[team.owner] = { enabled: true, enabledAt: '2026-11-18T19:00:00Z', leagueId: '123', season: 2027, teamId: team.espnTeamId };
  const raw: EspnTransactionsResponse = { transactions: [{ id: 'pickup', type: 'WAIVER', status: 'EXECUTED', teamId: team.espnTeamId, processDate: Date.parse('2026-11-18T20:05:00Z'), scoringPeriodId: 30, items: [{ type: 'ADD', playerId: 99, toTeamId: team.espnTeamId }] }] };
  const roster = { id: 123, seasonId: 2027, scoringPeriodId: 30, settings: { rosterSettings: { lineupSlotCounts: { '12': 3 }, isBenchUnlimited: false } }, teams: [{ id: team.espnTeamId, roster: { entries: [{ lineupSlotId: 0, playerPoolEntry: { id: 99 } }, { lineupSlotId: 4, playerPoolEntry: { id: 100 } }] } }] } as unknown as EspnLeagueResponse;
  let writes = 0;
  let reads = 0;
  const deps: AutoBenchDependencies = {
    dailyWindow: { date: '2026-11-18', waiverAt: '2026-11-18T20:00:00Z', runAt: now.toISOString() },
    clock: () => now,
    async readState() { return structuredClone(state); },
    async mutate(fn) { fn(state.autoBench); },
    async roster() { reads++; return structuredClone(roster); },
    async transactions() { return structuredClone(raw); },
    async firstTip() { return '2026-11-19T00:00:00Z'; },
    async bench(input) { writes++; assert.equal(input.fromLineupSlotId, 0); roster.teams[0].roster!.entries[0].lineupSlotId = 12; return { ok: true, dryRun: false, status: 200, body: '', authFailed: false }; },
    async audit() {},
  };
  return { state, raw, roster, deps, writes: () => writes, reads: () => reads };
}

test('nobody is opted in by default; no ESPN reads or writes', async () => {
  const f = fixture(); f.state.autoBench = emptyAutoBenchState();
  assert.deepEqual(await executeAutoBench(config, now, f.deps), []);
  assert.equal(f.writes(), 0); assert.equal(f.reads(), 0);
});
test('completed pickup is benched once, verified, and never re-benched after a later manual start', async () => {
  const f = fixture();
  assert.equal((await executeAutoBench(config, now, f.deps))[0].status, 'benched');
  assert.equal(f.roster.teams[0].roster!.entries[1].lineupSlotId, 4);
  f.roster.teams[0].roster!.entries[0].lineupSlotId = 0;
  await executeAutoBench(config, now, f.deps);
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.state.autoBench.locks, {});
});
test('duplicate concurrent cron requests make one write', async () => {
  const f = fixture();
  await Promise.all([executeAutoBench(config, now, f.deps), executeAutoBench(config, now, f.deps)]);
  assert.equal(f.writes(), 1);
});
test('consent, league, team, season, current day, freshness, and executed status are required', () => {
  const f = fixture();
  const rows = normalizeTransactions(f.raw, { season: 2027, teams: CONFIG_TEAMS, players: new Map() });
  const candidates = () => autoBenchCandidates(rows, f.state.autoBench.preferences, '123', 2027, 30, now);
  assert.equal(candidates().length, 1);
  for (const patch of [{ enabled: false }, { enabledAt: now.toISOString() }, { leagueId: 'wrong' }, { season: 2026 }, { teamId: -1 }]) {
    const old = { ...f.state.autoBench.preferences[team.owner] };
    Object.assign(f.state.autoBench.preferences[team.owner], patch); assert.equal(candidates().length, 0);
    f.state.autoBench.preferences[team.owner] = old;
  }
  assert.equal(autoBenchCandidates(rows, f.state.autoBench.preferences, '123', 2027, 31, now).length, 0);
  assert.equal(autoBenchCandidates(rows, f.state.autoBench.preferences, '123', 2027, 30, new Date('2026-11-18T22:00:00Z')).length, 0);
  f.raw.transactions![0].status = 'PENDING';
  assert.equal(normalizeTransactions(f.raw, { season: 2027, teams: CONFIG_TEAMS, players: new Map() }).length, 0);
});
test('a full bench, a nonstarter, and a dropped player are never moved', async () => {
  for (const slot of [12, 13, 99]) {
    const f = fixture(); f.roster.teams[0].roster!.entries[0].lineupSlotId = slot;
    await executeAutoBench(config, now, f.deps); assert.equal(f.writes(), 0);
  }
  const f = fixture();
  (f.roster.settings.rosterSettings as unknown as { lineupSlotCounts: Record<string, number> }).lineupSlotCounts['12'] = 0;
  assert.equal((await executeAutoBench(config, now, f.deps))[0].status, 'skipped'); assert.equal(f.writes(), 0);
  const dropped = fixture(); dropped.roster.teams[0].roster!.entries.shift();
  await executeAutoBench(config, now, dropped.deps); assert.equal(dropped.writes(), 0);
});
test('a later explicit lineup choice is preserved', async () => {
  const f = fixture(); f.raw.transactions!.push({ id: 'manual', type: 'ROSTER', status: 'EXECUTED', teamId: team.espnTeamId, processDate: now.getTime(), items: [{ type: 'LINEUP', playerId: 99 }] });
  assert.equal((await executeAutoBench(config, now, f.deps))[0].status, 'skipped'); assert.equal(f.writes(), 0);
});
test('cutoff and unknown schedules prevent writes', async () => {
  const f = fixture(); f.deps.firstTip = async () => '2026-11-18T20:20:00Z';
  assert.deepEqual(await executeAutoBench(config, now, f.deps), []); assert.equal(f.writes(), 0);
  f.deps.firstTip = async () => { throw new Error('offline'); };
  await assert.rejects(executeAutoBench(config, now, f.deps)); assert.equal(f.writes(), 0);
});
test('opt-out during the roster read and existing lineup locks prevent writes', async () => {
  const f = fixture(); const read = f.deps.roster;
  f.deps.roster = async () => { f.state.autoBench.preferences[team.owner].enabled = false; return read(); };
  await executeAutoBench(config, now, f.deps); assert.equal(f.writes(), 0);
  const locked = fixture(); locked.state.lineupManagement = { rosterLocks: { [`123:${team.espnTeamId}`]: 'pending-operation' } };
  await executeAutoBench(config, now, locked.deps); assert.equal(locked.writes(), 0);
});
test('ambiguous ESPN response never retries and blocks additional writes', async () => {
  const f = fixture(); let attempts = 0;
  f.deps.bench = async () => { attempts++; throw new Error('lost response'); };
  assert.equal((await executeAutoBench(config, now, f.deps))[0].status, 'unknown');
  await executeAutoBench(config, now, f.deps); assert.equal(attempts, 1);
  assert.equal(Object.keys(f.state.autoBench.locks).length, 1);
});
test('read-back must confirm the entire roster; unrelated changes produce unknown', async () => {
  const f = fixture(); const bench = f.deps.bench;
  f.deps.bench = async input => { const result = await bench(input); f.roster.teams[0].roster!.entries[1].lineupSlotId = 12; return result; };
  assert.equal((await executeAutoBench(config, now, f.deps))[0].status, 'unknown');
});
test('dry run does not consume a pickup or retain a roster lock', async () => {
  const f = fixture(); f.deps.bench = async () => ({ ok: true, dryRun: true, status: null, body: '', authFailed: false });
  await executeAutoBench({ ...config, dryRun: true }, now, f.deps);
  assert.deepEqual(f.state.autoBench.receipts, {}); assert.deepEqual(f.state.autoBench.locks, {});
  assert.equal(Object.keys(f.state.autoBench.dailyRuns ?? {}).length, 0);
});

test('an uncertain successful write is reconciled with a read, never resubmitted', async () => {
  const f = fixture(); const bench = f.deps.bench;
  f.deps.bench = async input => { await bench(input); throw new Error('response lost'); };
  assert.equal((await executeAutoBench(config, now, f.deps))[0].status, 'unknown');
  const later = new Date(now.getTime() + 3 * 60_000);
  await executeAutoBench(config, later, f.deps);
  assert.equal(f.writes(), 1);
  assert.equal(Object.values(f.state.autoBench.receipts)[0].status, 'benched');
  assert.deepEqual(f.state.autoBench.locks, {});
});

test('a crashed pre-submission claim is released without retrying the pickup', async () => {
  const f = fixture();
  const key = `2027:pickup:${team.espnTeamId}:99`;
  f.state.autoBench.receipts[key] = { owner: team.owner, teamId: team.espnTeamId, playerId: 99, at: '2026-11-18T20:10:00Z', status: 'processing', note: 'old-token' };
  f.state.autoBench.locks[`123:${team.espnTeamId}`] = key;
  await executeAutoBench(config, now, f.deps);
  assert.equal(f.state.autoBench.receipts[key].status, 'skipped');
  assert.deepEqual(f.state.autoBench.locks, {}); assert.equal(f.writes(), 0);
});
test('opt-out immediately before durable submission cancels the write', async () => {
  const f = fixture(); const mutate = f.deps.mutate; let calls = 0;
  f.deps.mutate = async fn => { calls++; if (calls === 2) f.state.autoBench.preferences[team.owner].enabled = false; await mutate(fn); };
  await executeAutoBench(config, now, f.deps); assert.equal(f.writes(), 0);
});

test('daily timing follows normal and early waiver hours with daylight saving time', () => {
  // Standard time: 3 PM waivers, 3:15 PM check.
  assert.equal(autoBenchWindow(new Date('2026-11-18T23:15:00Z'), [])?.runAt, '2026-11-18T23:15:00.000Z');
  assert.equal(autoBenchWindow(new Date('2026-11-18T23:00:00Z'), []), null);
  assert.equal(autoBenchWindow(new Date('2026-11-18T23:30:00Z'), []), null);
  // Daylight time: same Pacific hour, a different UTC offset.
  assert.ok(autoBenchWindow(new Date('2026-10-24T22:15:00Z'), []));
  // Noon Saturday tip: 11 AM waivers, 11:15 AM check.
  const games = [{ home: 'BOS', away: 'DEN', tipoff: '2026-10-24T19:00:00Z' }];
  assert.equal(autoBenchWindow(new Date('2026-10-24T18:15:00Z'), games)?.waiverAt, '2026-10-24T18:00:00.000Z');
  assert.equal(autoBenchWindow(new Date('2026-10-24T22:15:00Z'), games), null);
});
test('LM adds and queued LM claims are excluded even when in the starting lineup', async () => {
  for (const type of ['FREEAGENT', 'WAIVER']) {
    const f = fixture(); f.raw.transactions![0].isLeagueManager = true; f.raw.transactions![0].type = type;
    assert.deepEqual(await executeAutoBench(config, now, f.deps), []);
    assert.equal(f.writes(), 0); assert.equal(Object.keys(f.state.autoBench.dailyRuns ?? {}).length, 0);
  }
});
test('one daily batch handles every starting pickup, and a later pickup cannot trigger a second batch', async () => {
  const f = fixture();
  f.raw.transactions!.push({ ...f.raw.transactions![0], id: 'second', items: [{ type: 'ADD', playerId: 100, toTeamId: team.espnTeamId }] });
  const moved: number[] = [];
  f.deps.bench = async input => { moved.push(input.playerId); f.roster.teams[0].roster!.entries.find(entry => entry.playerPoolEntry.id === input.playerId)!.lineupSlotId = 12; return { ok: true, dryRun: false, status: 200, body: '', authFailed: false }; };
  await executeAutoBench(config, now, f.deps);
  assert.deepEqual(moved.sort((a, b) => a - b), [99, 100]);
  f.roster.teams[0].roster!.entries[0].lineupSlotId = 0;
  f.raw.transactions!.push({ ...f.raw.transactions![0], id: 'later', processDate: now.getTime() });
  await executeAutoBench(config, now, f.deps);
  assert.equal(moved.length, 2); assert.equal(Object.keys(f.state.autoBench.dailyRuns ?? {}).length, 1);
});
test('nonstarting pickups and pickups before the waiver run do not consume a daily batch', async () => {
  const f = fixture(); f.roster.teams[0].roster!.entries[0].lineupSlotId = 12;
  assert.deepEqual(await executeAutoBench(config, now, f.deps), []);
  assert.equal(Object.keys(f.state.autoBench.dailyRuns ?? {}).length, 0);
  const early = fixture(); early.raw.transactions![0].processDate = Date.parse('2026-11-18T19:55:00Z');
  assert.deepEqual(await executeAutoBench(config, now, early.deps), []);
  assert.equal(Object.keys(early.state.autoBench.dailyRuns ?? {}).length, 0);
});

test('each opted-in owner gets their own single daily batch', async () => {
  const f = fixture(); const other = CONFIG_TEAMS[1];
  f.state.autoBench.preferences[other.owner] = { ...f.state.autoBench.preferences[team.owner], teamId: other.espnTeamId };
  f.roster.teams.push({ id: other.espnTeamId, roster: { entries: [{ lineupSlotId: 0, playerPoolEntry: { id: 200 } }] } } as unknown as EspnLeagueResponse['teams'][number]);
  f.raw.transactions!.push({ ...f.raw.transactions![0], id: 'other-owner', teamId: other.espnTeamId, items: [{ type: 'ADD', playerId: 200, toTeamId: other.espnTeamId }] });
  const owners: number[] = [];
  f.deps.bench = async input => { owners.push(input.teamId); f.roster.teams.find(team => team.id === input.teamId)!.roster!.entries.find(entry => entry.playerPoolEntry.id === input.playerId)!.lineupSlotId = 12; return { ok: true, dryRun: false, status: 200, body: '', authFailed: false }; };
  await executeAutoBench(config, now, f.deps);
  assert.deepEqual(owners.sort((a, b) => a - b), [team.espnTeamId, other.espnTeamId].sort((a, b) => a - b));
  assert.equal(Object.keys(f.state.autoBench.dailyRuns ?? {}).length, 2);
});

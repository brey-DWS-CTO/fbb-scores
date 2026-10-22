import assert from 'node:assert/strict';
import test from 'node:test';
import { claimPriority, claimReady } from '../src/lib/league/lmClaims.js';
import { lmAddWindow, type LmAddRequest } from '../src/lib/league/lmWeekend.js';
import { monthDates, waiverCalendarDay } from '../src/lib/league/waiverCalendar.js';
import { runAdvanceLmClaims, type ClaimRuntime } from '../server/lib/lmWeekendService.js';

const games = [{ home: 'DEN', away: 'LAL', tipoff: '2026-10-24T19:00:00.000Z' }];
const now = new Date('2026-10-24T18:00:00.000Z');
const config = { leagueId: 'test', seasonId: 2027, cookie: 'not-a-credential', dryRun: true };
const claim = (id: string, extra: Partial<LmAddRequest> = {}): LmAddRequest => ({ id, season: 2027, owner: 'Kyle', teamId: 1, playerId: 100, playerName: 'Test Player', proTeam: 'DEN', requestedAt: '2026-10-23T17:00:00.000Z', forDate: '2026-10-24', status: 'queued', note: '', updatedAt: '2026-10-23T17:00:00.000Z', handledBy: null, ...extra });
const readyInput = { request: claim('a'), now, games, onTeamId: 0, proTeam: 'DEN', lastDroppedAt: null, lastWaiverAt: '2026-10-24T18:00:00.000Z' };

test('claims wait for current ownership and normal waivers, including pickup/drop cycles', () => {
  assert.equal(claimReady(readyInput).action, 'ready');
  assert.equal(claimReady({ ...readyInput, onTeamId: 2 }).action, 'wait');
  assert.equal(claimReady({ ...readyInput, onTeamId: null }).action, 'wait');
  assert.equal(claimReady({ ...readyInput, lastDroppedAt: '2026-10-24T18:01:00.000Z' }).action, 'wait');
  assert.equal(claimReady({ ...readyInput, lastDroppedAt: '2026-10-23T23:00:00.000Z' }).action, 'ready');
  assert.equal(claimReady({ ...readyInput, proTeam: 'BOS' }).action, 'deny');
});

test('cutoff is ten minutes before the earliest tip; no bypass after cutoff or tip-off', () => {
  assert.equal(lmAddWindow(new Date('2026-10-24T18:49:59Z'), games).open, true);
  assert.equal(lmAddWindow(new Date('2026-10-24T18:50:00Z'), games).open, false);
  assert.equal(claimReady({ ...readyInput, request: claim('a', { requestedAt: '2026-10-24T18:50:00Z' }) }).action, 'deny');
  assert.equal(claimReady({ ...readyInput, now: new Date('2026-10-24T18:51:00Z'), lastDroppedAt: '2026-10-24T18:01:00Z' }).action, 'deny');
  assert.equal(claimReady({ ...readyInput, now: new Date('2026-10-24T19:00:00Z') }).action, 'deny');
});

test('calendar highlights irregular waiver times and eligible LM days; missing data is unknown', () => {
  const day = waiverCalendarDay('2026-10-24', games);
  assert.equal(day.waiver?.early, true);
  assert.equal(day.waiver?.hourPT, 11);
  assert.equal(day.lmEligible, true);
  assert.equal(day.lmClosesAt, '2026-10-24T18:50:00.000Z');
  assert.equal(waiverCalendarDay('2026-10-23', games).lmEligible, false);
  assert.equal(waiverCalendarDay('2026-10-24', []).lmEligible, false);
  assert.equal(waiverCalendarDay('2026-10-24', null).games, null);
  assert.equal(monthDates('2026-02').length, 28);
  assert.equal(monthDates('2028-02').length, 29);
  assert.throws(() => monthDates('2026-13'));
});

function runtime(initial: LmAddRequest[]) {
  const rows = new Map(initial.map(row => [row.id, { ...row }]));
  let holder: number | null = 0;
  let writes = 0;
  let failAfterWrite = false;
  const deps: ClaimRuntime = {
    list: async () => [...rows.values()].map(row => ({ ...row })),
    save: async row => { rows.set(row.id, { ...row }); },
    transition: async (next, expected) => {
      const current = rows.get(expected.id);
      if (!current || current.status !== expected.status || current.updatedAt !== expected.updatedAt) return false;
      if (next.status === 'processing' && [...rows.values()].some(other => other.id !== next.id && other.forDate === next.forDate && other.playerId === next.playerId
        && (['processing', 'added', 'requested', 'waiting-for-drop', 'failsafe'].includes(other.status) || (other.status === 'queued' && claimPriority(other, next) < 0)))) return false;
      rows.set(next.id, { ...next }); return true;
    },
    games: async () => games,
    facts: async () => ({ name: 'Test Player', proTeam: 'DEN', onTeamId: holder }),
    drops: async () => new Map(), lastRun: async () => '2026-10-24T18:00:00.000Z',
    add: async row => { writes++; holder = row.teamId; if (failAfterWrite) throw new Error('Connection ended after ESPN accepted'); return { ...row, status: 'added', note: 'Added' }; },
  };
  return { deps, rows, writes: () => writes, setHolder: (value: number | null) => { holder = value; }, failAfterWrite: () => { failAfterWrite = true; } };
}

test('first submitted wins regardless of storage order; later claims cannot overwrite the award', async () => {
  const a = claim('first');
  const b = claim('second', { teamId: 2, owner: 'Ryan', requestedAt: '2026-10-23T18:00:00.000Z' });
  const rt = runtime([b, a]);
  await runAdvanceLmClaims(config, now, rt.deps);
  assert.equal(rt.rows.get('first')?.status, 'added');
  await runAdvanceLmClaims(config, new Date(now.getTime() + 60_000), rt.deps);
  assert.equal(rt.rows.get('second')?.status, 'denied');
  assert.equal(rt.writes(), 1);
});

test('overlapping workers acquire only one lease and send one add', async () => {
  const rt = runtime([claim('first')]);
  await Promise.all([runAdvanceLmClaims(config, now, rt.deps), runAdvanceLmClaims(config, now, rt.deps)]);
  assert.equal(rt.writes(), 1);
});

test('an interrupted successful write is recovered by ownership, never sent a second time', async () => {
  const rt = runtime([claim('first')]); rt.failAfterWrite();
  await runAdvanceLmClaims(config, now, rt.deps);
  assert.equal(rt.rows.get('first')?.status, 'processing');
  await runAdvanceLmClaims(config, new Date(now.getTime() + 3 * 60_000), rt.deps);
  assert.equal(rt.rows.get('first')?.status, 'added');
  assert.equal(rt.writes(), 1);
});

test('normal waiver clearance and missing transaction data prevent automatic adds', async () => {
  const rt = runtime([claim('first')]);
  rt.deps.drops = async () => new Map([[100, '2026-10-24T18:01:00.000Z']]);
  await runAdvanceLmClaims(config, now, rt.deps);
  assert.equal(rt.rows.get('first')?.status, 'queued');
  assert.equal(rt.writes(), 0);
  rt.deps.drops = async () => { throw new Error('No transaction feed'); };
  await assert.rejects(runAdvanceLmClaims(config, now, rt.deps), /transaction feed/);
  assert.equal(rt.writes(), 0);
});

test('expired queued claims do not receive failsafe points; unknown ownership never becomes a free agent', async () => {
  const expired = runtime([claim('first')]);
  await runAdvanceLmClaims(config, new Date('2026-10-24T19:01:00Z'), expired.deps);
  assert.equal(expired.rows.get('first')?.status, 'denied');
  const unknown = runtime([claim('first')]); unknown.setHolder(null);
  await runAdvanceLmClaims(config, now, unknown.deps);
  assert.equal(unknown.rows.get('first')?.status, 'processing');
  assert.equal(unknown.writes(), 0);
});

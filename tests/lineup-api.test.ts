import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before, after } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(root, 'node_modules', '.tmp');
let tempRoot = '';
let server: Server;
let base = '';
let store: typeof import('../server/lib/leagueStore.js');
const headers = (owner = 'Brey') => ({ 'content-type': 'application/json', 'x-owner': owner, 'x-pin': 'fixture-only' });
async function call(route: string, method = 'GET', body?: unknown, owner = 'Brey') {
  const response = await fetch(`${base}/api/league/${route}`, { method, headers: headers(owner), body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'lineup-api-'));
  cpSync(path.join(root, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(root, 'src'), path.join(tempRoot, 'src'), { recursive: true });
  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.ESPN_LEAGUE_ID = '123456';
  process.env.ESPN_LINEUP_READS_ENABLED = '0';
  store = await import(pathToFileURL(path.join(tempRoot, 'server/lib/leagueStore.ts')).href);
  await store.setPin('Brey', 'fixture-only');
  await store.setPin('Ryan', 'fixture-only');
  const { default: app } = await import(pathToFileURL(path.join(tempRoot, 'server/app.ts')).href);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (tempRoot && path.resolve(tempRoot).startsWith(path.resolve(tempParent) + path.sep)) rmSync(tempRoot, { recursive: true, force: true });
});

test('lineup routes require authentication and default to disabled without disclosing grants', async () => {
  assert.equal((await fetch(`${base}/api/league/my-team`)).status, 401);
  const response = await call('my-team');
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.executionEnabled, false);
  assert.equal(response.body.readEnabled, false);
  assert.equal(response.body.snapshot, null);
  assert.deepEqual(response.body.destinations, {});
  assert.equal((await call('lineup-access', 'GET', undefined, 'Ryan')).status, 403);
});
test('commissioner can grant own configured team only and revoke it', async () => {
  assert.equal((await call('lineup-access/Ryan', 'PUT', { enabled: true, leagueId: '123456', teamId: 1 })).status, 403);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: '123456', teamId: 1 })).status, 403);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: 'other', teamId: 7 })).status, 403);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: '123456', teamId: 7 })).status, 200);
  assert.equal((await call('my-team')).body.enabled, true);
  assert.equal((await call('my-team')).body.executionEnabled, false);
  assert.equal((await call('lineup-access/Brey', 'PUT', { enabled: false })).status, 200);
  assert.equal((await call('my-team')).body.enabled, false);
});
test('client cannot select target team, and even granted access cannot enable writes', async () => {
  await call('lineup-access/Brey', 'PUT', { enabled: true, leagueId: '123456', teamId: 7 });
  const request = { id: 'fixture-operation-123', playerId: 1, destinationSlotId: 'bench', revision: 'fixture' };
  assert.equal((await call('my-team/moves', 'POST', { ...request, teamId: 1 })).status, 400);
  const disabled = await call('my-team/moves', 'POST', request);
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.notSubmitted, true);
  assert.deepEqual((await store.getState()).state.lineupManagement?.operations, {});
  assert.equal((await call('my-team/moves/nonexistent')).status, 409);
});
test('private lineup grants and ledger are redacted from public and member league state', async () => {
  const member = await call('state', 'GET', undefined, 'Ryan');
  assert.equal(member.status, 200);
  assert.equal('lineupManagement' in member.body.state, false);
  const publicResponse = await fetch(`${base}/api/league/state`);
  assert.equal('lineupManagement' in (await publicResponse.json()).state, false);
});

test('missed-games report is public while refresh remains commissioner-only', async () => {
  assert.equal((await fetch(`${base}/api/league/missed-games`)).status, 200);
  assert.equal((await call('missed-games', 'GET', undefined, 'Ryan')).status, 200);
  assert.equal((await call('missed-games/refresh', 'POST', { week: 1 }, 'Ryan')).status, 403);
  const report = await call('missed-games');
  assert.equal(report.status, 200);
  assert.equal(report.body.teams.length, 10);
  assert.equal(report.body.calendarKnown, false);
  assert.ok(report.body.teams.every((t: { playInEligible: unknown }) => t.playInEligible === null));
});

test('missed-games refresh persists all teams, protects finalized rows on failure, and preserves approvals', async () => {
  const { refreshMissedGames } = await import(pathToFileURL(path.join(tempRoot, 'server/lib/missedGamesService.ts')).href);
  const ref = { matchupPeriodId: 1, scoringPeriodIds: [1], startDate: '2026-10-20', endDate: '2026-10-25', label: 'Week 1', phase: 'regular' };
  const sides = store.CONFIG_TEAMS.map((team, i) => ({ teamId: team.espnTeamId, name: team.owner, players: [{ id: i + 1, days: { '1': { started: true, played: true, points: 10, stats: null } } }] }));
  const fixture = { season: 2027, matchupPeriodId: 1, weeks: [ref], days: [{ scoringPeriodId: 1, date: '2026-10-25', games: {} }], matchups: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, home: sides[i * 2], away: sides[i * 2 + 1] })), gamesCap: 30, fetchedAt: '2026-10-26T20:00:00Z' };
  const now = new Date('2026-10-26T20:00:00Z');
  const report = await refreshMissedGames(1, now, async () => fixture);
  assert.equal(report.teams[0].missedWeeks, 1);
  assert.equal(report.teams[0].totalGamesMissed, 29);
  assert.equal((await call('missed-games/refresh', 'POST', { week: -1 })).status, 400);
  assert.equal((await call('missed-games/exemption', 'POST', { week: 1, teamId: 7, reason: 'Cancellation' }, 'Ryan')).status, 403);
  assert.equal((await call('missed-games/exemption', 'POST', { week: 1, teamId: 7, reason: 'Cancellation' })).status, 200);
  await call('missed-games/exemption', 'POST', { week: 1, teamId: 7, reason: 'Cancellation' });
  assert.deepEqual((await store.getState()).state.missedGames.exemptions[0].approvals, ['Brey']);
  assert.equal((await call('missed-games')).body.teams.find((t: { teamId: number }) => t.teamId === 7).countedWeeks, 1);
  const incomplete = structuredClone(fixture); incomplete.days[0].games = null; incomplete.fetchedAt = '2026-10-27T20:00:00Z';
  await refreshMissedGames(1, now, async () => incomplete);
  assert.equal((await store.getState()).state.missedGames.weeks['2027:1'].status, 'final');
  await assert.rejects(refreshMissedGames(1, now, async () => { throw new Error('offline'); }));
  assert.equal((await store.getState()).state.missedGames.weeks['2027:1'].teams.length, 10);
  const member = await call('state', 'GET', undefined, 'Ryan');
  assert.equal('missedGames' in member.body.state, false);
  const publicResponse = await fetch(`${base}/api/league/state`);
  assert.equal('missedGames' in (await publicResponse.json()).state, false);
});

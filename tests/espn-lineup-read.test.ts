import assert from 'node:assert/strict';
import test from 'node:test';
import { EspnReadOnlyLineupProvider, type EspnReadRequest, type EspnReadTransport } from '../server/lib/lineup/espnReadOnly.js';
import { lmTeamManagerEditorUrl, assertLmTeamManagerContext } from '../src/lib/league/lmLineupWorkflow.js';

const time = new Date('2026-10-25T08:00:00Z');
const config = { leagueId: '123456', seasonId: 2027, cookie: 'fixture-cookie-never-log' };
const team = { leagueId: '123456', teamId: 7 };
function settings() {
  return { id: 123456, seasonId: 2027, scoringPeriodId: 6, settings: { rosterSettings: {
    lineupLocktimeType: 'INDIVIDUAL_GAME', rosterLocktimeType: 'FIRSTGAME_SCORINGPERIOD',
    isBenchUnlimited: true, lineupSlotCounts: { '0': 1, '5': 1, '11': 2, '12': 1, '13': 1 },
  } } };
}
function roster() {
  return { id: 123456, seasonId: 2027, scoringPeriodId: 6, teams: [{ id: 7, roster: { entries: [
    { playerId: 1, lineupSlotId: 12, playerPoolEntry: { id: 1, onTeamId: 7, lineupLocked: false,
      player: { id: 1, fullName: 'Fixture Player', eligibleSlots: [0, 5, 11, 12, 13] } } },
  ] } }] };
}
function setup(transport?: EspnReadTransport, enabled = true) {
  const calls: EspnReadRequest[] = [];
  const get: EspnReadTransport = async request => {
    calls.push(request);
    return transport ? transport(request) : { status: 200, data: calls.length % 2 === 1 ? settings() : roster() };
  };
  const provider = new EspnReadOnlyLineupProvider(() => config, get, () => enabled, () => time);
  return { provider, calls };
}

test('observed reads use fixed read host and scoped view parameters, with fresh nonces', async () => {
  const { provider, calls } = setup();
  const first = await provider.read(team);
  const second = await provider.read(team);
  assert.equal(first.players.length, 1);
  assert.equal(first.players[0].lockAt, null);
  assert.equal(first.periodLockAt, null);
  assert.equal(first.fetchedAt, time.toISOString());
  assert.match(first.revision, /^[0-9a-f]{64}$/);
  assert.equal(first.revision, second.revision, 'request nonce and fetched time do not change roster revision');
  const settingsUrl = new URL(calls[0].url);
  const rosterUrl = new URL(calls[1].url);
  assert.equal(settingsUrl.origin, 'https://lm-api-reads.fantasy.espn.com');
  assert.equal(settingsUrl.pathname, '/apis/v3/games/fba/seasons/2027/segments/0/leagues/123456');
  assert.deepEqual(settingsUrl.searchParams.getAll('view'), ['mSettings', 'mTeam']);
  assert.equal(rosterUrl.searchParams.get('forTeamId'), '7');
  assert.equal(rosterUrl.searchParams.get('scoringPeriodId'), '6');
  assert.equal(rosterUrl.searchParams.get('view'), 'mRoster');
  assert.equal(calls[0].headers['Cache-Control'], 'no-cache, no-store');
  assert.equal(new Set(calls.map(call => new URL(call.url).searchParams.get('_'))).size, 4);
  assert.equal(provider.executionEnabled, false);
  assert.equal(await provider.canExecute(), false);
  await assert.rejects(provider.execute(), /disabled/);
  assert.equal(calls.length, 4, 'execution refusal cannot send another request');
});
test('read opt-in and matching server configuration are required before any request', async () => {
  const disabled = setup(undefined, false);
  await assert.rejects(disabled.provider.read(team), /not enabled/);
  assert.equal(disabled.calls.length, 0);
  const wrong = setup();
  await assert.rejects(wrong.provider.read({ ...team, leagueId: 'other' }), /configuration/);
  await assert.rejects(wrong.provider.read({ ...team, teamId: -1 }), /configuration/);
  assert.equal(wrong.calls.length, 0);
  for (const invalid of [null, { ...config, leagueId: 'https://attacker.invalid' }, { ...config, cookie: '' }, { ...config, seasonId: NaN }]) {
    const provider = new EspnReadOnlyLineupProvider(() => invalid, async () => { assert.fail('must not contact ESPN'); }, () => true);
    await assert.rejects(provider.read(team), /configuration/);
  }
});
test('redirects, session failures, cached 304 bodies and server errors fail closed', async () => {
  for (const status of [302, 303, 304, 307, 401, 403, 429, 500]) {
    const { provider, calls } = setup(async () => ({ status, data: settings() }));
    await assert.rejects(provider.read(team), /session|fresh roster/);
    assert.equal(calls.length, 1, 'no automatic retry or fallback request');
  }
});
test('HTTP and malformed response failures are sanitized and never echo credentials', async () => {
  const thrown = setup(async () => { throw new Error(`Axios config Cookie=${config.cookie}`); });
  await assert.rejects(thrown.provider.read(team), error => error instanceof Error && !error.message.includes(config.cookie));
  const html = setup(async () => ({ status: 200, data: '<html>sign in</html>' }));
  await assert.rejects(html.provider.read(team), /scoring period/);
  const bad = setup(async request => ({ status: 200, data: new URL(request.url).searchParams.has('forTeamId') ? { ...roster(), seasonId: 2026 } : settings() }));
  await assert.rejects(bad.provider.read(team), /safely interpreted/);
});
test('slow or backwards-time reads cannot be stamped as fresh', async () => {
  for (const delta of [31000, -1000]) {
    let reads = 0;
    const provider = new EspnReadOnlyLineupProvider(() => config,
      async () => ({ status: 200, data: ++reads === 1 ? settings() : roster() }), () => true,
      () => reads === 0 ? time : new Date(time.getTime() + delta));
    await assert.rejects(provider.read(team), /stale/);
  }
});
test('server SHA-256 revision changes for eligibility, assignment and lock changes', async () => {
  const baseline = await setup().provider.read(team);
  for (const change of ['eligibility', 'assignment', 'lock']) {
    const changed = roster();
    const entry = changed.teams[0].roster.entries[0];
    if (change === 'eligibility') entry.playerPoolEntry.player.eligibleSlots = [5, 12];
    if (change === 'assignment') entry.lineupSlotId = 5;
    if (change === 'lock') entry.playerPoolEntry.lineupLocked = true;
    const modified = setup(async request => ({ status: 200, data: new URL(request.url).searchParams.has('forTeamId') ? changed : settings() }));
    assert.notEqual((await modified.provider.read(team)).revision, baseline.revision);
  }
});
test('observed LM editor URL must use Team Manager and exact authorized league, team and period', () => {
  const context = { ...team, scoringPeriodId: 6 };
  const url = lmTeamManagerEditorUrl(context);
  assert.doesNotThrow(() => assertLmTeamManagerContext(url, context));
  for (const invalid of [url.replace('true', 'false'), url.replace('teamId=7', 'teamId=8'),
    url.replace('scoringPeriodId=6', 'scoringPeriodId=5'), url.replace('fantasy.espn.com', 'attacker.invalid'),
    url + '&teamId=7', url + '&isLeagueManager=true', url + '#other', url.replace('/tools/lmeditlineup', '/team')]) {
    assert.throws(() => assertLmTeamManagerContext(invalid, context));
  }
});

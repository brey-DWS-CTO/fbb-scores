import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import rawSchedule from '../src/data/source/basketball-monster-schedule-2027.json' with { type: 'json' };
import type {
  LeagueDataset,
  LeagueDynamicState,
} from '../src/lib/keeper/types.ts';
import { playerPoolFromDataset } from '../src/lib/league/playerPool.ts';
import { buildDraftBoard } from '../src/lib/keeper/engine.ts';
import { rankBoard } from '../src/lib/league/draftRankings.ts';
import {
  DEFAULT_2027_LEAGUE_MAPPING,
  type RawScheduleSource,
} from '../src/lib/league/schedule.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const dataset = rawDataset as unknown as LeagueDataset;
const commissioner = dataset.teams.find((team) => team.isCommissioner)?.owner;
assert.ok(commissioner, 'fixture needs a commissioner');

const pins = {
  [commissioner]: '9000',
  Joel: '1000',
  Ryan: '2000',
  Dustin: '3000',
};

type StoreModule = typeof import('../server/lib/leagueStore.ts');
type TeamNameModule = typeof import('../server/lib/teamNameService.ts');

let tempRoot = '';
let store: StoreModule;
let teamNames: TeamNameModule;
let server: Server;
let baseUrl = '';

function cleanState(): LeagueDynamicState {
  return {
    season: dataset.season,
    keepers: {},
    keepersRevealed: false,
    draft: { picks: {}, startedAt: null },
    locks: { keepersLocked: false },
  };
}

async function replaceState(next: LeagueDynamicState): Promise<void> {
  await store.mutateState((draft) => {
    draft.season = next.season;
    draft.keepers = structuredClone(next.keepers);
    draft.keepersRevealed = next.keepersRevealed;
    draft.draft = structuredClone(next.draft);
    draft.locks = structuredClone(next.locks);
    if (next.playerPool) draft.playerPool = structuredClone(next.playerPool);
    else delete draft.playerPool;
    if (next.schedule) draft.schedule = structuredClone(next.schedule);
    else delete draft.schedule;
    if (next.teamNames) draft.teamNames = structuredClone(next.teamNames);
    else delete draft.teamNames;
    delete draft.overrides;
  });
}

function playerPoolCandidate() {
  const players = playerPoolFromDataset(dataset.players).map((player) => ({
    espnId: player.espnId,
    fullName: player.fullName,
    proTeam: player.proTeam,
    positions: player.positions,
  }));
  players.push({
    espnId: 99_999_999,
    fullName: 'Test Rookie',
    proTeam: 'FA',
    positions: ['PG'],
  });
  return {
    sourceSeason: dataset.season,
    fetchedAt: '2026-08-27T12:00:00.000Z',
    players,
  };
}

function scheduleCandidate() {
  return {
    source: structuredClone(rawSchedule) as RawScheduleSource,
    mapping: structuredClone(DEFAULT_2027_LEAGUE_MAPPING),
    status: 'provisional' as const,
  };
}

function auth(owner: keyof typeof pins): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-owner': owner,
    'x-pin': pins[owner],
  };
}

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'league-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const teamNamesUrl = pathToFileURL(
    path.join(tempRoot, 'server', 'lib', 'teamNameService.ts'),
  ).href;
  const [{ default: app }, storeModule, teamNameModule] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
    import(teamNamesUrl) as Promise<TeamNameModule>,
  ]);
  store = storeModule;
  teamNames = teamNameModule;
  for (const [owner, pin] of Object.entries(pins)) {
    await store.setPin(owner, pin);
  }

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await replaceState(cleanState());
  await store.clearKeeperScenariosForSeason(dataset.season);
  for (const owner of Object.keys(pins)) await store.setDraftList(dataset.season, owner, null);
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('hides keeper names before reveal except from their owner and commissioner', async () => {
  const joelPlayer = dataset.players.find((player) => player.fantasyTeam === 'Joel');
  const ryanPlayer = dataset.players.find((player) => player.fantasyTeam === 'Ryan');
  assert.ok(joelPlayer);
  assert.ok(ryanPlayer);

  const next = cleanState();
  next.keepers = {
    Joel: [{ playerKey: joelPlayer.key, playerName: joelPlayer.name }],
    Ryan: [{ playerKey: ryanPlayer.key, playerName: ryanPlayer.name }],
  };
  await replaceState(next);

  const publicView = await request('/api/league/state');
  const joelView = await request('/api/league/state', { headers: auth('Joel') });
  const commissionerView = await request('/api/league/state', {
    headers: auth(commissioner),
  });

  assert.deepEqual((publicView.body.state as LeagueDynamicState).keepers, {});
  assert.deepEqual(Object.keys((joelView.body.state as LeagueDynamicState).keepers), ['Joel']);
  assert.deepEqual(
    Object.keys((commissionerView.body.state as LeagueDynamicState).keepers).sort(),
    ['Joel', 'Ryan'],
  );
});

test('keeps each member private scenario isolated, including from the commissioner', async () => {
  const kylePlayer = dataset.players.find((player) => player.fantasyTeam === 'Kyle');
  assert.ok(kylePlayer);

  const anonymous = await request('/api/league/keeper-scenario');
  assert.equal(anonymous.status, 401);

  const beforeAudit = await store.readAudit(1000);
  const saved = await request('/api/league/keeper-scenario/Kyle', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({
      selections: [{ playerKey: kylePlayer.key, playerName: 'Forged Name' }],
    }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.scenario, {
    Kyle: [{ playerKey: kylePlayer.key, playerName: kylePlayer.name }],
  });

  const joelView = await request('/api/league/keeper-scenario', { headers: auth('Joel') });
  const ryanView = await request('/api/league/keeper-scenario', { headers: auth('Ryan') });
  const commissionerView = await request('/api/league/keeper-scenario', {
    headers: auth(commissioner),
  });
  assert.deepEqual(joelView.body.scenario, saved.body.scenario);
  assert.deepEqual(ryanView.body.scenario, {});
  assert.deepEqual(commissionerView.body.scenario, {});
  assert.equal((await store.readAudit(1000)).length, beforeAudit.length);
});

test('validates projected keepers and rejects a projection for your own team', async () => {
  const joelPlayer = dataset.players.find((player) => player.fantasyTeam === 'Joel');
  const amyPlayer = dataset.players.find((player) => player.fantasyTeam === 'Amy');
  assert.ok(joelPlayer);
  assert.ok(amyPlayer);

  const ownTeam = await request('/api/league/keeper-scenario/Joel', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({
      selections: [{ playerKey: joelPlayer.key, playerName: joelPlayer.name }],
    }),
  });
  assert.equal(ownTeam.status, 400);
  assert.match(String(ownTeam.body.error), /real keeper worksheet/);

  const wrongRoster = await request('/api/league/keeper-scenario/Kyle', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({
      selections: [{ playerKey: amyPlayer.key, playerName: amyPlayer.name }],
    }),
  });
  assert.equal(wrongRoster.status, 400);
  assert.match(String(wrongRoster.body.error), /Amy's roster.*only they can keep him/);
  assert.deepEqual(await store.getKeeperScenario(dataset.season, 'Joel'), {});
});

test('resets one projected team or the signed-in member whole scenario', async () => {
  const kylePlayer = dataset.players.find((player) => player.fantasyTeam === 'Kyle');
  const ryanPlayer = dataset.players.find((player) => player.fantasyTeam === 'Ryan');
  assert.ok(kylePlayer);
  assert.ok(ryanPlayer);

  for (const [target, player] of [['Kyle', kylePlayer], ['Ryan', ryanPlayer]] as const) {
    const saved = await request(`/api/league/keeper-scenario/${target}`, {
      method: 'PUT',
      headers: auth('Joel'),
      body: JSON.stringify({
        selections: [{ playerKey: player.key, playerName: player.name }],
      }),
    });
    assert.equal(saved.status, 200);
  }

  const oneReset = await request('/api/league/keeper-scenario/Kyle', {
    method: 'DELETE',
    headers: auth('Joel'),
  });
  assert.deepEqual(oneReset.body.scenario, {
    Ryan: [{ playerKey: ryanPlayer.key, playerName: ryanPlayer.name }],
  });

  const allReset = await request('/api/league/keeper-scenario', {
    method: 'DELETE',
    headers: auth('Joel'),
  });
  assert.equal(allReset.status, 200);
  assert.deepEqual(allReset.body.scenario, {});
});

test('reveal clears every private scenario and closes projection writes', async () => {
  const kylePlayer = dataset.players.find((player) => player.fantasyTeam === 'Kyle');
  assert.ok(kylePlayer);
  const body = JSON.stringify({
    selections: [{ playerKey: kylePlayer.key, playerName: kylePlayer.name }],
  });
  for (const viewer of ['Joel', 'Ryan'] as const) {
    const saved = await request('/api/league/keeper-scenario/Kyle', {
      method: 'PUT',
      headers: auth(viewer),
      body,
    });
    assert.equal(saved.status, 200);
  }

  const reveal = await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  assert.equal(reveal.status, 200);
  assert.deepEqual(await store.getKeeperScenario(dataset.season, 'Joel'), {});
  assert.deepEqual(await store.getKeeperScenario(dataset.season, 'Ryan'), {});

  const closed = await request('/api/league/keeper-scenario/Kyle', {
    method: 'PUT',
    headers: auth('Joel'),
    body,
  });
  assert.equal(closed.status, 409);
  assert.match(String(closed.body.error), /projections are closed/);
});

test('requires the commissioner to reveal keepers before starting the draft', async () => {
  const blocked = await request('/api/league/draft/start', {
    method: 'POST',
    headers: auth(commissioner),
  });
  assert.equal(blocked.status, 409);
  assert.match(String(blocked.body.error), /Reveal keeper names/);
  assert.equal((await store.getState()).state.draft.startedAt, null);

  const visibility = await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  assert.equal(visibility.status, 200);

  const started = await request('/api/league/draft/start', {
    method: 'POST',
    headers: auth(commissioner),
  });
  assert.equal(started.status, 200);
  assert.notEqual((started.body.state as LeagueDynamicState).draft.startedAt, null);
});

test('rejects an invalid keeper from another owner roster', async () => {
  const amyPlayer = dataset.players.find((player) => player.fantasyTeam === 'Amy');
  assert.ok(amyPlayer);

  const response = await request('/api/league/keepers/Joel', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({
      selections: [{ playerKey: amyPlayer.key, playerName: amyPlayer.name }],
    }),
  });

  assert.equal(response.status, 400);
  assert.match(String(response.body.error), /Amy's roster.*only they can keep him/);
  assert.deepEqual((await store.getState()).state.keepers, {});
});

test('enforces the on-clock pick and its owner', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  next.draft.startedAt = '2026-10-18T21:00:00.000Z';
  await replaceState(next);

  const firstPlayer = dataset.players[0];
  const secondPlayer = dataset.players[1];
  assert.ok(firstPlayer);
  assert.ok(secondPlayer);

  const outOfTurn = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({
      overallPick: 2,
      playerKey: firstPlayer.key,
      playerName: firstPlayer.name,
    }),
  });
  assert.equal(outOfTurn.status, 409);
  assert.match(String(outOfTurn.body.error), /Pick #1 is on the clock/);

  const firstPick = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({
      overallPick: 1,
      playerKey: firstPlayer.key,
      playerName: firstPlayer.name,
    }),
  });
  assert.equal(firstPick.status, 200);

  const wrongOwner = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({
      overallPick: 2,
      playerKey: secondPlayer.key,
      playerName: secondPlayer.name,
    }),
  });
  assert.equal(wrongOwner.status, 403);
  assert.match(String(wrongOwner.body.error), /Only Ryan can enter this pick/);
});

test('rejects a player who is already off the draft board', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  next.draft.startedAt = '2026-10-18T21:00:00.000Z';
  await replaceState(next);

  const player = dataset.players[0];
  assert.ok(player);
  const body = JSON.stringify({
    overallPick: 1,
    playerKey: player.key,
    playerName: player.name,
  });
  const firstPick = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Joel'),
    body,
  });
  assert.equal(firstPick.status, 200);

  const duplicate = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({
      overallPick: 2,
      playerKey: player.key,
      playerName: player.name,
    }),
  });
  assert.equal(duplicate.status, 409);
  assert.match(String(duplicate.body.error), /already off the board/);
});

test('keeps schedule review and acceptance commissioner-only', async () => {
  const currentDenied = await request('/api/league/schedule', { headers: auth('Joel') });
  assert.equal(currentDenied.status, 403);

  const previewDenied = await request('/api/league/schedule/preview', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify(scheduleCandidate()),
  });
  assert.equal(previewDenied.status, 403);

  const acceptDenied = await request('/api/league/schedule/accept', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify(scheduleCandidate()),
  });
  assert.equal(acceptDenied.status, 403);

  const allowed = await request('/api/league/schedule', { headers: auth(commissioner) });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.fallback, true);
  assert.equal((allowed.body.snapshot as { id: string }).id, 'schedule-fixture-2027');
});

test('previews without writing and accepts the exact schedule snapshot', async () => {
  const candidate = scheduleCandidate();
  const preview = await request('/api/league/schedule/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.currentSnapshotId, 'schedule-fixture-2027');
  assert.equal((preview.body.preview as { changedTeamPeriods: unknown[] }).changedTeamPeriods.length, 0);
  assert.equal((preview.body.preview as { changedMappings: unknown[] }).changedMappings.length, 0);
  assert.equal((await store.getState()).state.schedule, undefined);

  const accepted = await request('/api/league/schedule/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(accepted.status, 200);
  const snapshot = accepted.body.snapshot as {
    id: string;
    createdBy: string;
    leaguePeriods: Array<{ leagueWeek: number; sourceNbaWeeks: number[] }>;
  };
  assert.equal(snapshot.id, preview.body.candidateSnapshotId);
  assert.equal(snapshot.createdBy, commissioner);
  assert.deepEqual(snapshot.leaguePeriods[17]?.sourceNbaWeeks, [18, 19]);
  assert.equal((accepted.body.state as LeagueDynamicState).schedule?.activeSnapshotId, snapshot.id);

  const current = await request('/api/league/schedule', { headers: auth(commissioner) });
  assert.equal(current.status, 200);
  assert.equal(current.body.fallback, false);
  assert.equal((current.body.snapshot as { id: string }).id, snapshot.id);

  const audit = await store.readAudit(1);
  assert.equal(audit[0]?.action, 'schedule.accepted');
  assert.equal((audit[0]?.detail as { snapshotId?: string })?.snapshotId, snapshot.id);
});

test('rejects a changed candidate, stale preview, and post-draft schedule acceptance', async () => {
  const candidate = scheduleCandidate();
  const preview = await request('/api/league/schedule/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);

  const changed = structuredClone(candidate);
  changed.mapping[0]!.label = 'Changed label';
  const mismatch = await request('/api/league/schedule/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...changed,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(mismatch.status, 409);
  assert.match(String(mismatch.body.error), /no longer matches/);

  const accepted = await request('/api/league/schedule/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(accepted.status, 200);

  const stale = await request('/api/league/schedule/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(stale.status, 409);
  assert.match(String(stale.body.error), /changed; preview again|already matches/);

  await replaceState(cleanState());
  const freshPreview = await request('/api/league/schedule/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(freshPreview.status, 200);
  const started = cleanState();
  started.draft.startedAt = '2026-10-18T21:00:00.000Z';
  await replaceState(started);

  const afterDraft = await request('/api/league/schedule/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: freshPreview.body.currentSnapshotId,
      fingerprint: freshPreview.body.fingerprint,
    }),
  });
  assert.equal(afterDraft.status, 409);
  assert.equal(afterDraft.body.reason, 'draft-started');
});

test('keeps player-pool preview and acceptance commissioner-only', async () => {
  const fetchDenied = await request('/api/league/player-pool/fetch-preview', {
    method: 'POST',
    headers: auth('Joel'),
  });
  assert.equal(fetchDenied.status, 403);

  const denied = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify(playerPoolCandidate()),
  });
  assert.equal(denied.status, 403);

  const allowed = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(playerPoolCandidate()),
  });
  assert.equal(allowed.status, 200);
});

test('previews without writing, accepts the exact pool, and pins it at draft start', async () => {
  const candidate = playerPoolCandidate();
  const preview = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.currentSnapshotId, `dataset-${dataset.season}`);
  assert.equal((preview.body.preview as { added: Array<{ key: string }> }).added.at(-1)?.key, 'p99999999');
  assert.equal((await store.getState()).state.playerPool, undefined);

  const accepted = await request('/api/league/player-pool/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(accepted.status, 200);
  const snapshot = accepted.body.snapshot as { id: string; players: Array<{ key: string }> };
  assert.equal(snapshot.id, preview.body.candidateSnapshotId);
  assert.equal(snapshot.players.some((player) => player.key === 'p99999999'), true);
  assert.equal((await store.getState()).state.playerPool?.activeSnapshotId, snapshot.id);

  const current = await request('/api/league/player-pool', { headers: auth(commissioner) });
  assert.equal(current.status, 200);
  assert.equal((current.body.snapshot as { id: string }).id, snapshot.id);
  assert.equal(current.body.fallback, false);

  await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  const started = await request('/api/league/draft/start', {
    method: 'POST',
    headers: auth(commissioner),
  });
  assert.equal(started.status, 200);
  assert.equal(
    (started.body.state as LeagueDynamicState).draft.playerPoolSnapshotId,
    snapshot.id,
  );
  const pinned = await request('/api/league/player-pool');
  assert.equal(pinned.status, 200);
  assert.equal((pinned.body.snapshot as { id: string }).id, snapshot.id);
  assert.equal(pinned.body.draftSnapshotId, snapshot.id);
  const rookiePick = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({
      overallPick: 1,
      playerKey: 'p99999999',
      playerName: 'Forged Name',
    }),
  });
  assert.equal(rookiePick.status, 200);
  const storedRookie = (rookiePick.body.state as LeagueDynamicState).draft.picks['1'];
  assert.equal(storedRookie?.playerName, 'T. Rookie');
  assert.equal(storedRookie?.proTeam, 'FA');
  assert.deepEqual(storedRookie?.positions, ['PG']);
});

test('rejects a changed candidate and a stale player-pool preview', async () => {
  const candidate = playerPoolCandidate();
  const preview = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);

  const changed = structuredClone(candidate);
  changed.players[0]!.proTeam = 'ZZZ';
  const mismatch = await request('/api/league/player-pool/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...changed,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(mismatch.status, 409);
  assert.match(String(mismatch.body.error), /no longer matches/);

  const accepted = await request('/api/league/player-pool/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(accepted.status, 200);

  const stale = await request('/api/league/player-pool/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(stale.status, 409);
  assert.match(String(stale.body.error), /changed; preview again/);
});

test('rejects player-pool acceptance after the draft starts', async () => {
  const candidate = playerPoolCandidate();
  const preview = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);

  await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  const started = await request('/api/league/draft/start', {
    method: 'POST',
    headers: auth(commissioner),
  });
  assert.equal(started.status, 200);
  assert.equal(
    (started.body.state as LeagueDynamicState).draft.playerPoolSnapshotId,
    `dataset-${dataset.season}`,
  );

  const rejected = await request('/api/league/player-pool/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.reason, 'draft-started');
});

test('serializes player-pool acceptance against draft start', async () => {
  const candidate = playerPoolCandidate();
  const preview = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);
  await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });

  const [start, accept] = await Promise.all([
    request('/api/league/draft/start', {
      method: 'POST',
      headers: auth(commissioner),
    }),
    request('/api/league/player-pool/accept', {
      method: 'POST',
      headers: auth(commissioner),
      body: JSON.stringify({
        ...candidate,
        expectedCurrentSnapshotId: preview.body.currentSnapshotId,
        fingerprint: preview.body.fingerprint,
      }),
    }),
  ]);

  assert.equal(start.status, 200);
  assert.equal([200, 409].includes(accept.status), true);
  const final = (await store.getState()).state;
  assert.notEqual(final.draft.startedAt, null);
  assert.equal(
    final.draft.playerPoolSnapshotId,
    final.playerPool?.activeSnapshotId ?? `dataset-${dataset.season}`,
  );
});

test('rejects an unprotected committed player removed from the pinned pool', async () => {
  const removed = dataset.players.find(
    (player) => player.fantasyTeam === null && !player.keeper.contract?.currentOwner,
  );
  assert.ok(removed?.espnId);
  const candidate = playerPoolCandidate();
  candidate.players = candidate.players.filter((player) => player.espnId !== removed.espnId);
  const preview = await request('/api/league/player-pool/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(candidate),
  });
  assert.equal(preview.status, 200);
  assert.equal(
    (preview.body.preview as { removed: Array<{ espnId: number }> }).removed
      .some((player) => player.espnId === removed.espnId),
    true,
  );
  const accepted = await request('/api/league/player-pool/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      ...candidate,
      expectedCurrentSnapshotId: preview.body.currentSnapshotId,
      fingerprint: preview.body.fingerprint,
    }),
  });
  assert.equal(accepted.status, 200);
  await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  await request('/api/league/draft/start', {
    method: 'POST',
    headers: auth(commissioner),
  });

  const rejected = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({ overallPick: 1, playerKey: removed.key }),
  });
  assert.equal(rejected.status, 400);
  assert.match(String(rejected.body.error), /Unknown player/);
});

// ─── Team names ──────────────────────────────────────────────────────────────

function renamedTeamCandidate(name = 'Team Clown Baby') {
  const renamed = dataset.teams[0];
  assert.ok(renamed);
  return {
    candidate: {
      sourceSeason: 2026,
      fetchedAt: '2026-09-05T12:00:00.000Z',
      teams: dataset.teams.map((team) => ({
        espnTeamId: team.espnTeamId,
        name: team.espnTeamId === renamed.espnTeamId ? name : `  ${team.espnTeamName} `,
        ownerName: team.fullName,
      })),
    },
    renamed,
  };
}

async function teamNameFingerprint(candidate: unknown): Promise<string> {
  const { state } = await store.getState();
  return teamNames.prepareTeamNameCandidate(
    state,
    teamNames.parseTeamNameCandidate(candidate),
  ).fingerprint;
}

test('lets only the commissioner fetch or save team names', async () => {
  const fetchPreview = await request('/api/league/team-names/fetch-preview', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({}),
  });
  assert.equal(fetchPreview.status, 403);

  const { candidate } = renamedTeamCandidate();
  const fingerprint = await teamNameFingerprint(candidate);
  const anonymous = await request('/api/league/team-names/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...candidate, fingerprint }),
  });
  assert.equal(anonymous.status, 401);

  const member = await request('/api/league/team-names/accept', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({ ...candidate, fingerprint }),
  });
  assert.equal(member.status, 403);
  assert.equal((await store.getState()).state.teamNames, undefined);
});

test('accepting a rename changes the name GET /state reports', async () => {
  const { candidate, renamed } = renamedTeamCandidate();
  const fingerprint = await teamNameFingerprint(candidate);

  const before = await request('/api/league/state');
  assert.equal((before.body.state as LeagueDynamicState).teamNames, undefined);

  const accepted = await request('/api/league/team-names/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ ...candidate, fingerprint }),
  });
  assert.equal(accepted.status, 200);

  const after = await request('/api/league/state');
  const stored = (after.body.state as LeagueDynamicState).teamNames ?? {};
  assert.equal(stored[renamed.owner], 'Team Clown Baby');
  for (const team of dataset.teams) {
    if (team.owner === renamed.owner) continue;
    assert.equal(stored[team.owner], team.espnTeamName);
  }

  const audit = await store.readAudit(5);
  assert.equal(audit[0]?.action, 'team_names.accepted');
});

test('refuses names nobody previewed and a fetch that changed nothing', async () => {
  const { candidate } = renamedTeamCandidate();
  const stale = await request('/api/league/team-names/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ ...candidate, fingerprint: 'sha256:not-the-one' }),
  });
  assert.equal(stale.status, 409);
  assert.match(String(stale.body.error), /fetch them again/);
  assert.equal((await store.getState()).state.teamNames, undefined);

  const unchanged = {
    sourceSeason: 2026,
    fetchedAt: '2026-09-05T12:00:00.000Z',
    teams: dataset.teams.map((team) => ({
      espnTeamId: team.espnTeamId,
      name: `${team.espnTeamName}  `,
      ownerName: team.fullName,
    })),
  };
  const quiet = await request('/api/league/team-names/accept', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ ...unchanged, fingerprint: await teamNameFingerprint(unchanged) }),
  });
  assert.equal(quiet.status, 409);
  assert.match(String(quiet.body.error), /Nothing changed/);
});

test('CLOCK: anyone but the picker may call it once every five picks, the commish can pause, and picks keep their time', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  await replaceState(next);
  const started = await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) });
  assert.equal(started.status, 200);
  const clockAfterStart = (started.body.state as LeagueDynamicState).draft.clock;
  assert.ok(clockAfterStart?.pickStartedAt, 'the first team is on the pick from the start');
  assert.equal(clockAfterStart?.call, null);

  // Nobody may call CLOCK in the first two minutes of a round-one pick, so back-date each pick's start.
  const backdate = async () => {
    await store.mutateState((draft) => {
      if (draft.draft.clock) draft.draft.clock = { ...draft.draft.clock, pickStartedAt: new Date(Date.now() - 125_000).toISOString() };
    });
  };
  const early = await request('/api/league/draft/clock/call', { method: 'POST', headers: auth('Ryan') });
  assert.equal(early.status, 409);
  assert.match(String(early.body.error), /CLOCK opens in/);
  await backdate();

  const pick = (owner: string, overallPick: number, index: number) => request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ overallPick, playerKey: dataset.players[index]!.key, playerName: dataset.players[index]!.name }),
  });
  const call = (owner: string) => request('/api/league/draft/clock/call', { method: 'POST', headers: auth(owner) });

  // Pick 1 is Joel's. Joel cannot call it on himself; Ryan can; nobody can twice.
  const own = await call('Joel');
  assert.equal(own.status, 403);
  assert.match(String(own.body.error), /your own pick/);
  const ryanCalls = await call('Ryan');
  assert.equal(ryanCalls.status, 200);
  assert.equal((ryanCalls.body.state as LeagueDynamicState).draft.clock?.call?.by, 'Ryan');
  const twice = await call(commissioner);
  assert.equal(twice.status, 409);
  assert.match(String(twice.body.error), /already running/);

  // Joel picks: the pick keeps its seconds and who called CLOCK, and the next timer starts clean.
  const first = await pick('Joel', 1, 0);
  assert.equal(first.status, 200);
  await backdate();
  const afterFirst = (first.body.state as LeagueDynamicState).draft;
  assert.equal(typeof afterFirst.picks['1']?.seconds, 'number');
  assert.equal(afterFirst.picks['1']?.clockCalledBy, 'Ryan');
  assert.equal(afterFirst.clock?.call, null);
  assert.ok(afterFirst.clock?.pickStartedAt);

  // Pick 2 is Ryan's. Joel calls it; Ryan picks with no call recorded against Joel's cooldown yet.
  assert.equal((await call('Ryan')).status, 403);
  assert.equal((await call('Joel')).status, 200);
  const second = await pick('Ryan', 2, 1);
  assert.equal(second.status, 200);
  await backdate();
  assert.equal((second.body.state as LeagueDynamicState).draft.picks['2']?.clockCalledBy, 'Joel');

  // Pick 3: Ryan called on pick 1, so he waits three more; Joel called on pick 2, four more. The commish never waits.
  const ryanAgain = await call('Ryan');
  assert.equal(ryanAgain.status, 409);
  assert.match(String(ryanAgain.body.error), /again in 3 picks/);
  const joelAgain = await call('Joel');
  assert.equal(joelAgain.status, 409);
  assert.match(String(joelAgain.body.error), /again in 4 picks/);

  // Pause is the commissioner's. Nobody can call CLOCK while paused.
  assert.equal((await request('/api/league/draft/clock/pause', { method: 'POST', headers: auth('Joel') })).status, 403);
  const paused = await request('/api/league/draft/clock/pause', { method: 'POST', headers: auth(commissioner) });
  assert.equal(paused.status, 200);
  assert.ok((paused.body.state as LeagueDynamicState).draft.clock?.pausedAt);
  const whilePaused = await call(commissioner);
  assert.equal(whilePaused.status, 409);
  assert.match(String(whilePaused.body.error), /paused/);
  const resumed = await request('/api/league/draft/clock/resume', { method: 'POST', headers: auth(commissioner) });
  assert.equal(resumed.status, 200);
  const clock = (resumed.body.state as LeagueDynamicState).draft.clock;
  assert.equal(clock?.pausedAt, null);
  assert.ok((clock?.pausedMs ?? -1) >= 0);
  await backdate();
  assert.equal((await call(commissioner)).status, 200);

  // Clearing a pick restarts that team's timer without a call.
  const cleared = await request('/api/league/draft/pick/2', { method: 'DELETE', headers: auth(commissioner) });
  assert.equal(cleared.status, 200);
  assert.equal((cleared.body.state as LeagueDynamicState).draft.clock?.call, null);
});

test('a called clock that runs out yields the pick: the next team is up, the skipped team fills in any time', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  await replaceState(next);
  assert.equal((await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);
  const pick = (owner: string, overallPick: number, index: number) => request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ overallPick, playerKey: dataset.players[index]!.key, playerName: dataset.players[index]!.name }),
  });
  // Joel is on pick 1. Ryan calls CLOCK (after the two-minute wait); the 30 seconds pass with nobody picking.
  await store.mutateState((draft) => {
    if (draft.draft.clock) draft.draft.clock = { ...draft.draft.clock, pickStartedAt: new Date(Date.now() - 125_000).toISOString() };
  });
  assert.equal((await request('/api/league/draft/clock/call', { method: 'POST', headers: auth('Ryan') })).status, 200);
  // Time is still left: a report changes nothing.
  const tooSoon = await request('/api/league/draft/clock/expire', { method: 'POST', headers: auth('Joel') });
  assert.equal(tooSoon.status, 200);
  assert.equal((tooSoon.body.state as LeagueDynamicState).draft.skipped, undefined);
  await store.mutateState((draft) => {
    const clock = draft.draft.clock!;
    draft.draft.clock = { ...clock, call: { ...clock.call!, atElapsedMs: clock.call!.atElapsedMs - 31_000 } };
  });
  const expired = await request('/api/league/draft/clock/expire', { method: 'POST', headers: auth('Joel') });
  assert.equal(expired.status, 200);
  const after = (expired.body.state as LeagueDynamicState).draft;
  assert.equal(after.skipped?.['1']?.calledBy, 'Ryan');
  assert.equal(after.clock?.call, null, 'the next team starts with a clean clock');

  // Ryan (pick 2) is on the clock now. Joel cannot take pick 2, but can fill his own pick 1 whenever.
  const joelOnTwo = await pick('Joel', 2, 0);
  assert.equal(joelOnTwo.status, 403);
  const ryanOnOne = await pick('Ryan', 1, 0);
  assert.equal(ryanOnOne.status, 403);
  const ryanPicks = await pick('Ryan', 2, 1);
  assert.equal(ryanPicks.status, 200);
  const joelLate = await pick('Joel', 1, 0);
  assert.equal(joelLate.status, 200);
  const done = (joelLate.body.state as LeagueDynamicState).draft;
  assert.equal(done.picks['1']?.skipped, true);
  assert.equal(done.picks['1']?.clockCalledBy, 'Ryan');
  assert.equal(done.picks['1']?.seconds, undefined, 'a late pick has no honest time');
  assert.equal(done.skipped?.['1'], undefined);
  // Pick 3 is on the clock and Joel's late pick did not disturb it.
  assert.equal(done.clock?.pickStartedAt, (ryanPicks.body.state as LeagueDynamicState).draft.clock?.pickStartedAt);

  // Clearing the late pick makes it yielded again, not on the clock.
  const cleared = await request('/api/league/draft/pick/1', { method: 'DELETE', headers: auth(commissioner) });
  assert.equal(cleared.status, 200);
  const back = (cleared.body.state as LeagueDynamicState).draft;
  assert.equal(back.skipped?.['1']?.calledBy, 'Ryan');
  assert.equal(back.clock?.pickStartedAt, done.clock?.pickStartedAt);
});

test('a write-in pick lands with its own key, and cannot double a pool player or itself', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  next.draft.startedAt = '2026-10-18T21:00:00.000Z';
  await replaceState(next);
  const writeIn = (owner: string, overallPick: number, name: string, proTeam = 'DAL', positions = ['SF', 'PF']) => request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ overallPick, playerKey: 'writein', playerName: name, proTeam, positions, writeIn: true }),
  });
  const bad = await writeIn('Joel', 1, 'Some Rookie', 'Dallas');
  assert.equal(bad.status, 400);
  assert.match(String(bad.body.error), /two to four letter code/);
  const pooled = dataset.players[0]!;
  const inPool = await writeIn('Joel', 1, pooled.fullName ?? pooled.name);
  assert.equal(inPool.status, 409);
  assert.match(String(inPool.body.error), /in the player pool/);
  const ok = await writeIn('Joel', 1, 'Some Rookie');
  assert.equal(ok.status, 200);
  const pick = (ok.body.state as LeagueDynamicState).draft.picks['1'];
  assert.equal(pick?.playerKey, 'writein-some-rookie-dal');
  assert.equal(pick?.playerName, 'Some Rookie');
  assert.deepEqual(pick?.positions, ['SF', 'PF']);
  assert.equal(pick?.proTeam, 'dal');
  const again = await writeIn('Ryan', 2, 'some rookie');
  assert.equal(again.status, 409);
  assert.match(String(again.body.error), /already on the board/);
});

test('test draft: members pick in a shared copy that never touches the league', async () => {
  const joelPlayer = dataset.players.find((player) => player.fantasyTeam === 'Joel');
  assert.ok(joelPlayer);
  const live = cleanState();
  live.keepers = { Joel: [{ playerKey: joelPlayer.key, playerName: joelPlayer.name }] };
  await replaceState(live);
  let testStartedAt = '';
  const inTest = (owner: keyof typeof pins) => ({ ...auth(owner), 'x-test-draft': '1', 'x-test-draft-started-at': testStartedAt });

  const memberStart = await request('/api/league/test-draft/start', { method: 'POST', headers: auth('Joel') });
  assert.equal(memberStart.status, 403);
  const started = await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) });
  assert.equal(started.status, 200);
  testStartedAt = (started.body.state as LeagueDynamicState).draft.startedAt!;
  assert.deepEqual((started.body.meta as { testDraft: unknown }).testDraft, { running: true, serving: true });

  // Secret keepers stay secret: the copy has none, and the board is open to all.
  const joelView = await request('/api/league/state', { headers: inTest('Joel') });
  const testState = joelView.body.state as LeagueDynamicState;
  assert.deepEqual(testState.keepers, {});
  assert.ok(testState.draft.startedAt);
  const liveView = await request('/api/league/state', { headers: auth('Joel') });
  assert.deepEqual((liveView.body.meta as { testDraft: unknown }).testDraft, { running: true, serving: false });

  const first = dataset.players[0];
  const second = dataset.players[1];
  assert.ok(first && second);
  const joelPick = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: inTest('Joel'),
    body: JSON.stringify({ overallPick: 1, playerKey: first.key, playerName: first.name }),
  });
  assert.equal(joelPick.status, 200);
  // The commish enters Ryan's pick from his own seat.
  const commishPick = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: inTest(commissioner),
    body: JSON.stringify({ overallPick: 2, playerKey: second.key, playerName: second.name }),
  });
  assert.equal(commishPick.status, 200);
  assert.equal(Object.keys((commishPick.body.state as LeagueDynamicState).draft.picks).length, 2);

  const league = await store.getState();
  assert.equal(league.state.draft.startedAt, null);
  assert.deepEqual(league.state.draft.picks, {});
  assert.equal(league.state.keepers.Joel?.length, 1);

  // A joined device cannot change the league by mistake.
  const realStart = await request('/api/league/draft/start', { method: 'POST', headers: inTest(commissioner) });
  assert.equal(realStart.status, 409);

  const ended = await request('/api/league/test-draft/end', { method: 'POST', headers: auth(commissioner) });
  assert.equal(ended.status, 200);
  const afterEnd = await request('/api/league/state', { headers: inTest('Joel') });
  assert.deepEqual((afterEnd.body.meta as { testDraft: unknown }).testDraft, { running: false, serving: false });
  const latePick = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: inTest('Ryan'),
    body: JSON.stringify({ overallPick: 3, playerKey: first.key, playerName: first.name }),
  });
  assert.equal(latePick.status, 410);
});

test('test draft: starting the real draft ends it for every joined device', async () => {
  const live = cleanState();
  live.keepersRevealed = true;
  await replaceState(live);
  assert.equal((await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);
  const joined = { ...auth('Joel'), 'x-test-draft': '1' };
  const before = await request('/api/league/state', { headers: joined });
  assert.equal((before.body.meta as { testDraft: { serving: boolean } }).testDraft.serving, true);

  assert.equal((await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);
  assert.equal(await store.getTestDraft(), null);
  const after = await request('/api/league/state', { headers: joined });
  assert.deepEqual((after.body.meta as { testDraft: unknown }).testDraft, { running: false, serving: false });
  assert.ok((after.body.state as LeagueDynamicState).draft.startedAt);
});

test('test draft: closed once the real draft starts', async () => {
  const live = cleanState();
  live.keepersRevealed = true;
  live.draft.startedAt = '2026-10-18T21:00:00.000Z';
  await replaceState(live);
  const blocked = await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) });
  assert.equal(blocked.status, 409);
});

test('draft room: each side lists who checked in, and the test has its own room', async () => {
  const live = cleanState();
  live.keepersRevealed = true;
  await replaceState(live);
  assert.equal((await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);

  const anonymous = await request('/api/league/draft-room', { method: 'POST' });
  assert.equal(anonymous.status, 401);
  await request('/api/league/draft-room', { method: 'POST', headers: auth('Joel') });
  const ryanInTest = await request('/api/league/draft-room', { method: 'POST', headers: { ...auth('Ryan'), 'x-test-draft': '1' } });
  assert.deepEqual(ryanInTest.body, { room: 'test', owners: ['Ryan'] });
  const commishInLeague = await request('/api/league/draft-room', { method: 'POST', headers: auth(commissioner) });
  assert.equal(commishInLeague.body.room, 'league');
  assert.deepEqual([...(commishInLeague.body.owners as string[])].sort(), ['Joel', commissioner].sort());

  await request('/api/league/test-draft/end', { method: 'POST', headers: auth(commissioner) });
});


test('test writes reject missing and stale sessions, including after restart and real start', async () => {
  const opened = await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) });
  assert.equal(opened.status, 200);
  const oldAt = (opened.body.state as LeagueDynamicState).draft.startedAt!;
  const staleHeaders = { ...auth(commissioner), 'x-test-draft': '1', 'x-test-draft-started-at': oldAt };
  const first = dataset.players[0]!;
  const pickBody = JSON.stringify({ overallPick: 1, playerKey: first.key, playerName: first.name });
  const missing = await request('/api/league/draft/pick', {
    method: 'POST', headers: { ...auth(commissioner), 'x-test-draft': '1' }, body: pickBody,
  });
  assert.equal(missing.status, 409);
  const restarted = await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) });
  assert.equal(restarted.status, 200);
  assert.notEqual((restarted.body.state as LeagueDynamicState).draft.startedAt, oldAt);
  for (const [method, route] of [
    ['POST', '/draft/pick'], ['DELETE', '/draft/pick/1'],
    ['POST', '/draft/clock/call'], ['POST', '/draft/clock/expire'],
    ['POST', '/draft/clock/pause'], ['POST', '/draft/clock/resume'],
  ]) {
    const result = await request('/api/league' + route, { method, headers: staleHeaders, ...(route === '/draft/pick' ? { body: pickBody } : {}) });
    assert.equal(result.status, 409, route);
  }
  assert.deepEqual((await store.getTestDraft())!.state.draft.picks, {});
  await store.mutateState((draft) => { draft.keepersRevealed = true; });
  assert.equal((await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);
  const late = await request('/api/league/draft/pick', { method: 'POST', headers: staleHeaders, body: pickBody });
  assert.equal(late.status, 410);
  assert.deepEqual((await store.getState()).state.draft.picks, {});
});

test('48 simultaneous pick submissions cannot overwrite a pick or draft a player twice', async () => {
  await store.mutateState((draft) => { draft.keepersRevealed = true; });
  assert.equal((await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);
  const replies = await Promise.all(Array.from({ length: 48 }, (_, i) => {
    const player = dataset.players[i]!;
    return request('/api/league/draft/pick', {
      method: 'POST', headers: auth(commissioner),
      body: JSON.stringify({ overallPick: 1, playerKey: player.key, playerName: player.name }),
    });
  }));
  assert.equal(replies.filter((reply) => reply.status === 200).length, 1);
  assert.equal(replies.filter((reply) => reply.status === 409).length, 47);
  const won = (await store.getState()).state.draft.picks['1']!;
  const duplicates = await Promise.all(Array.from({ length: 24 }, () => request('/api/league/draft/pick', {
    method: 'POST', headers: auth(commissioner),
    body: JSON.stringify({ overallPick: 2, playerKey: won.playerKey, playerName: won.playerName }),
  })));
  assert.ok(duplicates.every((reply) => reply.status === 409));
  const state = (await store.getState()).state;
  assert.equal(Object.keys(state.draft.picks).length, 1);
  assert.deepEqual(state.draft.picks['1'], won);
  const owners = ['Joel', 'Ryan', commissioner];
  const presence = await Promise.all(Array.from({ length: 48 }, (_, i) => request('/api/league/draft-room', {
    method: 'POST', headers: auth(owners[i % owners.length]!),
  })));
  assert.ok(presence.every((reply) => reply.status === 200));
  const present = await request('/api/league/draft-room', { method: 'POST', headers: auth(commissioner) });
  assert.deepEqual([...(present.body.owners as string[])].sort(), [...owners].sort());
});

// ─── Private lists and auto picks ────────────────────────────────────────────

/** The player the board's own order wants least, so a list naming him is unmistakable. */
function leastWanted() {
  const entries = rankBoard(dataset.players, null).entries.filter((entry) => entry.source !== 'none');
  const player = entries[entries.length - 1]?.player;
  assert.ok(player);
  return player;
}

test('a draft list is its owner\'s alone: not another member\'s, not the commissioner\'s, not acting as them', async () => {
  const weak = leastWanted();
  const saved = await request('/api/league/draft-list', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({ text: `1. ${weak.fullName ?? weak.name}\n2. Nobody Real\n\n3. ${weak.fullName ?? weak.name}` }),
  });
  assert.equal(saved.status, 200);
  const list = saved.body.list as { entries: Array<{ rank: number; name: string; playerKey: string | null }> };
  assert.equal(list.entries.length, 2, 'a repeated name counts once');
  assert.equal(list.entries[0].playerKey, weak.key);
  assert.equal(list.entries[1].playerKey, null);

  const own = await request('/api/league/draft-list', { headers: auth('Joel') });
  assert.equal((own.body.list as { entries: unknown[] }).entries.length, 2);
  const ryan = await request('/api/league/draft-list', { headers: auth('Ryan') });
  assert.equal(ryan.body.list, null);
  const commish = await request('/api/league/draft-list', { headers: auth(commissioner) });
  assert.equal(commish.body.list, null);

  const seat = await request('/api/league/act-as/Joel', { method: 'POST', headers: auth(commissioner) });
  assert.equal(seat.status, 200);
  const asJoel = { 'content-type': 'application/json', 'x-session': String(seat.body.session) };
  const peek = await request('/api/league/draft-list', { headers: asJoel });
  assert.equal(peek.status, 403);
  const overwrite = await request('/api/league/draft-list', { method: 'PUT', headers: asJoel, body: JSON.stringify({ text: 'x' }) });
  assert.equal(overwrite.status, 403);
  assert.equal((await store.getDraftList(dataset.season, 'Joel'))?.entries.length, 2);

  // The commissioner learns who has a list, never what is on it.
  const status = await request('/api/league/draft/auto', { headers: auth(commissioner) });
  assert.deepEqual(status.body, { autoOwners: [], listOwners: ['Joel'] });
  assert.equal((await request('/api/league/draft/auto', { headers: auth('Joel') })).status, 403);

  const cleared = await request('/api/league/draft-list', { method: 'DELETE', headers: auth('Joel') });
  assert.equal(cleared.body.list, null);
  assert.equal(await store.getDraftList(dataset.season, 'Joel'), null);
  const nothing = await request('/api/league/draft-list', { method: 'PUT', headers: auth('Joel'), body: JSON.stringify({ text: '\n\n' }) });
  assert.equal(nothing.body.list, null);
});

test('a team on auto picks from its list, then the board order, and the next team on auto follows', async () => {
  const weak = leastWanted();
  await request('/api/league/draft-list', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({ text: `${weak.fullName ?? weak.name}` }),
  });
  const next = cleanState();
  next.keepersRevealed = true;
  next.draft.startedAt = '2026-10-18T21:00:00.000Z';
  await replaceState(next);
  const board = buildDraftBoard(dataset, next);
  assert.equal(board[0].pick.currentOwner, 'Joel');
  const second = board[1].pick.currentOwner;
  const third = board[2].pick.currentOwner;

  const memberTry = await request('/api/league/draft/auto/Joel', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ on: true }) });
  assert.equal(memberTry.status, 403);
  const unknown = await request('/api/league/draft/auto/Nobody', { method: 'POST', headers: auth(commissioner), body: JSON.stringify({ on: true }) });
  assert.equal(unknown.status, 404);

  // Third on auto before his turn: nothing happens yet.
  const thirdOn = await request(`/api/league/draft/auto/${third}`, { method: 'POST', headers: auth(commissioner), body: JSON.stringify({ on: true }) });
  assert.equal(thirdOn.status, 200);
  assert.deepEqual((thirdOn.body.state as LeagueDynamicState).draft.picks, {});

  // Joel on auto while on the clock: his pick lands now, from his list.
  const joelOn = await request('/api/league/draft/auto/Joel', { method: 'POST', headers: auth(commissioner), body: JSON.stringify({ on: true }) });
  assert.equal(joelOn.status, 200);
  const afterJoel = (joelOn.body.state as LeagueDynamicState).draft;
  assert.deepEqual(afterJoel.autoOwners, [third, 'Joel']);
  assert.equal(afterJoel.picks['1']?.playerKey, weak.key);
  assert.equal(afterJoel.picks['1']?.auto, true);
  assert.equal(afterJoel.picks['1']?.enteredBy, 'Joel');
  assert.equal(afterJoel.picks['2'], undefined, 'the second team picks for itself');

  // Second picks by hand; third is on auto with no list, so the board's best goes next.
  const best = rankBoard(dataset.players.filter((player) => player.key !== weak.key), null).entries[0].player;
  const pick2 = dataset.players.find((player) => player.key !== weak.key && player.key !== best.key);
  assert.ok(pick2);
  const manual = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth(second as keyof typeof pins),
    body: JSON.stringify({ overallPick: 2, playerKey: pick2.key, playerName: pick2.name }),
  });
  assert.equal(manual.status, 200, JSON.stringify(manual.body));
  const afterSecond = (manual.body.state as LeagueDynamicState).draft;
  assert.equal(afterSecond.picks['2']?.playerKey, pick2.key);
  assert.equal(afterSecond.picks['3']?.auto, true);
  assert.equal(afterSecond.picks['3']?.enteredBy, third);
  assert.ok(afterSecond.picks['3']?.playerKey, 'the third team got a pick from the board order');
  assert.notEqual(afterSecond.picks['3']?.playerKey, weak.key);
  assert.equal(afterSecond.picks['4'], undefined);
  assert.equal(buildDraftBoard(dataset, manual.body.state as LeagueDynamicState).find((cell) => cell.onClock)?.pick.overall, 4);

  // Off again stops it.
  const joelOff = await request('/api/league/draft/auto/Joel', { method: 'POST', headers: auth(commissioner), body: JSON.stringify({ on: false }) });
  assert.deepEqual((joelOff.body.state as LeagueDynamicState).draft.autoOwners, [third]);

  // A queue the owner set mid-draft beats the saved rankings: undo Joel's pick,
  // queue someone else, put him back on auto.
  assert.equal((await request('/api/league/draft/pick/1', { method: 'DELETE', headers: auth(commissioner) })).status, 200);
  const queued = dataset.players.find((player) => player.key !== weak.key && player.key !== pick2.key && player.key !== afterSecond.picks['3']?.playerKey)!;
  await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: [queued.key] }) });
  const again = await request('/api/league/draft/auto/Joel', { method: 'POST', headers: auth(commissioner), body: JSON.stringify({ on: true }) });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal((again.body.state as LeagueDynamicState).draft.picks['1']?.playerKey, queued.key);
  await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: [] }) });
});

test('auto waits while the clock is paused, and picks when it resumes', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  next.draft.startedAt = '2026-10-18T21:00:00.000Z';
  next.draft.clock = { pickStartedAt: next.draft.startedAt, pausedAt: next.draft.startedAt, pausedMs: 0, call: null };
  await replaceState(next);
  const on = await request('/api/league/draft/auto/Joel', { method: 'POST', headers: auth(commissioner), body: JSON.stringify({ on: true }) });
  assert.equal(on.status, 200);
  assert.deepEqual((on.body.state as LeagueDynamicState).draft.picks, {});
  const resumed = await request('/api/league/draft/clock/resume', { method: 'POST', headers: auth(commissioner) });
  assert.equal(resumed.status, 200);
  assert.equal((resumed.body.state as LeagueDynamicState).draft.picks['1']?.auto, true);
});

test('in the test draft an auto pick reads the member\'s rankings, and the league stays untouched', async () => {
  const weak = leastWanted();
  await request('/api/league/draft-list', { method: 'PUT', headers: auth('Joel'), body: JSON.stringify({ text: weak.fullName ?? weak.name }) });
  const live = cleanState();
  live.keepersRevealed = true;
  await replaceState(live);
  const started = await request('/api/league/test-draft/start', { method: 'POST', headers: auth(commissioner) });
  assert.equal(started.status, 200);
  const startedAt = (started.body.state as LeagueDynamicState).draft.startedAt!;
  const inTest = { ...auth(commissioner), 'x-test-draft': '1', 'x-test-draft-started-at': startedAt };

  const status = await request('/api/league/draft/auto', { headers: inTest });
  assert.deepEqual(status.body, { autoOwners: [], listOwners: ['Joel'] });
  const on = await request('/api/league/draft/auto/Joel', { method: 'POST', headers: inTest, body: JSON.stringify({ on: true }) });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  const pick = (on.body.state as LeagueDynamicState).draft.picks['1'];
  assert.equal(pick?.auto, true);
  assert.equal(pick?.playerKey, weak.key, 'the rehearsal takes the same player draft day would');

  // The league itself is untouched.
  const league = await store.getState();
  assert.deepEqual(league.state.draft.picks, {});
  assert.equal(league.state.draft.autoOwners, undefined);
  await request('/api/league/test-draft/end', { method: 'POST', headers: auth(commissioner) });
});

test('a called clock that runs out takes the top queued player still there', async () => {
  const next = cleanState();
  next.keepersRevealed = true;
  await replaceState(next);
  assert.equal((await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);
  const [first, second] = [dataset.players[0]!, dataset.players[1]!];
  const saved = await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: [first.key, second.key] }) });
  assert.equal(saved.status, 200);
  assert.equal((await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: 'nope' }) })).status, 400);

  await store.mutateState((draft) => {
    if (draft.draft.clock) draft.draft.clock = { ...draft.draft.clock, pickStartedAt: new Date(Date.now() - 125_000).toISOString() };
  });
  assert.equal((await request('/api/league/draft/clock/call', { method: 'POST', headers: auth('Ryan') })).status, 200);
  await store.mutateState((draft) => {
    const clock = draft.draft.clock!;
    draft.draft.clock = { ...clock, call: { ...clock.call!, atElapsedMs: clock.call!.atElapsedMs - 31_000 } };
  });
  const expired = await request('/api/league/draft/clock/expire', { method: 'POST', headers: auth('Ryan') });
  assert.equal(expired.status, 200);
  const after = (expired.body.state as LeagueDynamicState).draft;
  assert.equal(after.picks['1']?.playerKey, first.key);
  assert.equal(after.picks['1']?.enteredBy, 'Joel (queue)');
  assert.equal(after.picks['1']?.clockCalledBy, 'Ryan');
  assert.equal(after.skipped?.['1'], undefined, 'a queued pick is not a skipped one');
  assert.equal(after.clock?.call, null);

  await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: [] }) });
});

test('a called clock that runs out reads the owner\'s rankings when they never touched their queue', async () => {
  const weak = leastWanted();
  await request('/api/league/draft-list', { method: 'PUT', headers: auth('Joel'), body: JSON.stringify({ text: weak.fullName ?? weak.name }) });
  const next = cleanState();
  next.keepersRevealed = true;
  await replaceState(next);
  assert.equal((await request('/api/league/draft/start', { method: 'POST', headers: auth(commissioner) })).status, 200);

  await store.mutateState((draft) => {
    if (draft.draft.clock) draft.draft.clock = { ...draft.draft.clock, pickStartedAt: new Date(Date.now() - 125_000).toISOString() };
  });
  assert.equal((await request('/api/league/draft/clock/call', { method: 'POST', headers: auth('Ryan') })).status, 200);
  await store.mutateState((draft) => {
    const clock = draft.draft.clock!;
    draft.draft.clock = { ...clock, call: { ...clock.call!, atElapsedMs: clock.call!.atElapsedMs - 31_000 } };
  });
  const expired = await request('/api/league/draft/clock/expire', { method: 'POST', headers: auth('Ryan') });
  assert.equal(expired.status, 200);
  const after = (expired.body.state as LeagueDynamicState).draft;
  assert.equal(after.picks['1']?.playerKey, weak.key, 'the top ranked player, not a yield');
  assert.equal(after.picks['1']?.enteredBy, 'Joel (queue)');

  // A queue the owner did set wins over the rankings.
  const other = dataset.players.find((player) => player.key !== weak.key)!;
  await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: [other.key] }) });
  await request('/api/league/draft/queue', { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ keys: [] }) });
});

test('a rankings steward enters another member\'s rankings; the commish and the rest cannot', async () => {
  const weak = leastWanted();
  const access = await request('/api/league/draft-list/access', { headers: auth('Dustin') });
  assert.equal(access.status, 200);
  const stewardFor = access.body.stewardFor as string[];
  assert.ok(stewardFor.includes('Joel') && !stewardFor.includes('Dustin'), 'everyone but himself');
  assert.deepEqual((await request('/api/league/draft-list/access', { headers: auth('Joel') })).body, { stewardFor: [] });
  assert.deepEqual((await request('/api/league/draft-list/access', { headers: auth(commissioner) })).body, { stewardFor: [] });

  const saved = await request('/api/league/draft-list/for/Joel', {
    method: 'PUT',
    headers: auth('Dustin'),
    body: JSON.stringify({ text: weak.fullName ?? weak.name }),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.owner, 'Joel');
  assert.equal((await store.getDraftList(dataset.season, 'Joel'))?.entries[0]?.playerKey, weak.key);
  const joelSees = await request('/api/league/draft-list', { headers: auth('Joel') });
  assert.equal((joelSees.body.list as { entries: unknown[] }).entries.length, 1, 'it is Joel\'s list now');
  const read = await request('/api/league/draft-list/for/Joel', { headers: auth('Dustin') });
  assert.equal((read.body.list as { entries: unknown[] }).entries.length, 1);

  // Not for the commish, not for an ordinary member, not for his own team, not for the commish acting as him.
  assert.equal((await request('/api/league/draft-list/for/Joel', { headers: auth(commissioner) })).status, 403);
  assert.equal((await request('/api/league/draft-list/for/Joel', { headers: auth('Ryan') })).status, 403);
  assert.equal((await request('/api/league/draft-list/for/Dustin', { headers: auth('Dustin') })).status, 400);
  assert.equal((await request('/api/league/draft-list/for/Nobody', { headers: auth('Dustin') })).status, 404);
  const seat = await request('/api/league/act-as/Dustin', { method: 'POST', headers: auth(commissioner) });
  const asDustin = { 'content-type': 'application/json', 'x-session': String(seat.body.session) };
  assert.equal((await request('/api/league/draft-list/for/Joel', { headers: asDustin })).status, 403);
  assert.deepEqual((await request('/api/league/draft-list/access', { headers: asDustin })).body, { stewardFor: [] });

  // The log says he saved for Joel and how many names, never which.
  const audit = await request('/api/league/audit?limit=5', { headers: auth(commissioner) });
  const rows = JSON.stringify(audit.body);
  assert.match(rows, /draft_list\.saved_for/);
  assert.ok(!rows.includes(weak.fullName ?? weak.name), 'no player name in the log');

  const cleared = await request('/api/league/draft-list/for/Joel', { method: 'DELETE', headers: auth('Dustin') });
  assert.equal(cleared.status, 200);
  assert.equal(await store.getDraftList(dataset.season, 'Joel'), null);
});

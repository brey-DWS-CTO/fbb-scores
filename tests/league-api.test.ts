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

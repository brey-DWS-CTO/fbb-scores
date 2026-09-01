import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawHistory from '../src/data/source/league-history-2027.json' with { type: 'json' };
import {
  historyFingerprint,
  type LeagueHistory,
} from '../src/lib/league/history.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const seed = rawHistory as unknown as LeagueHistory;
const SEASON = seed.season;

const commissioner = 'Brey';
const pins = { [commissioner]: '9100', Joel: '1100' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

function auth(owner: keyof typeof pins): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: await response.json() };
}

const asRecord = (body: unknown) => body as Record<string, unknown>;

/** One finished season, exactly as ESPN answers for a recent year. */
const espnPayload = {
  id: 999,
  seasonId: 2026,
  status: { isActive: false },
  teams: [
    { id: 2, name: 'Tu Mamacita', rankCalculatedFinal: 1 },
    { id: 7, name: 'Mamu, There Goes That Amen', rankCalculatedFinal: 2 },
  ],
  schedule: [
    {
      matchupPeriodId: 4,
      playoffTierType: 'NONE',
      home: { teamId: 2, totalPoints: 1500.5 },
      away: { teamId: 7, totalPoints: 1100 },
    },
  ],
};

const teamMap = [
  { espnTeamId: 2, franchiseId: 'fr-shaug-amy', ownerName: 'Amy Shaug' },
  { espnTeamId: 7, franchiseId: 'fr-funkhouser', ownerName: 'Brey Funkhouser' },
];

const importBody = (extra: Record<string, unknown> = {}) => ({
  seasonNumber: 16,
  espnSeasonId: 2026,
  teamMap,
  payload: espnPayload,
  ...extra,
});

async function preview(): Promise<Record<string, unknown>> {
  const result = await request('/api/league/history/import/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(importBody()),
  });
  assert.equal(result.status, 200, 'a preview with a supplied payload needs no ESPN credentials');
  return asRecord(result.body);
}

/** Save `history` as the draft at whatever version it currently sits on. */
async function saveDraft(history: LeagueHistory): Promise<number> {
  const current = await store.getHistoryDraft(SEASON);
  const result = await request('/api/league/history/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ history, expectedVersion: current?.version ?? 0 }),
  });
  assert.equal(result.status, 200, 'draft save should succeed');
  return asRecord(result.body).version as number;
}

/** A draft that differs from whatever is published right now. */
function uniqueHistory(marker: string): LeagueHistory {
  const history = structuredClone(seed);
  history.franchises[0] = { ...history.franchises[0], name: `Eric Runnels (${marker})` };
  return history;
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'history-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  // No ESPN credentials here, which is exactly the state of every dev machine.
  delete process.env.ESPN_LEAGUE_ID;
  delete process.env.ESPN_COOKIE_STRING;
  delete process.env.ESPN_S2;
  delete process.env.ESPN_SWID;

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const [{ default: app }, storeModule] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
  ]);
  store = storeModule;
  for (const [owner, pin] of Object.entries(pins)) await store.setPin(owner, pin);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await store.deleteHistoryDraft(SEASON);
});

// ─── Reading ───────────────────────────────────────────────────────────────

test('anyone can read league history without signing in', async () => {
  const { status, body } = await request('/api/league/history');
  const row = asRecord(body);
  assert.equal(status, 200);
  assert.equal((row.history as LeagueHistory).seasons.length, 16);
});

test('with nothing published the committed seed is served', async () => {
  const published = await store.getLatestHistoryVersion(SEASON);
  if (published) return; // a later test published; the first run covers this
  const row = asRecord((await request('/api/league/history')).body);
  assert.equal(row.published, false);
  assert.equal(row.versionId, null);
});

// ─── Authorisation ─────────────────────────────────────────────────────────

test('the draft, the import, and publishing are commissioner-only', async () => {
  const asMember = { headers: auth('Joel'), method: 'POST', body: '{}' };
  assert.equal((await request('/api/league/history/draft', { headers: auth('Joel') })).status, 403);
  assert.equal((await request('/api/league/history/import/preview', asMember)).status, 403);
  assert.equal((await request('/api/league/history/import/apply', asMember)).status, 403);
  assert.equal((await request('/api/league/history/publish', asMember)).status, 403);
});

test('a request with no PIN is refused before anything is read', async () => {
  assert.equal((await request('/api/league/history/draft')).status, 401);
});

// ─── Import preview ────────────────────────────────────────────────────────

test('a preview writes nothing', async () => {
  const body = await preview();
  assert.equal(body.blocked, false);
  assert.ok((body.diff as { changes: unknown[] }).changes.length > 0);
  assert.equal(await store.getHistoryDraft(SEASON), null, 'no draft was created');
});

test('the preview reports the conflict instead of overwriting the record book', async () => {
  const body = await preview();
  const conflicts = body.conflicts as Array<{ note: string }>;
  const changes = (body.diff as { changes: Array<{ kind: string }> }).changes;
  // Season 16 is already on file from the commissioner, and ESPN agrees, so the
  // top two do not clash. The new weekly score is what the import adds.
  assert.ok(changes.some((change) => change.kind === 'record-added'));
  assert.deepEqual(conflicts, []);
});

test('a source that disagrees with the record book becomes a conflict, not a rewrite', async () => {
  const flipped = {
    ...espnPayload,
    teams: [
      { id: 2, name: 'Tu Mamacita', rankCalculatedFinal: 2 },
      { id: 7, name: 'Mamu, There Goes That Amen', rankCalculatedFinal: 1 },
    ],
  };
  const result = await request('/api/league/history/import/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(importBody({ payload: flipped })),
  });
  const body = asRecord(result.body);
  const conflicts = body.conflicts as Array<{ field: string }>;
  assert.equal(conflicts.length, 2, 'both finishes disagree with what is on file');
  const candidate = body.candidate as LeagueHistory;
  const season = candidate.seasons.find((entry) => entry.seasonNumber === 16);
  assert.equal(
    season?.placements.find((entry) => entry.placement === 1)?.ownerName,
    'Amy Shaug',
    'the stored champion stands until the commissioner rules',
  );
});

test('an unmapped ESPN team blocks the import and hands back the team list', async () => {
  const result = await request('/api/league/history/import/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(importBody({ teamMap: [] })),
  });
  const body = asRecord(result.body);
  assert.equal(body.blocked, true);
  assert.equal((body.espnTeams as unknown[]).length, 2);
});

test('a live pull with no ESPN credentials fails clearly instead of inventing data', async () => {
  const result = await request('/api/league/history/import/preview', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ seasonNumber: 16, espnSeasonId: 2026, teamMap }),
  });
  assert.equal(result.status, 502);
  assert.equal(asRecord(result.body).code, 'espn-unavailable');
});

// ─── Applying an import ────────────────────────────────────────────────────

test('an import lands in the draft, never in published history', async () => {
  const previewed = await preview();
  const applied = await request('/api/league/history/import/apply', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(importBody({ fingerprint: previewed.fingerprint, expectedVersion: 0 })),
  });
  assert.equal(applied.status, 200);
  const draft = await store.getHistoryDraft(SEASON);
  assert.ok(draft, 'the draft now exists');
  assert.equal((draft.history as LeagueHistory).status, 'draft');

  const live = asRecord((await request('/api/league/history')).body);
  const seasonSixteen = (live.history as LeagueHistory).records.filter(
    (entry) => entry.seasonNumber === 16,
  );
  assert.equal(seasonSixteen.length, 0, 'nothing reached the published record book');
});

test('an import that does not match the preview is refused', async () => {
  await preview();
  const refused = await request('/api/league/history/import/apply', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify(importBody({ fingerprint: 'lh_deadbeef_1', expectedVersion: 0 })),
  });
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'stale-fingerprint');
  assert.equal(await store.getHistoryDraft(SEASON), null);
});

// ─── Draft writes ──────────────────────────────────────────────────────────

test('a draft with two champions in one season is refused', async () => {
  const broken = structuredClone(seed);
  broken.seasons[0].placements.push({
    franchiseId: 'fr-funkhouser',
    ownerName: 'Brey Funkhouser',
    placement: 1,
    source: { provenance: 'commissioner', reference: 'test', verified: false },
  });
  const result = await request('/api/league/history/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ history: broken, expectedVersion: 0 }),
  });
  assert.equal(result.status, 422);
  const problems = asRecord(result.body).problems as Array<{ kind: string }>;
  assert.ok(problems.some((problem) => problem.kind === 'two-champions'));
});

test('a stale tab cannot overwrite a newer draft', async () => {
  await saveDraft(uniqueHistory('first'));
  const stale = await request('/api/league/history/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ history: uniqueHistory('second'), expectedVersion: 0 }),
  });
  assert.equal(stale.status, 409);
  assert.equal(asRecord(stale.body).code, 'stale-version');
});

// ─── Publishing ────────────────────────────────────────────────────────────

test('publishing freezes the draft and everyone reads it', async () => {
  const history = uniqueHistory('published-read');
  await saveDraft(history);
  const result = await request('/api/league/history/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: historyFingerprint(history), reason: 'First reviewed pass' }),
  });
  assert.equal(result.status, 200);
  const published = asRecord(result.body);

  const live = asRecord((await request('/api/league/history')).body);
  assert.equal(live.published, true);
  assert.equal(live.versionId, published.versionId);
  assert.equal(live.reason, 'First reviewed pass');
  const book = live.history as LeagueHistory;
  assert.equal(book.status, 'published');
  assert.equal(book.franchises[0].name, 'Eric Runnels (published-read)');
});

test('a revision must say why it exists', async () => {
  const history = uniqueHistory('no-reason');
  await saveDraft(history);
  const result = await request('/api/league/history/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: historyFingerprint(history) }),
  });
  assert.equal(result.status, 400);
  assert.match(String(asRecord(result.body).error), /reason/i);
});

test('a fingerprint that does not match the stored draft is refused', async () => {
  await saveDraft(uniqueHistory('actually-saved'));
  const refused = await request('/api/league/history/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      fingerprint: historyFingerprint(uniqueHistory('what-was-previewed')),
      reason: 'Should not land',
    }),
  });
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'stale-fingerprint');
});

test('republishing an unchanged document is refused', async () => {
  const history = uniqueHistory('published-twice');
  await saveDraft(history);
  const first = await request('/api/league/history/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: historyFingerprint(history), reason: 'Once' }),
  });
  assert.equal(first.status, 200);

  await saveDraft(history);
  const again = await request('/api/league/history/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: historyFingerprint(history), reason: 'Twice' }),
  });
  assert.equal(again.status, 409);
  assert.equal(asRecord(again.body).code, 'no-changes');
});

test('a correction adds a revision and leaves the old one readable', async () => {
  const first = uniqueHistory('before-correction');
  await saveDraft(first);
  const firstPublish = asRecord(
    (
      await request('/api/league/history/publish', {
        method: 'POST',
        headers: auth(commissioner),
        body: JSON.stringify({ fingerprint: historyFingerprint(first), reason: 'As transcribed' }),
      })
    ).body,
  );

  const corrected = uniqueHistory('after-correction');
  await saveDraft(corrected);
  const secondPublish = asRecord(
    (
      await request('/api/league/history/publish', {
        method: 'POST',
        headers: auth(commissioner),
        body: JSON.stringify({
          fingerprint: historyFingerprint(corrected),
          reason: 'Ryan pointed out the 2016 runner-up was wrong',
        }),
      })
    ).body,
  );
  assert.equal(Number(secondPublish.revision), Number(firstPublish.revision) + 1);

  const old = asRecord(
    (await request(`/api/league/history/versions/${String(firstPublish.versionId)}`)).body,
  );
  assert.equal(
    (old.history as LeagueHistory).franchises[0].name,
    'Eric Runnels (before-correction)',
    'the earlier revision is untouched',
  );
  assert.equal(old.reason, 'As transcribed');

  const versions = (await request('/api/league/history/versions')).body as Array<{
    revision: number;
    reason: string;
  }>;
  assert.equal(versions[0].reason, 'Ryan pointed out the 2016 runner-up was wrong');
  assert.ok(versions.every((version) => !('history' in version)), 'the listing stays small');
});

test('an unknown revision id is a clean 404', async () => {
  assert.equal((await request('/api/league/history/versions/lh-nope')).status, 404);
});

test('every history write is audited', async () => {
  const history = uniqueHistory('audited');
  await saveDraft(history);
  await request('/api/league/history/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ fingerprint: historyFingerprint(history), reason: 'For the record' }),
  });

  const rows = (await request('/api/league/audit', { headers: auth(commissioner) })).body as Array<{
    action: string;
    owner: string;
    detail: { reason?: string; versionId?: string };
  }>;
  const entry = rows.find(
    (row) => row.action === 'history-publish' && row.detail?.reason === 'For the record',
  );
  assert.ok(entry, 'the publish is logged');
  assert.equal(entry.owner, commissioner);
  assert.ok(entry.detail.versionId, 'the audit names the revision it created');
  assert.ok(rows.some((row) => row.action === 'history-draft-save'), 'draft saves are logged too');
});

test('resetting the draft goes back to what is published', async () => {
  await saveDraft(uniqueHistory('to-be-dropped'));
  const reset = await request('/api/league/history/draft', {
    method: 'DELETE',
    headers: auth(commissioner),
  });
  assert.equal(reset.status, 200);
  assert.equal(asRecord(reset.body).seeded, true);
  assert.equal(await store.getHistoryDraft(SEASON), null);
});

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset, LeagueDynamicState } from '../src/lib/keeper/types.ts';
import type { DraftRankingSnapshot, EspnDraftRankingPlayer } from '../src/lib/league/draftRankings.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const dataset = rawDataset as unknown as LeagueDataset;
const commissioner = dataset.teams.find((team) => team.isCommissioner)?.owner;
assert.ok(commissioner, 'fixture needs a commissioner');

const pins = {
  [commissioner]: '9000',
  Joel: '1000',
};

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

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

const SCORING = [
  { statId: 0, points: 1 },
  { statId: 3, points: 1.5 },
];

/** Every committed player, ranked in dataset order, with ESPN-shaped numbers. */
function candidate(over: { scoringItems?: typeof SCORING; withProjection?: boolean } = {}) {
  const players: EspnDraftRankingPlayer[] = dataset.players
    .filter((player): player is typeof player & { espnId: number } => player.espnId !== null)
    .map((player, index) => ({
      espnId: player.espnId,
      fullName: player.fullName ?? player.name,
      proTeam: player.proTeam,
      adp: index + 1.5,
      percentOwned: Math.max(0, 100 - index * 0.3),
      standard: { rank: index + 1, auctionValue: Math.max(1, 70 - index) },
      roto: { rank: index + 1, auctionValue: null },
      projection: over.withProjection
        ? { id: `10${dataset.season}`, stats: { 0: 2000 - index * 5, 3: 400, 42: 70 }, averageStats: null }
        : null,
    }));
  return {
    sourceSeason: dataset.season,
    source: 'espn-kona' as const,
    sourceUrl: null as string | null,
    fetchedAt: '2026-09-07T12:00:00.000Z',
    scoringItems: over.scoringItems ?? SCORING,
    players,
  };
}

const preview = (body: unknown, owner: keyof typeof pins = commissioner) =>
  request('/api/league/draft-rankings/preview', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify(body),
  });

const accept = (body: unknown, owner: keyof typeof pins = commissioner) =>
  request('/api/league/draft-rankings/accept', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify(body),
  });

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'draft-rankings-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const [{ default: app }, storeModule] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
  ]);
  store = storeModule;
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
  await store.mutateState((draft) => {
    draft.keepers = {};
    draft.keepersRevealed = false;
    draft.draft = { picks: {}, startedAt: null };
    delete draft.draftRankings;
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('draft rankings are commissioner-only, reads included', async () => {
  const anonymous = await request('/api/league/draft-rankings');
  assert.equal(anonymous.status, 401);
  const member = await request('/api/league/draft-rankings', { headers: auth('Joel') });
  assert.equal(member.status, 403);

  const fetchDenied = await request('/api/league/draft-rankings/fetch-preview', {
    method: 'POST',
    headers: auth('Joel'),
  });
  assert.equal(fetchDenied.status, 403);
  assert.equal((await preview(candidate(), 'Joel')).status, 403);
  assert.equal((await accept(candidate(), 'Joel')).status, 403);
  assert.equal((await preview(candidate())).status, 200);
});

test('before anything is accepted the commissioner reads an empty fallback, not an error', async () => {
  const current = await request('/api/league/draft-rankings', { headers: auth(commissioner) });
  assert.equal(current.status, 200);
  assert.equal(current.body.fallback, true);
  const snapshot = current.body.snapshot as DraftRankingSnapshot;
  assert.equal(snapshot.source, 'none');
  assert.equal(snapshot.players.length, 0);
  assert.equal(snapshot.projectionStatId, `10${dataset.season}`);

  const state = await request('/api/league/state', { headers: auth(commissioner) });
  const meta = state.body.meta as { draftRankings?: { activeSnapshotId: string } };
  assert.equal(meta.draftRankings?.activeSnapshotId, snapshot.id);
});

test('previews without writing, then accepts the exact candidate', async () => {
  const body = candidate();
  const previewed = await preview(body);
  assert.equal(previewed.status, 200);
  assert.equal(previewed.body.currentSnapshotId, `none-${dataset.season}`);
  const diff = previewed.body.preview as {
    counts: { players: number; ranked: number; withAdp: number; projected: number };
    added: unknown[];
    projectionArrived: boolean;
    scoringChanged: boolean;
  };
  assert.equal(diff.counts.players, body.players.length);
  assert.equal(diff.counts.ranked, body.players.length);
  assert.equal(diff.counts.projected, 0);
  assert.equal(diff.added.length, body.players.length, 'everyone is new against an empty base');
  assert.equal(diff.scoringChanged, true, 'the fallback carries no scoring items');
  assert.equal((await store.getState()).state.draftRankings, undefined, 'a preview writes nothing');

  const accepted = await accept({
    ...body,
    expectedCurrentSnapshotId: previewed.body.currentSnapshotId,
    fingerprint: previewed.body.fingerprint,
  });
  assert.equal(accepted.status, 200);
  const snapshot = accepted.body.snapshot as DraftRankingSnapshot;
  assert.equal(snapshot.id, previewed.body.candidateSnapshotId);
  assert.equal(snapshot.source, 'espn-kona');
  assert.equal(snapshot.baseSnapshotId, `none-${dataset.season}`);
  assert.deepEqual(snapshot.scoringItems, SCORING);
  assert.equal(snapshot.players[0]?.standard?.rank, 1, 'stored in ESPN order');
  assert.equal((await store.getState()).state.draftRankings?.activeSnapshotId, snapshot.id);

  const current = await request('/api/league/draft-rankings', { headers: auth(commissioner) });
  assert.equal(current.status, 200);
  assert.equal(current.body.fallback, false);
  assert.equal((current.body.snapshot as DraftRankingSnapshot).id, snapshot.id);
  assert.equal((current.body.snapshot as DraftRankingSnapshot).fingerprint, snapshot.fingerprint);

  const audit = await request('/api/league/audit?limit=5', { headers: auth(commissioner) });
  const rows = audit.body as unknown as Array<{ action: string }> | { rows?: Array<{ action: string }> };
  const actions = Array.isArray(rows) ? rows.map((row) => row.action) : (rows.rows ?? []).map((row) => row.action);
  assert.ok(actions.includes('draft_rankings.accepted'), `audit trail missing: ${actions.join(', ')}`);
});

test('the second snapshot diffs against the first and can land after the draft starts', async () => {
  const first = candidate();
  const previewed = await preview(first);
  const accepted = await accept({
    ...first,
    expectedCurrentSnapshotId: previewed.body.currentSnapshotId,
    fingerprint: previewed.body.fingerprint,
  });
  assert.equal(accepted.status, 200);
  const firstId = (accepted.body.snapshot as DraftRankingSnapshot).id;

  // Rankings only order a list, so unlike the pool they may move on draft day.
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepersRevealed = true;
    draft.draft.startedAt = new Date().toISOString();
  });

  const second = candidate({ withProjection: true });
  const [top, next] = second.players;
  assert.ok(top && next);
  top.standard = { rank: 2, auctionValue: 60 };
  next.standard = { rank: 1, auctionValue: 66 };
  const again = await preview(second);
  assert.equal(again.status, 200);
  assert.equal(again.body.currentSnapshotId, firstId);
  const diff = again.body.preview as {
    moved: Array<{ espnId: number; before: number; after: number; delta: number }>;
    projectionArrived: boolean;
    added: unknown[];
    removed: unknown[];
  };
  // Equal-sized moves: the better new rank reads first.
  assert.deepEqual(
    diff.moved.map((move) => [move.espnId, move.before, move.after]),
    [[next.espnId, 2, 1], [top.espnId, 1, 2]],
  );
  assert.equal(diff.projectionArrived, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);

  const landed = await accept({
    ...second,
    expectedCurrentSnapshotId: firstId,
    fingerprint: again.body.fingerprint,
  });
  assert.equal(landed.status, 200);
  const snapshot = landed.body.snapshot as DraftRankingSnapshot;
  assert.equal(snapshot.baseSnapshotId, firstId);
  assert.equal(snapshot.players[0]?.espnId, next.espnId);
  assert.equal(snapshot.players[0]?.projection?.id, `10${dataset.season}`);
});

test('a changed candidate, a stale base, and an unchanged candidate are all refused', async () => {
  const body = candidate();
  const previewed = await preview(body);

  const changed = structuredClone(body);
  changed.players[0]!.adp = 99;
  const mismatch = await accept({
    ...changed,
    expectedCurrentSnapshotId: previewed.body.currentSnapshotId,
    fingerprint: previewed.body.fingerprint,
  });
  assert.equal(mismatch.status, 409);
  assert.match(String(mismatch.body.error), /no longer matches/);

  const accepted = await accept({
    ...body,
    expectedCurrentSnapshotId: previewed.body.currentSnapshotId,
    fingerprint: previewed.body.fingerprint,
  });
  assert.equal(accepted.status, 200);

  const stale = await accept({
    ...body,
    expectedCurrentSnapshotId: previewed.body.currentSnapshotId,
    fingerprint: previewed.body.fingerprint,
  });
  assert.equal(stale.status, 409);
  assert.match(String(stale.body.error), /changed; preview again/);

  const fresh = await preview(body);
  const same = await accept({
    ...body,
    expectedCurrentSnapshotId: fresh.body.currentSnapshotId,
    fingerprint: fresh.body.fingerprint,
  });
  assert.equal(same.status, 409);
  assert.match(String(same.body.error), /already matches/);
});

test('a set loaded by hand is stored as manual, with where it came from', async () => {
  const body = {
    ...candidate({ withProjection: true }),
    source: 'manual' as const,
    sourceUrl: 'https://www.espn.com/fantasy/basketball/story/_/page/projections',
  };
  const previewed = await preview(body);
  assert.equal(previewed.status, 200);
  const accepted = await accept({
    ...body,
    expectedCurrentSnapshotId: previewed.body.currentSnapshotId,
    fingerprint: previewed.body.fingerprint,
  });
  assert.equal(accepted.status, 200);
  const snapshot = accepted.body.snapshot as DraftRankingSnapshot;
  assert.equal(snapshot.source, 'manual');
  assert.equal(snapshot.sourceUrl, body.sourceUrl);
  assert.equal(snapshot.players[0]?.projection?.id, `10${dataset.season}`);

  // A candidate that omits the source is the ESPN fetch, and the source is
  // part of the fingerprint, so relabelling the same numbers is a new snapshot.
  const asEspn = { ...body, source: undefined, sourceUrl: undefined };
  const again = await preview(asEspn);
  assert.equal(again.status, 200);
  assert.notEqual(again.body.candidateSnapshotId, snapshot.id);

  const bogus = await preview({ ...body, source: 'guess' });
  assert.equal(bogus.status, 400);
  assert.match(String(bogus.body.error), /source/);
});

test('a malformed candidate is refused before anything is diffed', async () => {
  const bad = candidate();
  bad.players[3]!.espnId = -4;
  const badId = await preview(bad);
  assert.equal(badId.status, 400);
  assert.match(String(badId.body.error), /espnId/);

  const short = { ...candidate(), players: candidate().players.slice(0, 5) };
  assert.equal((await preview(short)).status, 400);

  const wrongSeason = { ...candidate(), sourceSeason: dataset.season - 1 };
  assert.equal((await preview(wrongSeason)).status, 400);

  const badScoring = { ...candidate(), scoringItems: [{ statId: 'pts', points: 1 }] };
  const scoring = await preview(badScoring);
  assert.equal(scoring.status, 400);
  assert.match(String(scoring.body.error), /statId/);

  const missing = await accept({ ...candidate(), expectedCurrentSnapshotId: 'x' });
  assert.equal(missing.status, 400);
  assert.match(String(missing.body.error), /fingerprint/);
});

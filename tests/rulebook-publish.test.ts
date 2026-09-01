import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawRulebook from '../src/data/source/rulebook-2027.json' with { type: 'json' };
import type { Rulebook } from '../src/lib/league/rulebook.ts';
import { rulebookFingerprint } from '../src/lib/league/rulebookDiff.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const seed = rawRulebook as unknown as Rulebook;
const SEASON = seed.season;

const commissioner = 'Brey';
const pins = { [commissioner]: '9000', Joel: '1000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

const rulebookSeed = (): Rulebook => structuredClone(seed);
const fingerprint = rulebookFingerprint;

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

/** Save `book` as the draft, whatever version the draft is currently at. */
async function saveDraft(book: Rulebook): Promise<void> {
  const current = await store.getRulebookDraft(SEASON);
  const result = await request('/api/league/rulebook/draft', {
    method: 'PUT',
    headers: auth(commissioner),
    body: JSON.stringify({ book, expectedVersion: current?.version ?? 0 }),
  });
  assert.equal(result.status, 200, 'draft save should succeed');
}

async function publish(
  owner: keyof typeof pins,
  fp: string,
  notes = '',
): Promise<{ status: number; body: unknown }> {
  return request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ fingerprint: fp, notes }),
  });
}

/**
 * The revision the next publish will get. The seed is already revision 14, so
 * the first publish publishes 14; after that each publish steps up by one.
 * Versions accumulate across tests, so assertions read from the current top.
 */
async function nextRevision(): Promise<number> {
  const latest = await store.getLatestRulebookVersion(SEASON);
  return latest ? latest.revision + 1 : seed.revision;
}

/** A draft that differs from whatever is published right now. */
function uniqueBook(marker: string): Rulebook {
  const book = rulebookSeed();
  book.articles[0].title = `League Format (${marker})`;
  return book;
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'rulebook-pub-'));
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
  await store.deleteRulebookDraft(SEASON);
});

// ─── Reading ───────────────────────────────────────────────────────────────

test('anyone can read the published book without signing in', async () => {
  const { status, body } = await request('/api/league/rulebook');
  const row = asRecord(body);
  assert.equal(status, 200, 'the constitution is not a secret; that is what makes links work');
  assert.equal((row.book as Rulebook).articles.length, 10);
});

test('with nothing published the committed seed is served', async () => {
  const fresh = await store.getLatestRulebookVersion(SEASON);
  if (fresh) return; // a later test already published; covered by the first run
  const row = asRecord((await request('/api/league/rulebook')).body);
  assert.equal(row.published, false);
  assert.equal(row.versionId, null);
});

// ─── Publishing ────────────────────────────────────────────────────────────

test('publishing freezes the saved draft and everyone reads it', async () => {
  const expected = await nextRevision();
  const book = uniqueBook('published-read');
  await saveDraft(book);

  const result = await publish(commissioner, fingerprint(book), 'Tightened article 1.');
  assert.equal(result.status, 200);
  const published = asRecord(result.body);
  assert.equal(published.revision, expected);
  assert.equal(published.publishedBy, commissioner);

  const read = asRecord((await request('/api/league/rulebook')).body);
  assert.equal(read.published, true);
  assert.equal(read.versionId, published.versionId);
  assert.equal(read.notes, 'Tightened article 1.');
  const live = read.book as Rulebook;
  assert.equal(live.articles[0].title, 'League Format (published-read)');
  assert.equal(live.status, 'published', 'a frozen version is never marked draft');
  assert.equal(live.revision, expected);
});

test('publishing is commissioner-only', async () => {
  const book = uniqueBook('member-attempt');
  await saveDraft(book);
  assert.equal((await publish('Joel', fingerprint(book))).status, 403);
});

test('a fingerprint that does not match the stored draft is refused', async () => {
  const saved = uniqueBook('actually-saved');
  await saveDraft(saved);

  // The commissioner previewed a different book than the one that got saved.
  const previewed = uniqueBook('what-was-previewed');
  const refused = await publish(commissioner, fingerprint(previewed));
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'stale-fingerprint');

  const live = asRecord((await request('/api/league/rulebook')).body);
  assert.notEqual(
    (live.book as Rulebook).articles[0].title,
    'League Format (actually-saved)',
    'the refused publish changed nothing',
  );
});

test('a fingerprint is required, so nobody publishes without seeing the diff', async () => {
  await saveDraft(uniqueBook('no-fingerprint'));
  const missing = await request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ notes: 'no fingerprint' }),
  });
  assert.equal(missing.status, 400);
});

test('publishing with no draft at all is refused', async () => {
  const noDraft = await publish(commissioner, fingerprint(rulebookSeed()));
  assert.equal(noDraft.status, 409);
  assert.match(String(asRecord(noDraft.body).error), /no draft/i);
});

test('republishing an unchanged book is refused', async () => {
  const book = uniqueBook('published-twice');
  await saveDraft(book);
  assert.equal((await publish(commissioner, fingerprint(book))).status, 200);

  const again = await publish(commissioner, fingerprint(book));
  assert.equal(again.status, 409);
  assert.equal(asRecord(again.body).code, 'no-changes');
});

test('a draft with a broken reference cannot be published', async () => {
  const book = uniqueBook('broken-ref');
  // Save a clean book first, then corrupt the stored copy directly, since the
  // draft route would have rejected it on the way in.
  await saveDraft(book);
  const corrupted = structuredClone(book);
  corrupted.articles[0].clauses[0].text = 'Points nowhere: {{ref:no.such.rule}}.';
  const current = await store.getRulebookDraft(SEASON);
  await store.saveRulebookDraft(SEASON, corrupted, current?.version ?? 0, commissioner);

  const refused = await publish(commissioner, fingerprint(corrupted));
  assert.equal(refused.status, 422);
  const problems = asRecord(refused.body).problems as Array<{ kind: string }>;
  assert.ok(problems.some((p) => p.kind === 'broken-ref'));
});

// ─── History ───────────────────────────────────────────────────────────────

test('each publish adds a revision and the history reads newest first', async () => {
  const first = await nextRevision();
  for (const marker of ['history-a', 'history-b', 'history-c']) {
    const book = uniqueBook(marker);
    await saveDraft(book);
    assert.equal((await publish(commissioner, fingerprint(book), `Notes for ${marker}`)).status, 200);
  }

  const versions = (await request('/api/league/rulebook/versions')).body as Array<{
    revision: number;
    notes: string;
    publishedBy: string;
  }>;
  assert.deepEqual(
    versions.slice(0, 3).map((v) => v.revision),
    [first + 2, first + 1, first],
  );
  assert.equal(versions[0].notes, 'Notes for history-c');
  assert.ok(versions.every((v) => v.publishedBy === commissioner));
  assert.ok(
    versions.every((v) => !('book' in v)),
    'the listing stays small; bodies are fetched one at a time',
  );
});

test('an old version stays readable and unchanged after later publishes', async () => {
  const firstBook = uniqueBook('frozen-original');
  await saveDraft(firstBook);
  const first = asRecord((await publish(commissioner, fingerprint(firstBook))).body);

  const secondBook = uniqueBook('later-rewrite');
  await saveDraft(secondBook);
  await publish(commissioner, fingerprint(secondBook));

  const old = asRecord(
    (await request(`/api/league/rulebook/versions/${String(first.versionId)}`)).body,
  );
  assert.equal((old.book as Rulebook).articles[0].title, 'League Format (frozen-original)');
  assert.equal(old.revision, first.revision);

  const live = asRecord((await request('/api/league/rulebook')).body);
  assert.equal((live.book as Rulebook).articles[0].title, 'League Format (later-rewrite)');
});

test('an unknown version id is a clean 404', async () => {
  assert.equal((await request('/api/league/rulebook/versions/rb-nope')).status, 404);
});

test('a publish is written to the audit log', async () => {
  const book = uniqueBook('audited');
  await saveDraft(book);
  await publish(commissioner, fingerprint(book), 'For the record');

  const rows = (await request('/api/league/audit', { headers: auth(commissioner) })).body as Array<{
    action: string;
    owner: string;
    detail: { notes?: string; versionId?: string };
  }>;
  const entry = rows.find((r) => r.action === 'rulebook-publish' && r.detail?.notes === 'For the record');
  assert.ok(entry, 'the publish is logged');
  assert.equal(entry.owner, commissioner);
  assert.ok(entry.detail.versionId, 'the audit names the version it created');
});

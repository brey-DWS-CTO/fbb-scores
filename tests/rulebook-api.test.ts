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

/** A fresh, mutable copy of the committed book for each test to mangle. */
function rulebookSeed(): Rulebook {
  return structuredClone(seed);
}

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

async function putDraft(
  owner: keyof typeof pins,
  book: unknown,
  expectedVersion: unknown,
): Promise<{ status: number; body: unknown }> {
  return request('/api/league/rulebook/draft', {
    method: 'PUT',
    headers: auth(owner),
    body: JSON.stringify({ book, expectedVersion }),
  });
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'rulebook-api-'));
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
  assert.ok(store.isCommissionerOwner(commissioner), 'fixture needs the commissioner');
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

// ─── Authorization ─────────────────────────────────────────────────────────

test('the draft is commissioner-only on every verb', async () => {
  assert.equal((await request('/api/league/rulebook/draft')).status, 401);
  assert.equal(
    (await request('/api/league/rulebook/draft', { headers: auth('Joel') })).status,
    403,
  );
  assert.equal((await putDraft('Joel', rulebookSeed(), 0)).status, 403);
  assert.equal(
    (await request('/api/league/rulebook/draft', { method: 'DELETE', headers: auth('Joel') }))
      .status,
    403,
  );
});

test('a member editing the draft cannot change what members read', async () => {
  const book = rulebookSeed();
  book.articles[0].title = 'Hijacked';
  await putDraft('Joel', book, 0);
  const stored = await store.getRulebookDraft(SEASON);
  assert.equal(stored, null, 'the rejected write stored nothing');
});

// ─── Reading ───────────────────────────────────────────────────────────────

test('with no draft stored the commissioner gets the committed seed at version 0', async () => {
  const { status, body } = await request('/api/league/rulebook/draft', {
    headers: auth(commissioner),
  });
  const row = asRecord(body);
  assert.equal(status, 200);
  assert.equal(row.version, 0);
  assert.equal(row.seeded, true);
  const book = row.book as Rulebook;
  assert.equal(book.season, SEASON);
  assert.equal(book.articles.length, 10);
});

// ─── Saving ────────────────────────────────────────────────────────────────

test('saving bumps the version, records the author, and reads back', async () => {
  const book = rulebookSeed();
  book.articles[0].title = 'League Format, amended';

  const saved = asRecord((await putDraft(commissioner, book, 0)).body);
  assert.equal(saved.version, 1);
  assert.equal(saved.updatedBy, commissioner);

  const reloaded = asRecord(
    (await request('/api/league/rulebook/draft', { headers: auth(commissioner) })).body,
  );
  assert.equal(reloaded.version, 1);
  assert.equal(reloaded.seeded, false);
  assert.equal((reloaded.book as Rulebook).articles[0].title, 'League Format, amended');
});

test('a stale tab cannot overwrite a newer draft', async () => {
  await putDraft(commissioner, rulebookSeed(), 0);

  const stale = await putDraft(commissioner, rulebookSeed(), 0);
  assert.equal(stale.status, 409);
  const staleBody = asRecord(stale.body);
  assert.equal(staleBody.code, 'stale-version');
  assert.equal(staleBody.currentVersion, 1);

  const fresh = await putDraft(commissioner, rulebookSeed(), 1);
  assert.equal(fresh.status, 200);
  assert.equal(asRecord(fresh.body).version, 2);
});

// ─── Validation ────────────────────────────────────────────────────────────

test('a broken cross-reference is refused and nothing is stored', async () => {
  const book = rulebookSeed();
  book.articles[0].clauses[0].text = 'Points nowhere: {{ref:no.such.rule}}.';

  const rejected = await putDraft(commissioner, book, 0);
  assert.equal(rejected.status, 422);
  const problems = asRecord(rejected.body).problems as Array<{ kind: string }>;
  assert.ok(problems.some((p) => p.kind === 'broken-ref'));

  assert.equal(await store.getRulebookDraft(SEASON), null, 'nothing was stored');
});

test('a duplicate id is refused', async () => {
  const book = rulebookSeed();
  book.articles[1].clauses.push({ id: book.articles[0].clauses[0].id, text: 'Copycat.' });
  const rejected = await putDraft(commissioner, book, 0);
  assert.equal(rejected.status, 422);
  const problems = asRecord(rejected.body).problems as Array<{ kind: string }>;
  assert.ok(problems.some((p) => p.kind === 'duplicate-id'));
});

test('malformed bodies and the wrong season are refused', async () => {
  assert.equal((await putDraft(commissioner, undefined, 0)).status, 400);
  assert.equal((await putDraft(commissioner, rulebookSeed(), undefined)).status, 400);
  assert.equal((await putDraft(commissioner, rulebookSeed(), -1)).status, 400);
  assert.equal((await putDraft(commissioner, { articles: 'nope' }, 0)).status, 400);

  const wrongSeason = rulebookSeed();
  wrongSeason.season = 1999;
  const mismatch = await putDraft(commissioner, wrongSeason, 0);
  assert.equal(mismatch.status, 400);
  assert.match(String(asRecord(mismatch.body).error), /season/);
});

test('a book larger than the cap is refused', async () => {
  const book = rulebookSeed();
  book.articles[0].clauses[0].text = 'x'.repeat(2_100_000);
  const rejected = await putDraft(commissioner, book, 0);
  assert.equal(rejected.status, 413);
});

// ─── A real editing session ────────────────────────────────────────────────

test('an edited draft round-trips with its new clause and numbering intact', async () => {
  const { insertClause, moveNode } = await import('../src/lib/league/rulebookEdit.ts');
  const { buildRulebookIndex } = await import('../src/lib/league/rulebook.ts');

  const added = insertClause(rulebookSeed(), 'draft.order.p9', 'before', {
    title: 'Interim pick',
    text: 'A brand new rule about picks.',
  });
  const moved = moveNode(added.book, added.id, 'down');

  const saved = await putDraft(commissioner, moved, 0);
  assert.equal(saved.status, 200);

  const reloaded = asRecord(
    (await request('/api/league/rulebook/draft', { headers: auth(commissioner) })).body,
  );
  const index = buildRulebookIndex(reloaded.book as Rulebook);
  assert.equal(index.byId.get('draft.order.p9')?.number, '2.2.5');
  assert.equal(index.byId.get(added.id)?.number, '2.2.6');
  assert.equal(index.byId.get('draft.order.p10')?.number, '2.2.7');
});

// ─── Reset ─────────────────────────────────────────────────────────────────

test('reset throws the draft away and hands back the seed', async () => {
  const book = rulebookSeed();
  book.articles[0].title = 'Changed';
  await putDraft(commissioner, book, 0);

  const reset = await request('/api/league/rulebook/draft', {
    method: 'DELETE',
    headers: auth(commissioner),
  });
  assert.equal(reset.status, 200);
  assert.equal(asRecord(reset.body).version, 0);

  const after = asRecord(
    (await request('/api/league/rulebook/draft', { headers: auth(commissioner) })).body,
  );
  assert.equal(after.version, 0);
  assert.equal(after.seeded, true);
  assert.equal((after.book as Rulebook).articles[0].title, 'League Format');
});

// ─── Audit ─────────────────────────────────────────────────────────────────

test('draft saves and resets are written to the audit log', async () => {
  await putDraft(commissioner, rulebookSeed(), 0);
  await request('/api/league/rulebook/draft', { method: 'DELETE', headers: auth(commissioner) });

  const audit = await request('/api/league/audit', { headers: auth(commissioner) });
  const rows = audit.body as Array<{ action: string; owner: string }>;
  assert.ok(rows.some((r) => r.action === 'rulebook-draft-save' && r.owner === commissioner));
  assert.ok(rows.some((r) => r.action === 'rulebook-draft-reset' && r.owner === commissioner));
});

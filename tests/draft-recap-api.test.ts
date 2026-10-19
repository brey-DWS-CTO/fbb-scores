import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const pins: Record<string, string> = { Brey: '9000', Joel: '1000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';

const auth = (owner: string): Record<string, string> =>
  ({ 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] });

async function request(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const saveRoast = (owner: string, body: unknown) =>
  request('/api/league/draft-recap/roast', { method: 'POST', headers: auth(owner), body: JSON.stringify(body) });

const recapSeenBy = async (owner: string) => {
  const { body } = await request('/api/league/state', { headers: auth(owner) });
  return (body.state as { draftRecap?: { roasts: Record<string, string> } }).draftRecap;
};

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'draft-recap-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });
  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const [{ default: app }, storeModule] = await Promise.all([import(appUrl), import(storeUrl) as Promise<StoreModule>]);
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
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await store.mutateState((draft) => {
    draft.draft.startedAt = '2026-10-18T21:00:00.000Z';
    draft.draft.closedAt = null;
    delete draft.draftRecap;
  });
});

test('only the commish saves a roast, and it must name a team', async () => {
  assert.equal((await saveRoast('Joel', { owner: 'Joel', text: 'Nice draft.' })).status, 403);
  assert.equal((await saveRoast('Brey', { owner: 'Nobody', text: 'x' })).status, 400);
  assert.equal((await saveRoast('Brey', { owner: 'Joel', text: 'x'.repeat(601) })).status, 400);
  const saved = await saveRoast('Brey', { owner: 'Joel', text: ' Took Jokic.  No notes. ' });
  assert.equal(saved.status, 200);
  assert.deepEqual((saved.body.state as { draftRecap: unknown }).draftRecap, { season: 2027, roasts: { Joel: 'Took Jokic. No notes.' } });
  // A second roast keeps the first; an empty one is saved as empty.
  await saveRoast('Brey', { owner: 'Amy', text: '' });
  assert.deepEqual((await recapSeenBy('Brey'))?.roasts, { Joel: 'Took Jokic. No notes.', Amy: '' });
});

test('members see the roasts only once the draft closes', async () => {
  await saveRoast('Brey', { owner: 'Joel', text: 'Took Jokic.' });
  assert.equal(await recapSeenBy('Joel'), undefined);
  assert.ok(await recapSeenBy('Brey'));
  await store.mutateState((draft) => { draft.draft.closedAt = '2026-10-18T23:00:00.000Z'; });
  assert.deepEqual((await recapSeenBy('Joel'))?.roasts, { Joel: 'Took Jokic.' });
});

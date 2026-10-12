import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const pins: Record<string, string> = { Brey: '9000', Joel: '1000', Ryan: '2000' };

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let server: Server;
let baseUrl = '';

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

interface Line {
  owner: string;
  status: string;
  amount: number;
}
interface Dues {
  venmo: string;
  payee: string;
  lines: Line[];
  paid: number;
  verified: number;
  error?: string;
}

async function request(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: Dues }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: (await response.json()) as Dues };
}

const act = (who: string, owner: string, action: string) =>
  request(`/api/league/dues/${owner}`, {
    method: 'POST',
    headers: auth(who),
    body: JSON.stringify({ action }),
  });

const lineOf = (body: Dues, owner: string) => body.lines.find((l) => l.owner === owner)!;

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'dues-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const [{ default: app }, store] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
  ]);
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

test('anyone may read the board, and every team starts unpaid', async () => {
  const { status, body } = await request('/api/league/dues');
  assert.equal(status, 200);
  assert.equal(body.lines.length, 10);
  assert.ok(body.lines.every((l) => l.status === 'unpaid' && l.amount === 304));
  assert.equal(body.venmo, '');
});

test('a member marks their own team paid, but not anyone else', async () => {
  const mine = await act('Joel', 'Joel', 'paid');
  assert.equal(mine.status, 200);
  assert.equal(lineOf(mine.body, 'Joel').status, 'paid');

  const theirs = await act('Joel', 'Ryan', 'paid');
  assert.equal(theirs.status, 403);
});

test('only the commissioner confirms; Ryan cannot until he is one', async () => {
  const ryan = await act('Ryan', 'Joel', 'verify');
  assert.equal(ryan.status, 403);

  const brey = await act('Brey', 'Joel', 'verify');
  assert.equal(brey.status, 200);
  assert.equal(lineOf(brey.body, 'Joel').status, 'verified');
  assert.equal(brey.body.verified, 1);

  const undo = await act('Joel', 'Joel', 'unpaid');
  assert.equal(undo.status, 409, 'a confirmed payment is the commissioner to undo');
});

test('signing in is required to change anything', async () => {
  const { status } = await request('/api/league/dues/Joel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'paid' }),
  });
  assert.equal(status, 401);
});

test('the commissioner sets who collects from a pasted Venmo link', async () => {
  const refused = await request('/api/league/dues/settings', {
    method: 'PUT',
    headers: auth('Joel'),
    body: JSON.stringify({ venmo: '@someone', payee: 'Joel' }),
  });
  assert.equal(refused.status, 403);

  const saved = await request('/api/league/dues/settings', {
    method: 'PUT',
    headers: auth('Brey'),
    body: JSON.stringify({ venmo: 'https://venmo.com/u/keyes209', payee: 'Ryan' }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.venmo, 'keyes209');
  assert.equal(saved.body.payee, 'Ryan');

  const bad = await request('/api/league/dues/settings', {
    method: 'PUT',
    headers: auth('Brey'),
    body: JSON.stringify({ venmo: 'not a handle', payee: 'Ryan' }),
  });
  assert.equal(bad.status, 400);
});

test('only the commissioner sends the shame email, and only to teams that have not paid', async () => {
  const ryan = await request('/api/league/dues/shame', { method: 'POST', headers: auth('Ryan'), body: '{}' });
  assert.equal(ryan.status, 403);

  const brey = await request('/api/league/dues/shame', { method: 'POST', headers: auth('Brey'), body: '{}' });
  assert.equal(brey.status, 200);
  const body = brey.body as unknown as { sent: string[]; noAddress: string[] };
  const mailed = [...body.sent, ...body.noAddress];
  assert.ok(!mailed.includes('Joel'), 'Joel is confirmed paid');
  assert.ok(mailed.includes('Ryan'));
  assert.equal(mailed.length, 9);
});

test('the collector confirms payments, but cannot set the fee or the Venmo', async () => {
  // Ryan collects (set in an earlier test) but is not a commissioner.
  const confirm = await act('Ryan', 'Ryan', 'verify');
  assert.equal(confirm.status, 200);
  assert.equal(lineOf(confirm.body, 'Ryan').status, 'verified');
  assert.equal((await act('Ryan', 'Ryan', 'unverify')).status, 200);

  assert.equal((await act('Ryan', 'Joel', 'half')).status, 403);
  const settings = await request('/api/league/dues/settings', {
    method: 'PUT',
    headers: auth('Ryan'),
    body: JSON.stringify({ venmo: '@someone', payee: 'Ryan' }),
  });
  assert.equal(settings.status, 403);
  const shame = await request('/api/league/dues/shame', { method: 'POST', headers: auth('Ryan'), body: '{}' });
  assert.equal(shame.status, 403);
});

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { LeagueDynamicState, PickRef, PickTradeProposal } from '../src/lib/keeper/types.ts';

/**
 * The league's email, end to end against the local file backend.
 *
 * With no RESEND_API_KEY the mailer prints who it would have written to, so
 * these tests read the outbox the same way tests/auth-api.test.ts reads a
 * sign-in link. The copy of the league config gets a draft date a day and a
 * bit away, which is the only way to put the reminder windows in the past
 * without a fake clock.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const commissioner = 'Brey';
const pins: Record<string, string> = { Brey: '9000', Amy: '2000', Kyle: '6000', Joel: '3000' };

/** Everyone who gets an address. The other six owners must never be mailed. */
const addresses: Record<string, string> = {
  Brey: 'brey@example.com',
  Amy: 'amy@example.com',
  Kyle: 'kyle@example.com',
};

type StoreModule = typeof import('../server/lib/leagueStore.ts');
type NotifierModule = typeof import('../server/lib/notifier.ts');

let tempRoot = '';
let store: StoreModule;
let notifier: NotifierModule;
let server: Server;
let baseUrl = '';

/** Lines the mailer printed. Cleared before every test. */
let mailLog: string[] = [];

const PREFIX = '[notify] no mail key, would send to ';

function mails(): Array<{ to: string; subject: string }> {
  return mailLog
    .filter((line) => line.startsWith(PREFIX))
    .map((line) => {
      const rest = line.slice(PREFIX.length);
      const split = rest.indexOf(': ');
      return { to: rest.slice(0, split), subject: rest.slice(split + 2) };
    });
}

/** Everything queued has gone out, or failed, before a test looks. */
async function settled(): Promise<void> {
  await notifier.mailSettled();
}

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(
  pathname: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  if (response.status === 204) return { status: 204, body: null };
  return { status: response.status, body: await response.json() };
}

const asRecord = (body: unknown) => body as Record<string, unknown>;
const ref = (round: number, originalOwner: string): PickRef => ({ round, originalOwner });

const propose = (proposer: string, recipient: string, offer: PickRef[], want: PickRef[]) =>
  request('/api/league/pick-trades', {
    method: 'POST',
    headers: auth(proposer),
    body: JSON.stringify({ recipient, offer, request: want, note: 'Straight swap.' }),
  });

const accept = (owner: string, id: string, version: number) =>
  request(`/api/league/pick-trades/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ version }),
  });

const settle = (owner: string, id: string, action: 'reject' | 'cancel') =>
  request(`/api/league/pick-trades/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({}),
  });

const tick = (headers: Record<string, string> = {}) =>
  request('/api/notify/tick', { headers });

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'notify-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  // A draft 30 hours out puts three of the four reminder windows open: the
  // week warning, and both keeper warnings, since keepers close 24 hours
  // before the draft. The draft-day warning is still an hour short.
  const configPath = path.join(tempRoot, 'src', 'data', 'source', 'league-2027-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  config.draftAt = new Date(Date.now() + 30 * 3600_000).toISOString();
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  process.env.DATABASE_URL = '';
  process.env.RESEND_API_KEY = '';
  // Nothing listens there. One test turns the key on to prove a dead mail
  // service cannot take a trade down with it.
  process.env.RESEND_ENDPOINT = 'http://127.0.0.1:1/mail';
  process.env.PUBLIC_APP_URL = 'https://example.test';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  delete process.env.CRON_SECRET;

  const realLog = console.log;
  console.log = (...args: unknown[]) => {
    mailLog.push(args.map(String).join(' '));
    realLog(...args);
  };

  const load = (...parts: string[]) => pathToFileURL(path.join(tempRoot, ...parts)).href;
  const [{ default: app }, storeModule, notifierModule] = await Promise.all([
    import(load('server', 'app.ts')),
    import(load('server', 'lib', 'leagueStore.ts')) as Promise<StoreModule>,
    import(load('server', 'lib', 'notifier.ts')) as Promise<NotifierModule>,
  ]);
  store = storeModule;
  notifier = notifierModule;
  for (const [owner, pin] of Object.entries(pins)) await store.setPin(owner, pin);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [owner, email] of Object.entries(addresses)) {
    const saved = await request(`/api/league/emails/${owner}`, {
      method: 'POST',
      headers: auth(commissioner),
      body: JSON.stringify({ email }),
    });
    assert.equal(saved.status, 200, `could not record ${owner}'s address`);
  }
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
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepers = {};
    draft.keepersRevealed = false;
    draft.draft = { picks: {}, startedAt: null };
    draft.locks = { keepersLocked: false };
    draft.pickTransfers = [];
    draft.pickTradeProposals = [];
  });
  mailLog = [];
});

/* ─── Trades ───────────────────────────────────────────────────────────── */

test('an offer mails the person who has to answer it, and nobody else', async () => {
  const created = await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
  assert.equal(created.status, 200);
  await settled();

  const sent = mails();
  assert.equal(sent.length, 1, `expected one email, saw ${JSON.stringify(sent)}`);
  assert.equal(sent[0].to, addresses.Kyle);
  assert.equal(sent[0].subject, 'Amy offered you a trade');
});

test('taking an offer mails the member who sent it', async () => {
  const created = await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
  const proposal = asRecord(created.body).proposal as PickTradeProposal;
  mailLog = [];

  const taken = await accept('Kyle', proposal.id, proposal.version);
  assert.equal(taken.status, 200);
  await settled();

  const sent = mails();
  assert.equal(sent.length, 1, `expected one email, saw ${JSON.stringify(sent)}`);
  assert.equal(sent[0].to, addresses.Amy);
  assert.equal(sent[0].subject, 'Your trade went through');
});

test('turning an offer down mails the member who sent it', async () => {
  const created = await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
  const proposal = asRecord(created.body).proposal as PickTradeProposal;
  mailLog = [];

  assert.equal((await settle('Kyle', proposal.id, 'reject')).status, 200);
  await settled();

  const sent = mails();
  assert.equal(sent.length, 1, `expected one email, saw ${JSON.stringify(sent)}`);
  assert.equal(sent[0].to, addresses.Amy);
  assert.equal(sent[0].subject, 'Kyle turned down your trade');
});

test('pulling an offer back mails the member it was sent to', async () => {
  const created = await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
  const proposal = asRecord(created.body).proposal as PickTradeProposal;
  mailLog = [];

  assert.equal((await settle('Amy', proposal.id, 'cancel')).status, 200);
  await settled();

  const sent = mails();
  assert.equal(sent.length, 1, `expected one email, saw ${JSON.stringify(sent)}`);
  assert.equal(sent[0].to, addresses.Kyle);
  assert.equal(sent[0].subject, 'Amy pulled the trade back');
});

test('a mail service that will not answer still leaves the trade done', async () => {
  process.env.RESEND_API_KEY = 'not-a-real-key';
  try {
    const created = await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
    assert.equal(created.status, 200, 'the offer stands whatever the mail service does');
    await settled();
    assert.equal(mails().length, 0, 'nothing was written to the log outbox');
    const proposal = asRecord(created.body).proposal as PickTradeProposal;
    const taken = await accept('Kyle', proposal.id, proposal.version);
    assert.equal(taken.status, 200, 'and so does the accept');
    await settled();
  } finally {
    process.env.RESEND_API_KEY = '';
  }
});

/* ─── Keepers ──────────────────────────────────────────────────────────── */

test('revealing keepers mails everyone with an address and nobody without', async () => {
  const revealed = await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  assert.equal(revealed.status, 200);
  await settled();

  const sent = mails();
  assert.equal(sent.length, 3, `expected three emails, saw ${JSON.stringify(sent)}`);
  assert.deepEqual(
    sent.map((row) => row.to).sort(),
    Object.values(addresses).sort(),
    'the six owners with no address on file hear nothing',
  );
  assert.ok(sent.every((row) => row.subject === 'Keepers are out'));
});

test('hiding keepers again mails nobody', async () => {
  await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: true }),
  });
  await settled();
  mailLog = [];

  await request('/api/league/keeper-visibility', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ revealed: false }),
  });
  await settled();
  assert.equal(mails().length, 0);
});

/* ─── The reminder clock ───────────────────────────────────────────────── */

test('the cron route refuses a wrong secret', async () => {
  process.env.CRON_SECRET = 'open-sesame';
  const wrong = await tick({ authorization: 'Bearer nope' });
  assert.equal(wrong.status, 401);
  const none = await tick();
  assert.equal(none.status, 401, 'with a secret set, even this machine needs it');
  await settled();
  assert.equal(mails().length, 0);
});

test('the right secret runs the clock, and each reminder goes out once', async () => {
  process.env.CRON_SECRET = 'open-sesame';
  const first = await tick({ authorization: 'Bearer open-sesame' });
  assert.equal(first.status, 200);
  const run = asRecord(first.body) as { due: number; sent: number };
  // Three owners have addresses, none has saved a keeper: the week warning
  // for all three, plus both keeper warnings for all three.
  assert.equal(run.due, 9);
  assert.equal(run.sent, 9);
  const firstBatch = mails();
  assert.equal(firstBatch.length, 9);
  assert.equal(
    new Set(firstBatch.map((row) => row.to)).size,
    3,
    'nobody without an address is mailed',
  );

  mailLog = [];
  const again = await tick({ authorization: 'Bearer open-sesame' });
  assert.equal(again.status, 200);
  const second = asRecord(again.body) as { due: number; sent: number };
  assert.equal(second.due, 0, 'the store remembers what already went out');
  assert.equal(second.sent, 0);
  assert.equal(mails().length, 0, 'ten people must not read the same warning twice');
});

test('with no secret set, only this machine may run the clock', async () => {
  delete process.env.CRON_SECRET;
  const local = await tick();
  assert.equal(local.status, 200, 'a request from 127.0.0.1 is allowed');
  assert.equal((asRecord(local.body) as { sent: number }).sent, 0);
});

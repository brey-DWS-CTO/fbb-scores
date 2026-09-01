import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Poll } from '../src/lib/league/polls.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const commissioner = 'Brey';
const pins: Record<string, string> = {
  Brey: '9000',
  Ryan: '1000',
  Amy: '2000',
  Joel: '3000',
  Aaron: '4000',
  Derek: '5000',
  Kyle: '6000',
  Dustin: '7000',
  Patrick: '8000',
  Bryan: '8100',
};

type StoreModule = typeof import('../server/lib/leagueStore.ts');

let tempRoot = '';
let store: StoreModule;
let server: Server;
let baseUrl = '';
let SEASON = 2027;

function auth(owner: string): Record<string, string> {
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

async function openPoll(
  owner: string,
  title = 'Expand IR to two slots',
  affects: string[] = [],
): Promise<{ status: number; body: unknown }> {
  return request('/api/league/polls', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ title, detail: 'Because one is not enough.', affects }),
  });
}

const vote = (owner: string, id: string, choice: string) =>
  request(`/api/league/polls/${id}/vote`, {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ choice }),
  });

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'polls-api-'));
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
  SEASON = (await store.getState()).state.season;
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
  await store.clearPollsForSeason(SEASON);
  await store.mutateState((draft) => {
    draft.draft.startedAt = null;
  });
});

// ─── Launching ─────────────────────────────────────────────────────────────

test('a member can launch a vote and everyone can see it', async () => {
  const created = await openPoll('Ryan');
  assert.equal(created.status, 200);
  const poll = created.body as Poll;
  assert.equal(poll.proposedBy, 'Ryan');
  assert.equal(poll.status, 'open');
  assert.equal(poll.threshold, 60);
  assert.equal(poll.eligibleVoters.length, 10, 'the roll is frozen at ten teams');

  const seen = asRecord((await request('/api/league/polls', { headers: auth('Amy') })).body);
  assert.equal((seen.polls as Poll[]).length, 1);
});

test('signing in is required to see or start a vote', async () => {
  assert.equal((await request('/api/league/polls')).status, 401);
  const anon = await request('/api/league/polls', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Sneaky' }),
  });
  assert.equal(anon.status, 401);
});

test('one vote per member per season', async () => {
  assert.equal((await openPoll('Ryan', 'First idea')).status, 200);

  const second = await openPoll('Ryan', 'Second idea');
  assert.equal(second.status, 409);
  assert.equal(asRecord(second.body).code, 'already-launched');

  // Someone else is unaffected.
  assert.equal((await openPoll('Amy', 'Amy idea')).status, 200);

  const you = asRecord((await request('/api/league/polls', { headers: auth('Ryan') })).body);
  assert.equal((you.you as Record<string, unknown>).canLaunch, false);
  const amy = asRecord((await request('/api/league/polls', { headers: auth('Joel') })).body);
  assert.equal((amy.you as Record<string, unknown>).canLaunch, true);
});

test('cancelling gives the member their launch back', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({ cancel: true }),
  });
  assert.equal((await openPoll('Ryan', 'A better idea')).status, 200);
});

test('nothing can be launched once the draft has started', async () => {
  await store.mutateState((draft) => {
    draft.draft.startedAt = new Date().toISOString();
  });
  const blocked = await openPoll('Ryan');
  assert.equal(blocked.status, 409);
  assert.equal(asRecord(blocked.body).code, 'draft-started');
});

test('an empty title is refused', async () => {
  const blocked = await openPoll('Ryan', '   ');
  assert.equal(blocked.status, 409);
  assert.equal(asRecord(blocked.body).code, 'empty-title');
});

test('a vote naming a rule that does not exist is refused', async () => {
  const bad = await openPoll('Ryan', 'Change something', ['no.such.rule']);
  assert.equal(bad.status, 400);
  assert.match(String(asRecord(bad.body).error), /not in the book/);
});

test('the threshold comes from the rules the vote would change', async () => {
  const strict = (await openPoll('Ryan', 'Change draft style', ['draft.serpentine.change']))
    .body as Poll;
  assert.equal(strict.threshold, 80, 'rule 2.1.1 needs 80%');
});

// ─── Voting ────────────────────────────────────────────────────────────────

test('six of ten carries it; five does not', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  const yes = ['Ryan', 'Amy', 'Joel', 'Aaron', 'Derek'];
  for (const owner of yes) assert.equal((await vote(owner, poll.id, 'yes')).status, 200);

  let closed = await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({}),
  });
  assert.equal((closed.body as Poll).status, 'failed', 'five yes is not enough');

  // Re-run with six.
  await store.clearPollsForSeason(SEASON);
  const second = (await openPoll('Ryan')).body as Poll;
  for (const owner of [...yes, 'Kyle']) await vote(owner, second.id, 'yes');
  closed = await request(`/api/league/polls/${second.id}/close`, {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({}),
  });
  assert.equal((closed.body as Poll).status, 'passed');
});

test('a member can change their vote while it is open', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  await vote('Amy', poll.id, 'yes');
  const after = (await vote('Amy', poll.id, 'no')).body as Poll;
  assert.equal(after.votes.filter((v) => v.owner === 'Amy').length, 1);
  assert.equal(after.votes.find((v) => v.owner === 'Amy')?.choice, 'no');
});

test('votes cast at the same moment are all kept', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  const voters = ['Ryan', 'Amy', 'Joel', 'Aaron', 'Derek', 'Kyle'];
  const results = await Promise.all(voters.map((owner) => vote(owner, poll.id, 'yes')));
  assert.ok(results.every((r) => r.status === 200), 'no vote was rejected');

  const stored = (await store.getPoll(poll.id)) as Poll;
  assert.equal(stored.votes.length, voters.length, 'nothing was lost to a race');
});

test('a closed vote takes no more votes', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({}),
  });
  const late = await vote('Amy', poll.id, 'yes');
  assert.equal(late.status, 409);
  assert.equal(asRecord(late.body).code, 'not-open');
});

test('nonsense choices and unknown votes are refused', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  assert.equal((await vote('Amy', poll.id, 'maybe')).status, 409);
  assert.equal((await vote('Amy', 'poll-nope', 'yes')).status, 404);
});

// ─── Closing ───────────────────────────────────────────────────────────────

test('only the proposer or a commissioner can close a vote', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  const outsider = await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({}),
  });
  assert.equal(outsider.status, 403);

  const byCommish = await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({}),
  });
  assert.equal(byCommish.status, 200);
  assert.equal((byCommish.body as Poll).closedBy, commissioner);
});

test('closing twice is refused', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  const body = JSON.stringify({});
  await request(`/api/league/polls/${poll.id}/close`, { method: 'POST', headers: auth('Ryan'), body });
  const again = await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth('Ryan'),
    body,
  });
  assert.equal(again.status, 409);
});

// ─── Audit ─────────────────────────────────────────────────────────────────

test('opening, voting, and closing are all written to the audit log', async () => {
  const poll = (await openPoll('Ryan')).body as Poll;
  await vote('Amy', poll.id, 'yes');
  await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({}),
  });

  const rows = (await request('/api/league/audit', { headers: auth(commissioner) })).body as Array<{
    action: string;
    owner: string;
  }>;
  assert.ok(rows.some((r) => r.action === 'poll-open' && r.owner === 'Ryan'));
  assert.ok(rows.some((r) => r.action === 'poll-vote' && r.owner === 'Amy'));
  assert.ok(rows.some((r) => r.action === 'poll-close' && r.owner === 'Ryan'));
});

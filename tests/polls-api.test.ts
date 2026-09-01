import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Poll } from '../src/lib/league/polls.ts';
import type { Rulebook } from '../src/lib/league/rulebook.ts';
import { rulebookFingerprint } from '../src/lib/league/rulebookDiff.ts';

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

/** A new-rule vote by default, so a caller only names clauses when it matters. */
async function openPoll(
  owner: string,
  title = 'Expand IR to two slots',
  affects: string[] = [],
  kind: unknown = 'new-rule',
): Promise<{ status: number; body: unknown }> {
  return request('/api/league/polls', {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ kind, title, detail: 'Because one is not enough.', affects }),
  });
}

/** A change vote against a rule that is really in the book. */
const openChange = (owner: string, title = 'Change the keeper cap', affects = ['keepers.cap']) =>
  openPoll(owner, title, affects, 'change');

const vote = (owner: string, id: string, choice: string) =>
  request(`/api/league/polls/${id}/vote`, {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({ choice }),
  });

const editPoll = (
  owner: string,
  id: string,
  input: { title?: string; detail?: string; affects?: string[] },
) =>
  request(`/api/league/polls/${id}/edit`, {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify(input),
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

test('the commissioner is not held to one vote a season', async () => {
  assert.equal((await openPoll(commissioner, 'First commissioner vote')).status, 200);
  assert.equal((await openPoll(commissioner, 'Second commissioner vote')).status, 200);
  assert.equal((await openPoll(commissioner, 'Third commissioner vote')).status, 200);

  const you = asRecord((await request('/api/league/polls', { headers: auth(commissioner) })).body)
    .you as Record<string, unknown>;
  assert.equal(you.canLaunch, true, 'the button never locks for the commissioner');
  assert.equal(you.hasLaunched, true);
  assert.equal(you.isCommissioner, true);

  // A plain member is still capped at one.
  assert.equal((await openPoll('Ryan', 'The one member vote')).status, 200);
  assert.equal((await openPoll('Ryan', 'A second member vote')).status, 409);
});

test('the commissioner is still bound by the draft deadline', async () => {
  await store.mutateState((draft) => {
    draft.draft.startedAt = new Date().toISOString();
  });
  const blocked = await openPoll(commissioner, 'Too late');
  assert.equal(blocked.status, 409);
  assert.equal(asRecord(blocked.body).code, 'draft-started');
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

test('a vote must say whether it is a new rule or a change', async () => {
  const missing = await request('/api/league/polls', {
    method: 'POST',
    headers: auth('Ryan'),
    body: JSON.stringify({ title: 'No kind given', detail: '', affects: [] }),
  });
  assert.equal(missing.status, 409);
  assert.equal(asRecord(missing.body).code, 'bad-kind');

  const nonsense = await openPoll('Ryan', 'Nonsense kind', [], 'whatever');
  assert.equal(nonsense.status, 409);
  assert.equal(asRecord(nonsense.body).code, 'bad-kind');
});

test('a change with no rule named is refused', async () => {
  const bare = await openPoll('Ryan', 'Change something', [], 'change');
  assert.equal(bare.status, 409);
  assert.equal(asRecord(bare.body).code, 'change-needs-clause');
});

test('a new rule needs no rule named', async () => {
  const created = await openPoll('Ryan', 'Add a trade deadline', [], 'new-rule');
  assert.equal(created.status, 200);
  assert.equal((created.body as Poll).kind, 'new-rule');
  assert.deepEqual((created.body as Poll).affects, []);
});

test('a change naming a rule that is not in the book is refused', async () => {
  const bad = await openPoll('Ryan', 'Change a ghost', ['no.such.rule'], 'change');
  assert.equal(bad.status, 400);
  assert.match(String(asRecord(bad.body).error), /not in the book/);
});

test('a change keeps the rule it names, so a passed vote knows what it touched', async () => {
  const created = await openChange('Ryan');
  assert.equal(created.status, 200);
  const poll = created.body as Poll;
  assert.equal(poll.kind, 'change');
  assert.deepEqual(poll.affects, ['keepers.cap']);
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

// ─── Editing an open vote ──────────────────────────────────────────────────

test('the commissioner can rewrite an open vote', async () => {
  const poll = (await openChange('Ryan', 'Raise the keeper cap')).body as Poll;
  const saved = await editPoll(commissioner, poll.id, {
    title: 'Raise the keeper cap to 80',
    detail: 'A clearer case for it.',
    affects: ['keepers.cap'],
  });
  assert.equal(saved.status, 200);
  const after = saved.body as Poll;
  assert.equal(after.title, 'Raise the keeper cap to 80');
  assert.equal(after.detail, 'A clearer case for it.');
  assert.equal(after.edits?.length, 1);
  assert.deepEqual(after.edits?.[0].changed, ['title', 'detail']);
  assert.equal(after.edits?.[0].by, commissioner);
});

test('no member can edit a vote, not even their own', async () => {
  const poll = (await openChange('Ryan')).body as Poll;
  const mine = await editPoll('Ryan', poll.id, {
    title: 'Sneaking a new question in',
    detail: 'x',
    affects: ['keepers.cap'],
  });
  assert.equal(mine.status, 403);
  const other = await editPoll('Amy', poll.id, {
    title: 'Not mine either',
    detail: 'x',
    affects: ['keepers.cap'],
  });
  assert.equal(other.status, 403);

  const stored = (await store.getPoll(poll.id)) as Poll;
  assert.equal(stored.title, 'Change the keeper cap', 'nothing was written');
  assert.equal(stored.edits, undefined);
});

test('changing what a vote asks clears the votes already cast', async () => {
  const poll = (await openChange('Ryan', 'Raise the keeper cap')).body as Poll;
  for (const owner of ['Ryan', 'Amy', 'Joel']) await vote(owner, poll.id, 'yes');
  await vote('Derek', poll.id, 'no');

  const saved = await editPoll(commissioner, poll.id, {
    title: 'Scrap the keeper cap entirely',
    detail: 'Because one is not enough.',
    affects: ['keepers.cap'],
  });
  assert.equal(saved.status, 200);
  const after = saved.body as Poll;
  assert.deepEqual(after.votes, [], 'four answers to a different question');
  assert.deepEqual(after.edits?.[0].changed, ['title']);
  assert.equal(after.edits?.[0].votesCleared, 4);
});

test('changing only the why leaves the votes standing', async () => {
  const poll = (await openChange('Ryan', 'Raise the keeper cap')).body as Poll;
  for (const owner of ['Ryan', 'Amy', 'Joel']) await vote(owner, poll.id, 'yes');

  const after = (
    await editPoll(commissioner, poll.id, {
      title: 'Raise the keeper cap',
      detail: 'A sharper argument, same question.',
      affects: ['keepers.cap'],
    })
  ).body as Poll;
  assert.equal(after.votes.length, 3);
  assert.deepEqual(after.edits?.[0].changed, ['detail']);
  assert.equal(after.edits?.[0].votesCleared, 0);
});

test('naming a stricter rule moves the bar with it', async () => {
  const poll = (await openChange('Ryan', 'Change something', ['format.size.change']))
    .body as Poll;
  assert.equal(poll.threshold, 60);
  const after = (
    await editPoll(commissioner, poll.id, {
      title: 'Change something',
      detail: 'Because one is not enough.',
      affects: ['draft.serpentine.change'],
    })
  ).body as Poll;
  assert.equal(after.threshold, 80, 'rule 2.1.1 needs 80%');
  assert.deepEqual(after.affects, ['draft.serpentine.change']);
});

test('an edit cannot break the vote or name a rule that is not in the book', async () => {
  const poll = (await openChange('Ryan')).body as Poll;
  const blank = await editPoll(commissioner, poll.id, {
    title: '   ',
    detail: 'x',
    affects: ['keepers.cap'],
  });
  assert.equal(blank.status, 409);
  assert.equal(asRecord(blank.body).code, 'empty-title');

  const bare = await editPoll(commissioner, poll.id, {
    title: 'Still a change',
    detail: 'x',
    affects: [],
  });
  assert.equal(bare.status, 409);
  assert.equal(asRecord(bare.body).code, 'change-needs-clause');

  const ghost = await editPoll(commissioner, poll.id, {
    title: 'Still a change',
    detail: 'x',
    affects: ['no.such.rule'],
  });
  assert.equal(ghost.status, 400);
  assert.match(String(asRecord(ghost.body).error), /not in the book/);

  const same = await editPoll(commissioner, poll.id, {
    title: poll.title,
    detail: poll.detail,
    affects: poll.affects,
  });
  assert.equal(same.status, 409);
  assert.equal(asRecord(same.body).code, 'no-change');
});

test('a closed vote cannot be edited', async () => {
  const poll = (await openChange('Ryan')).body as Poll;
  await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({}),
  });
  const late = await editPoll(commissioner, poll.id, {
    title: 'Too late',
    detail: 'x',
    affects: ['keepers.cap'],
  });
  assert.equal(late.status, 409);
  assert.equal(asRecord(late.body).code, 'not-open');
});

test('editing an unknown vote is a 404', async () => {
  const missing = await editPoll(commissioner, 'poll-nope', {
    title: 'Ghost',
    detail: 'x',
    affects: [],
  });
  assert.equal(missing.status, 404);
});

test('an edit is written to the audit log', async () => {
  const poll = (await openChange('Ryan', 'Raise the keeper cap')).body as Poll;
  await vote('Amy', poll.id, 'yes');
  await editPoll(commissioner, poll.id, {
    title: 'Scrap the keeper cap',
    detail: 'Because one is not enough.',
    affects: ['keepers.cap'],
  });

  const rows = (await request('/api/league/audit', { headers: auth(commissioner) })).body as Array<{
    action: string;
    owner: string;
    detail: unknown;
  }>;
  const row = rows.find((r) => r.action === 'poll-edit');
  assert.ok(row, 'the edit is on the record');
  assert.equal(row.owner, commissioner);
  const detail = asRecord(row.detail);
  assert.deepEqual(detail.changed, ['title']);
  assert.equal(detail.votesCleared, 1);
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

// ─── A passed vote becomes an amendment draft ──────────────────────────────

const YES_SIX = ['Ryan', 'Amy', 'Joel', 'Aaron', 'Derek', 'Kyle'];

/** Open a vote, carry it six to nothing, and close it. */
async function passPoll(
  owner: string,
  kind: 'change' | 'new-rule',
  affects: string[],
  title: string,
): Promise<Poll> {
  const poll = (await openPoll(owner, title, affects, kind)).body as Poll;
  for (const voter of YES_SIX) await vote(voter, poll.id, 'yes');
  const closed = await request(`/api/league/polls/${poll.id}/close`, {
    method: 'POST',
    headers: auth(owner),
    body: JSON.stringify({}),
  });
  const result = closed.body as Poll;
  assert.equal(result.status, 'passed');
  return result;
}

const amend = (owner: string, id: string) =>
  request(`/api/league/polls/${id}/amend`, { method: 'POST', headers: auth(owner) });

test('a passed change lands in the draft against the rule it named', async () => {
  await store.deleteRulebookDraft(SEASON);
  const publishedBefore = asRecord((await request('/api/league/rulebook')).body);
  const poll = await passPoll('Ryan', 'change', ['keepers.cap'], 'Raise the keeper cap');

  const seeded = await amend(commissioner, poll.id);
  assert.equal(seeded.status, 200);
  const body = asRecord(seeded.body);
  assert.deepEqual(body.focusIds, ['keepers.cap']);

  const draft = await store.getRulebookDraft(SEASON);
  assert.ok(draft, 'the draft was saved');
  assert.match(JSON.stringify(draft.book), /Raise the keeper cap/);

  const publishedAfter = asRecord((await request('/api/league/rulebook')).body);
  assert.deepEqual(
    publishedAfter.book,
    publishedBefore.book,
    'a vote never rewrites the published book by itself',
  );

  const stored = (await store.getPoll(poll.id)) as Poll;
  assert.ok(stored.seededAt, 'the vote records that it reached the draft');
  assert.equal(stored.seededBy, commissioner);
});

test('a passed new rule seeds a clause where the vote pointed', async () => {
  await store.deleteRulebookDraft(SEASON);
  const poll = await passPoll('Amy', 'new-rule', ['keepers.cap'], 'Add a trade deadline');
  assert.equal((await amend(commissioner, poll.id)).status, 200);
  const draft = await store.getRulebookDraft(SEASON);
  assert.match(JSON.stringify(draft?.book), /Add a trade deadline/);
});

test('only the commissioner turns a vote into an amendment', async () => {
  await store.deleteRulebookDraft(SEASON);
  const poll = await passPoll('Ryan', 'change', ['keepers.cap'], 'Members cannot seed');
  assert.equal((await amend('Amy', poll.id)).status, 403);
  assert.equal(await store.getRulebookDraft(SEASON), null, 'nothing was written');
});

test('a vote that has not passed cannot be seeded', async () => {
  await store.deleteRulebookDraft(SEASON);
  const open = (await openChange('Ryan', 'Still being voted on')).body as Poll;
  const refused = await amend(commissioner, open.id);
  assert.equal(refused.status, 409);
  assert.equal(asRecord(refused.body).code, 'not-passed');
});

test('the same vote is not seeded twice', async () => {
  await store.deleteRulebookDraft(SEASON);
  const poll = await passPoll('Ryan', 'change', ['keepers.cap'], 'Once only');
  assert.equal((await amend(commissioner, poll.id)).status, 200);
  const again = await amend(commissioner, poll.id);
  assert.equal(again.status, 409);
  assert.equal(asRecord(again.body).code, 'already-seeded');
});

test('publishing ties the vote to the revision that carried it', async () => {
  await store.deleteRulebookDraft(SEASON);
  const poll = await passPoll('Ryan', 'change', ['keepers.cap'], 'Written into the book');
  assert.equal((await amend(commissioner, poll.id)).status, 200);

  const draft = await store.getRulebookDraft(SEASON);
  assert.ok(draft);
  const published = await request('/api/league/rulebook/publish', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({
      fingerprint: rulebookFingerprint(draft.book as Rulebook),
      notes: 'Amendment from the vote',
    }),
  });
  assert.equal(published.status, 200);

  const stored = (await store.getPoll(poll.id)) as Poll;
  assert.equal(stored.appliedVersionId, asRecord(published.body).versionId);
  assert.equal(stored.appliedRevision, asRecord(published.body).revision);
  assert.ok(stored.appliedAt);
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

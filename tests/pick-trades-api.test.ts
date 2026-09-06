import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import { buildAllPicks, buildDraftBoard } from '../src/lib/keeper/engine.ts';
import type {
  LeagueDataset,
  LeagueDynamicState,
  PickRef,
  PickTradeProposal,
} from '../src/lib/keeper/types.ts';
import { datasetWithTransfers, transfersOf } from '../src/lib/league/pickTrades.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');
const dataset = rawDataset as unknown as LeagueDataset;

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

const ref = (round: number, originalOwner: string): PickRef => ({ round, originalOwner });

function propose(
  proposer: string,
  recipient: string,
  offer: PickRef[],
  request_: PickRef[],
  note = 'Straight swap.',
): Promise<{ status: number; body: unknown }> {
  return request('/api/league/pick-trades', {
    method: 'POST',
    headers: auth(proposer),
    body: JSON.stringify({ recipient, offer, request: request_, note }),
  });
}

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

const list = (owner: string) => request('/api/league/pick-trades', { headers: auth(owner) });

/** Who owns a pick according to what the server has stored. */
async function ownerOfPick(round: number, originalOwner: string): Promise<string | undefined> {
  const { state } = await store.getState();
  const data = datasetWithTransfers(dataset, transfersOf(state));
  return buildAllPicks(data).find(
    (pick) => pick.round === round && pick.originalOwner === originalOwner,
  )?.currentOwner;
}

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'pick-trades-api-'));
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
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepers = {};
    draft.keepersRevealed = false;
    draft.draft = { picks: {}, startedAt: null };
    draft.locks = { keepersLocked: false };
    draft.pickTransfers = [];
    draft.pickTradeProposals = [];
  });
});

/* ─── Sending an offer ─────────────────────────────────────────────────── */

test('a member offers picks and both sides see it', async () => {
  const created = await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
  assert.equal(created.status, 200);
  const proposal = asRecord(created.body).proposal as PickTradeProposal;
  assert.equal(proposal.proposer, 'Amy');
  assert.equal(proposal.recipient, 'Kyle');
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.version, 1);

  const kyle = asRecord((await list('Kyle')).body);
  assert.equal((kyle.proposals as PickTradeProposal[]).length, 1);
  assert.equal((kyle.you as Record<string, number>).inbox, 1);

  const amy = asRecord((await list('Amy')).body);
  assert.equal((amy.you as Record<string, number>).sent, 1);
  assert.equal((amy.you as Record<string, number>).inbox, 0);
});

test('the server takes the proposer from the PIN, never from the body', async () => {
  const created = await request('/api/league/pick-trades', {
    method: 'POST',
    headers: auth('Amy'),
    // Amy claims to be Joel and offers a pick Joel owns.
    body: JSON.stringify({
      proposer: 'Joel',
      recipient: 'Kyle',
      offer: [ref(2, 'Joel')],
      request: [ref(4, 'Kyle')],
      note: '',
    }),
  });
  assert.equal(created.status, 409, 'Amy cannot offer Joel pick');
  assert.match(String(asRecord(created.body).error), /not Amy's/);
});

test('signing in is required', async () => {
  assert.equal((await request('/api/league/pick-trades')).status, 401);
  const anon = await request('/api/league/pick-trades', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: 'Kyle', offer: [ref(2, 'Amy')], request: [ref(4, 'Kyle')] }),
  });
  assert.equal(anon.status, 401);
});

test('both sides need a pick and the picks must exist', async () => {
  assert.equal((await propose('Amy', 'Kyle', [], [ref(4, 'Kyle')])).status, 400);
  assert.equal((await propose('Amy', 'Amy', [ref(2, 'Amy')], [ref(4, 'Amy')])).status, 400);
  assert.equal((await propose('Amy', 'Kyle', [ref(99, 'Amy')], [ref(4, 'Kyle')])).status, 400);
});

/* ─── Accepting ────────────────────────────────────────────────────────── */

test('accepting moves both picks and writes the ledger', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  const done = await accept('Kyle', proposal.id, proposal.version);
  assert.equal(done.status, 200);
  assert.equal((asRecord(done.body).proposal as PickTradeProposal).status, 'accepted');

  assert.equal(await ownerOfPick(2, 'Amy'), 'Kyle');
  assert.equal(await ownerOfPick(4, 'Kyle'), 'Amy');

  const { state } = await store.getState();
  assert.equal(transfersOf(state).length, 2, 'one ledger row per pick');
  assert.ok(transfersOf(state).every((row) => row.proposalId === proposal.id));
});

test('an accepted trade is league news and appears in the audit log', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;
  await accept('Kyle', proposal.id, proposal.version);

  const outsider = asRecord((await list('Joel')).body);
  const seen = (outsider.proposals as PickTradeProposal[]).find((p) => p.id === proposal.id);
  assert.ok(seen, 'everyone sees a done trade');
  assert.deepEqual(seen.offer, [ref(2, 'Amy')], 'with the exact picks');

  const rows = (await request('/api/league/audit', { headers: auth(commissioner) }))
    .body as Array<{ action: string; owner: string; detail: Record<string, unknown> }>;
  const entry = rows.find((r) => r.action === 'pick-trade.accepted');
  assert.ok(entry);
  assert.equal(entry.owner, 'Kyle');
  assert.equal(entry.detail.proposalId, proposal.id);
  assert.equal(entry.detail.proposer, 'Amy');
  assert.equal(entry.detail.recipient, 'Kyle');
  assert.ok(entry.detail.acceptedAt);
  assert.deepEqual(entry.detail.offer, [ref(2, 'Amy')]);
  // The summary is the line a person reads. "R2 for R4" names two different
  // picks the same way, so it has to carry the exact number.
  assert.match(String(entry.detail.summary), /^\d+\.\d+ for \d+\.\d+$/);
});

test('only the recipient can accept, and the commissioner cannot accept for them', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  assert.equal((await accept('Amy', proposal.id, proposal.version)).status, 403);
  assert.equal((await accept('Joel', proposal.id, proposal.version)).status, 403);
  const byCommish = await accept(commissioner, proposal.id, proposal.version);
  assert.equal(byCommish.status, 403);
  assert.equal(await ownerOfPick(2, 'Amy'), 'Amy', 'nothing moved');
});

test('accepting twice does nothing the second time', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  assert.equal((await accept('Kyle', proposal.id, proposal.version)).status, 200);
  const again = await accept('Kyle', proposal.id, proposal.version);
  assert.equal(again.status, 409);
  assert.equal(asRecord(again.body).code, 'not-pending');

  const { state } = await store.getState();
  assert.equal(transfersOf(state).length, 2, 'the picks moved exactly once');
});

test('two members accepting at the same moment produce one trade', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  const results = await Promise.all([
    accept('Kyle', proposal.id, proposal.version),
    accept('Kyle', proposal.id, proposal.version),
    accept('Kyle', proposal.id, proposal.version),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);

  const { state } = await store.getState();
  assert.equal(transfersOf(state).length, 2);
});

test('a stale tab cannot accept an offer that changed', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  const stale = await accept('Kyle', proposal.id, proposal.version + 5);
  assert.equal(stale.status, 409);
  assert.equal(asRecord(stale.body).code, 'stale-version');
  assert.equal(await ownerOfPick(2, 'Amy'), 'Amy');
});

test('pulling an offer beats a later accept', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  assert.equal((await settle('Amy', proposal.id, 'cancel')).status, 200);
  const late = await accept('Kyle', proposal.id, proposal.version);
  assert.equal(late.status, 409);
  assert.equal(asRecord(late.body).code, 'not-pending');
  assert.equal(await ownerOfPick(2, 'Amy'), 'Amy');
});

test('turning an offer down keeps the record and moves nothing', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  const rejected = await settle('Kyle', proposal.id, 'reject');
  assert.equal(rejected.status, 200);
  assert.equal((asRecord(rejected.body).proposal as PickTradeProposal).status, 'rejected');
  assert.equal(await ownerOfPick(2, 'Amy'), 'Amy');

  const amy = asRecord((await list('Amy')).body);
  assert.ok(
    (amy.proposals as PickTradeProposal[]).some((p) => p.id === proposal.id),
    'history is kept, not deleted',
  );
});

/* ─── Ownership races ──────────────────────────────────────────────────── */

test('a pick that moved elsewhere kills the older offer instead of half trading', async () => {
  const first = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;
  const second = asRecord(
    (await propose('Amy', 'Joel', [ref(2, 'Amy')], [ref(5, 'Joel')])).body,
  ).proposal as PickTradeProposal;

  assert.equal((await accept('Joel', second.id, second.version)).status, 200);
  assert.equal(await ownerOfPick(2, 'Amy'), 'Joel');

  const late = await accept('Kyle', first.id, first.version);
  assert.equal(late.status, 409);

  const { state } = await store.getState();
  const filed = (state.pickTradeProposals ?? []).find((p) => p.id === first.id);
  assert.equal(filed?.status, 'invalidated', 'the dead offer is filed, not left waiting');
  assert.equal(transfersOf(state).length, 2, 'only the trade that won wrote anything');
  assert.equal(await ownerOfPick(4, 'Kyle'), 'Kyle', 'nothing partially executed');
});

test('shopping one pick to two teams settles the moment one of them accepts', async () => {
  await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')]);
  const second = await propose('Amy', 'Joel', [ref(2, 'Amy')], [ref(5, 'Joel')]);
  assert.equal(second.status, 200, 'the same pick may be offered to two teams');

  const target = asRecord(second.body).proposal as PickTradeProposal;
  assert.equal((await accept('Joel', target.id, target.version)).status, 200);

  const { state } = await store.getState();
  const other = (state.pickTradeProposals ?? []).find((p) => p.recipient === 'Kyle');
  assert.equal(other?.status, 'invalidated');
  assert.equal(transfersOf(state).length, 2, 'only one trade wrote to the ledger');
});

test('a pick can pass through three teams and keep its history', async () => {
  // Derek's 3rd is Ryan's from the committed seed.
  assert.equal(await ownerOfPick(3, 'Derek'), 'Ryan');

  const one = asRecord(
    (await propose('Ryan', 'Amy', [ref(3, 'Derek')], [ref(6, 'Amy')])).body,
  ).proposal as PickTradeProposal;
  assert.equal((await accept('Amy', one.id, one.version)).status, 200);
  assert.equal(await ownerOfPick(3, 'Derek'), 'Amy');
  assert.equal(await ownerOfPick(3, 'Ryan'), 'Ryan', 'Ryan still has his own 3rd');

  const two = asRecord(
    (await propose('Amy', 'Kyle', [ref(3, 'Derek')], [ref(7, 'Kyle')])).body,
  ).proposal as PickTradeProposal;
  assert.equal((await accept('Kyle', two.id, two.version)).status, 200);
  assert.equal(await ownerOfPick(3, 'Derek'), 'Kyle');

  const { state } = await store.getState();
  const chain = transfersOf(state).filter((row) => row.round === 3 && row.originalOwner === 'Derek');
  assert.deepEqual(chain.map((row) => `${row.from}>${row.to}`), ['Ryan>Amy', 'Amy>Kyle']);
});

/* ─── During the draft ─────────────────────────────────────────────────── */

test('the pick on the clock can be traded while it is empty', async () => {
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepersRevealed = true;
    draft.draft.startedAt = new Date().toISOString();
  });
  const { state } = await store.getState();
  const onClock = buildDraftBoard(dataset, state as never).find((cell) => cell.onClock);
  assert.ok(onClock);
  const holder = onClock.pick.currentOwner;
  const other = Object.keys(pins).find((o) => o !== holder && o in pins) as string;

  const created = await propose(
    holder,
    other,
    [ref(onClock.pick.round, onClock.pick.originalOwner)],
    [ref(14, other)],
  );
  assert.equal(created.status, 200);
  const proposal = asRecord(created.body).proposal as PickTradeProposal;
  assert.equal((await accept(other, proposal.id, proposal.version)).status, 200);
  assert.equal(await ownerOfPick(onClock.pick.round, onClock.pick.originalOwner), other);
});

test('a trade and a pick entered at the same moment cannot both win', async () => {
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepersRevealed = true;
    draft.draft.startedAt = new Date().toISOString();
  });
  const { state } = await store.getState();
  const onClock = buildDraftBoard(dataset, state as never).find((cell) => cell.onClock);
  assert.ok(onClock);
  const holder = onClock.pick.currentOwner;
  const other = Object.keys(pins).find((o) => o !== holder) as string;
  const player = dataset.players.find((candidate) => candidate.keeper.eligible);
  assert.ok(player);

  const proposal = asRecord(
    (await propose(
      holder,
      other,
      [ref(onClock.pick.round, onClock.pick.originalOwner)],
      [ref(14, other)],
    )).body,
  ).proposal as PickTradeProposal;

  const [traded, drafted] = await Promise.all([
    accept(other, proposal.id, proposal.version),
    request('/api/league/draft/pick', {
      method: 'POST',
      headers: auth(holder),
      body: JSON.stringify({
        overallPick: onClock.pick.overall,
        playerKey: player.key,
        playerName: player.name,
      }),
    }),
  ]);

  const winners = [traded.status, drafted.status].filter((s) => s === 200);
  assert.equal(winners.length, 1, 'exactly one of the two wins');

  const after = await store.getState();
  if (traded.status === 200) {
    assert.equal(
      after.state.draft.picks[String(onClock.pick.overall)],
      undefined,
      'the losing pick submission wrote nothing',
    );
  } else {
    assert.equal(transfersOf(after.state).length, 0, 'the losing trade wrote nothing');
  }
});

test('a pick already used in the draft cannot be traded', async () => {
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepersRevealed = true;
    draft.draft.startedAt = new Date().toISOString();
  });
  const { state } = await store.getState();
  const onClock = buildDraftBoard(dataset, state as never).find((cell) => cell.onClock);
  assert.ok(onClock);
  const holder = onClock.pick.currentOwner;
  const other = Object.keys(pins).find((o) => o !== holder) as string;
  const player = dataset.players.find((candidate) => candidate.keeper.eligible);
  assert.ok(player);

  assert.equal(
    (await request('/api/league/draft/pick', {
      method: 'POST',
      headers: auth(holder),
      body: JSON.stringify({
        overallPick: onClock.pick.overall,
        playerKey: player.key,
        playerName: player.name,
      }),
    })).status,
    200,
  );

  const blocked = await propose(
    holder,
    other,
    [ref(onClock.pick.round, onClock.pick.originalOwner)],
    [ref(14, other)],
  );
  assert.equal(blocked.status, 409);
  assert.match(String(asRecord(blocked.body).error), /already been used/);
});

test('a traded pick changes who may enter the pick on the clock', async () => {
  await store.mutateState((draft: LeagueDynamicState) => {
    draft.keepersRevealed = true;
    draft.draft.startedAt = new Date().toISOString();
  });
  const first = await store.getState();
  const onClock = buildDraftBoard(dataset, first.state as never).find((cell) => cell.onClock);
  assert.ok(onClock);
  const holder = onClock.pick.currentOwner;
  const other = Object.keys(pins).find((o) => o !== holder && o !== commissioner) as string;
  const player = dataset.players.find((candidate) => candidate.keeper.eligible);
  assert.ok(player);

  const proposal = asRecord(
    (await propose(
      holder,
      other,
      [ref(onClock.pick.round, onClock.pick.originalOwner)],
      [ref(14, other)],
    )).body,
  ).proposal as PickTradeProposal;
  await accept(other, proposal.id, proposal.version);

  const body = JSON.stringify({
    overallPick: onClock.pick.overall,
    playerKey: player.key,
    playerName: player.name,
  });
  const oldOwner = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth(holder),
    body,
  });
  assert.equal(oldOwner.status, 403, 'the team that traded it away can no longer use it');
  assert.match(String(asRecord(oldOwner.body).error), new RegExp(other));

  const newOwner = await request('/api/league/draft/pick', {
    method: 'POST',
    headers: auth(other),
    body,
  });
  assert.equal(newOwner.status, 200);
});

/* ─── Keepers ──────────────────────────────────────────────────────────── */

test('the preview reports how a trade changes keeper pick costs', async () => {
  const player = dataset.players.find(
    (candidate) =>
      candidate.fantasyTeam === 'Amy'
      && candidate.keeper.eligible
      && candidate.keeper.round !== null
      && candidate.keeper.round >= 3
      && candidate.keeper.contract === null,
  );
  assert.ok(player, 'fixture needs a keepable Amy player outside rounds 1-2');
  const round = player.keeper.round as number;

  assert.equal(
    (await request(`/api/league/keepers/Amy`, {
      method: 'PUT',
      headers: auth('Amy'),
      body: JSON.stringify({ selections: [{ playerKey: player.key, playerName: player.name }] }),
    })).status,
    200,
  );

  const preview = await request('/api/league/pick-trades/preview', {
    method: 'POST',
    headers: auth('Amy'),
    body: JSON.stringify({ recipient: 'Kyle', offer: [ref(round, 'Amy')], request: [ref(14, 'Kyle')] }),
  });
  assert.equal(preview.status, 200);
  const sides = asRecord(preview.body).sides as Array<Record<string, unknown>>;
  const amy = sides.find((side) => side.owner === 'Amy');
  assert.ok(amy);
  assert.equal(amy.detailed, true, 'you always see your own keepers');
  assert.equal((amy.changes as unknown[]).length, 1);

  const kyle = sides.find((side) => side.owner === 'Kyle');
  assert.equal(kyle?.detailed, false, 'the other side stays secret before the reveal');
});

test('once keepers are locked a trade that breaks one is refused', async () => {
  const player = dataset.players.find(
    (candidate) =>
      candidate.fantasyTeam === 'Amy' && candidate.keeper.eligible && candidate.keeper.round === 1,
  );
  assert.ok(player, 'fixture needs a round-1 keeper on Amy');

  await request('/api/league/keepers/Amy', {
    method: 'PUT',
    headers: auth('Amy'),
    body: JSON.stringify({ selections: [{ playerKey: player.key, playerName: player.name }] }),
  });
  const open = await propose('Amy', 'Kyle', [ref(1, 'Amy')], [ref(14, 'Kyle')]);
  assert.equal(open.status, 200, 'allowed while keepers are still open');
  const proposal = asRecord(open.body).proposal as PickTradeProposal;

  await request('/api/league/locks', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ keepersLocked: true }),
  });

  const blocked = await accept('Kyle', proposal.id, proposal.version);
  assert.equal(blocked.status, 409);
  assert.equal(asRecord(blocked.body).code, 'keeper-broken');
  assert.equal(await ownerOfPick(1, 'Amy'), 'Amy');

  await request('/api/league/locks', {
    method: 'POST',
    headers: auth(commissioner),
    body: JSON.stringify({ keepersLocked: false }),
  });
});

/* ─── Privacy and commissioner support ─────────────────────────────────── */

test('a pending offer stays between the two members', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  const outsider = asRecord((await list('Joel')).body).proposals as PickTradeProposal[];
  assert.equal(outsider.length, 0, 'nobody else knows it exists');

  const anon = asRecord((await request('/api/league/state')).body);
  const anonState = anon.state as Record<string, unknown>;
  assert.deepEqual(anonState.pickTradeProposals, [], 'the polled state leaks nothing');

  const previewByOutsider = await request('/api/league/pick-trades/preview', {
    method: 'POST',
    headers: auth('Joel'),
    body: JSON.stringify({ id: proposal.id }),
  });
  assert.equal(previewByOutsider.status, 403);
});

test('a commissioner sees that an offer exists but not what is in it', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;

  const commish = asRecord((await list(commissioner)).body).proposals as PickTradeProposal[];
  const seen = commish.find((p) => p.id === proposal.id);
  assert.ok(seen);
  assert.deepEqual(seen.offer, []);
  assert.deepEqual(seen.request, []);

  // And can clear it, which is the one support action allowed.
  const cleared = await settle(commissioner, proposal.id, 'cancel');
  assert.equal(cleared.status, 200);
  assert.equal((asRecord(cleared.body).proposal as PickTradeProposal).status, 'cancelled');
  assert.equal(await ownerOfPick(2, 'Amy'), 'Amy');
});

test('an outsider cannot pull or turn down someone else offer', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;
  assert.equal((await settle('Joel', proposal.id, 'cancel')).status, 403);
  assert.equal((await settle('Joel', proposal.id, 'reject')).status, 403);
  assert.equal((await settle('Amy', proposal.id, 'reject')).status, 403, 'the proposer pulls, not rejects');
});

/* ─── Persistence ──────────────────────────────────────────────────────── */

test('trades and their ledger survive a fresh read of the store', async () => {
  const proposal = asRecord(
    (await propose('Amy', 'Kyle', [ref(2, 'Amy')], [ref(4, 'Kyle')])).body,
  ).proposal as PickTradeProposal;
  await accept('Kyle', proposal.id, proposal.version);

  // A second import of the store module reads the same file from disk.
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const reread = (await import(`${storeUrl}?fresh=1`)) as StoreModule;
  const { state } = await reread.getState();
  assert.equal(transfersOf(state).length, 2);
  const stored = (state.pickTradeProposals ?? []).find((p) => p.id === proposal.id);
  assert.equal(stored?.status, 'accepted');
  assert.equal(stored?.resolvedBy, 'Kyle');
});

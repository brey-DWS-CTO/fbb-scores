import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after, before, beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { HouseParty, NbaGame } from '../src/lib/league/houseParty.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const tempParent = path.join(repoRoot, 'node_modules', '.tmp');

const pins: Record<string, string> = {
  Brey: '9000',
  Ryan: '1000',
  Amy: '2000',
  Kyle: '6000',
  Dustin: '7000',
};

type StoreModule = typeof import('../server/lib/leagueStore.ts');
type ScoreboardModule = typeof import('../server/lib/scoreboardService.ts');

let tempRoot = '';
let store: StoreModule;
let scoreboard: ScoreboardModule;
let server: Server;
let baseUrl = '';
let SEASON = 2027;

function auth(owner: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-owner': owner, 'x-pin': pins[owner] };
}

async function request(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return { status: response.status, body: await response.json() };
}

const post = (owner: string, pathname: string, body: unknown) =>
  request(pathname, { method: 'POST', headers: auth(owner), body: JSON.stringify(body) });
const put = (owner: string, pathname: string, body: unknown) =>
  request(pathname, { method: 'PUT', headers: auth(owner), body: JSON.stringify(body) });

/** Two weeks out, so nothing is ever "over" while the tests run. */
const soon = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const game = (id: string, home: string, away: string, tipoff: string, tv: string | null = null): NbaGame => ({
  id, home, away, tipoff, tv, state: 'pre', detail: '', homeScore: null, awayScore: null,
});

const GAMES: NbaGame[] = [
  game('g1', 'GSW', 'LAL', soon(30), 'TNT'),
  game('g2', 'DEN', 'MIN', soon(32)),
  game('g3', 'SAC', 'PHX', soon(72)),
  { ...game('g0', 'BOS', 'MIA', soon(-30)), state: 'post' },
];

const partyOf = (body: unknown) => (body as { party: HouseParty }).party;

before(async () => {
  mkdirSync(tempParent, { recursive: true });
  tempRoot = mkdtempSync(path.join(tempParent, 'house-party-api-'));
  cpSync(path.join(repoRoot, 'server'), path.join(tempRoot, 'server'), { recursive: true });
  cpSync(path.join(repoRoot, 'src'), path.join(tempRoot, 'src'), { recursive: true });

  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';

  const appUrl = pathToFileURL(path.join(tempRoot, 'server', 'app.ts')).href;
  const storeUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'leagueStore.ts')).href;
  const boardUrl = pathToFileURL(path.join(tempRoot, 'server', 'lib', 'scoreboardService.ts')).href;
  const [{ default: app }, storeModule, boardModule] = await Promise.all([
    import(appUrl),
    import(storeUrl) as Promise<StoreModule>,
    import(boardUrl) as Promise<ScoreboardModule>,
  ]);
  store = storeModule;
  scoreboard = boardModule;
  SEASON = (await store.getState()).state.season;
  for (const [owner, pin] of Object.entries(pins)) await store.setPin(owner, pin);
  scoreboard.pinScoreboard(GAMES);

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
  await store.clearPartiesForSeason(SEASON);
  for (const owner of Object.keys(pins)) await store.setFavorites(owner, null, null);
});

// ─── Favorites ──────────────────────────────────────────────────────────────

test('a member sets, changes and clears their own favorites; everyone can see them', async () => {
  const set = await put('Kyle', '/api/league/favorites', { first: 'Warriors', second: '' });
  assert.equal(set.status, 200);
  assert.deepEqual((set.body as { favorites: unknown }).favorites, { Kyle: { first: 'GSW', second: null } });

  const two = await put('Dustin', '/api/league/favorites', { first: 'PHI', second: 'LAL' });
  assert.equal(two.status, 200);

  const seen = await request('/api/league/favorites', { headers: auth('Amy') });
  assert.deepEqual((seen.body as { favorites: unknown }).favorites, {
    Kyle: { first: 'GSW', second: null },
    Dustin: { first: 'PHI', second: 'LAL' },
  });

  const bad = await put('Kyle', '/api/league/favorites', { first: 'Raiders' });
  assert.equal(bad.status, 400);
  assert.equal((bad.body as { code: string }).code, 'bad-team');

  const cleared = await put('Kyle', '/api/league/favorites', { first: null });
  assert.equal(cleared.status, 200);
  assert.deepEqual((cleared.body as { favorites: Record<string, unknown> }).favorites.Kyle, undefined);
});

test('only the commish sets another owner\'s favorites', async () => {
  const denied = await put('Kyle', '/api/league/favorites/Amy', { first: 'SAC' });
  assert.equal(denied.status, 403);
  const set = await put('Brey', '/api/league/favorites/Amy', { first: 'SAC' });
  assert.equal(set.status, 200);
  assert.deepEqual((set.body as { favorites: Record<string, unknown> }).favorites.Amy, { first: 'SAC', second: null });
  const nobody = await put('Brey', '/api/league/favorites/Nobody', { first: 'SAC' });
  assert.equal(nobody.status, 404);
});

test('favorites need a sign-in', async () => {
  const anon = await request('/api/league/favorites');
  assert.equal(anon.status, 401);
});

// ─── WATCH ──────────────────────────────────────────────────────────────────

test('WATCH carries the games, favorites, every owner\'s roster and the parties', async () => {
  await put('Kyle', '/api/league/favorites', { first: 'GSW' });
  const watch = await request('/api/league/watch', { headers: auth('Kyle') });
  assert.equal(watch.status, 200);
  const body = watch.body as { games: NbaGame[]; favorites: unknown; rosters: Record<string, unknown[]>; parties: unknown[]; error: null };
  assert.deepEqual(body.games.map((row) => row.id), ['g1', 'g2', 'g3', 'g0']);
  assert.deepEqual(body.favorites, { Kyle: { first: 'GSW', second: null } });
  assert.ok(Object.keys(body.rosters).length >= 10, 'one roster an owner, empty before the draft');
  assert.deepEqual(body.parties, []);
  assert.equal(body.error, null);
});

// ─── Parties ────────────────────────────────────────────────────────────────

test('a member hosts a party, others join, the host cannot leave, and the share page shows it to anyone', async () => {
  const opened = await post('Kyle', '/api/league/parties', { gameIds: ['g1', 'g2'], hosting: true, note: ' 12 Elm St.  Bring beer. ' });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const party = partyOf(opened.body);
  assert.match(party.id, /^[a-z2-9]{8}$/);
  assert.equal(party.host, 'Kyle');
  assert.equal(party.note, '12 Elm St. Bring beer.');
  assert.deepEqual(party.games.map((row) => row.id), ['g1', 'g2']);
  assert.deepEqual(party.rsvps.map((row) => row.owner), ['Kyle']);

  const joined = await post('Dustin', `/api/league/parties/${party.id}/rsvp`, { answer: 'in' });
  assert.equal(joined.status, 200);
  assert.deepEqual(partyOf(joined.body).rsvps.map((row) => [row.owner, row.answer]), [['Kyle', 'in'], ['Dustin', 'in']]);

  const hostOut = await post('Kyle', `/api/league/parties/${party.id}/rsvp`, { answer: 'out' });
  assert.equal(hostOut.status, 403);

  const shrug = await post('Amy', `/api/league/parties/${party.id}/rsvp`, { answer: 'maybe' });
  assert.equal(shrug.status, 409);

  const shared = await request(`/api/league/parties/${party.id}/public`);
  assert.equal(shared.status, 200);
  const page = shared.body as { party: { host: string; guests: string[]; note: string }; headline: string };
  assert.equal(page.party.host, 'Kyle');
  assert.deepEqual(page.party.guests, ['Kyle', 'Dustin']);
  assert.equal(page.party.note, '12 Elm St. Bring beer.');
  assert.match(page.headline, /^Lakers at Warriors, .* Kyle is hosting\. Plus 1 more game\.$/);
  assert.equal((shared.body as Record<string, unknown>).rsvps, undefined, 'the public view carries names only');

  const missing = await request('/api/league/parties/nope1234/public');
  assert.equal(missing.status, 404);
});

test('an "up for it" has no host until someone takes it; then nobody else can', async () => {
  const opened = await post('Ryan', '/api/league/parties', { gameIds: ['g3'], hosting: false });
  assert.equal(opened.status, 200);
  const party = partyOf(opened.body);
  assert.equal(party.host, null);

  const taken = await post('Dustin', `/api/league/parties/${party.id}/host`, { note: 'My place.' });
  assert.equal(taken.status, 200);
  assert.equal(partyOf(taken.body).host, 'Dustin');
  assert.equal(partyOf(taken.body).note, 'My place.');
  assert.deepEqual(partyOf(taken.body).rsvps.map((row) => row.owner), ['Ryan', 'Dustin']);

  const late = await post('Kyle', `/api/league/parties/${party.id}/host`, { note: '' });
  assert.equal(late.status, 409);
  assert.equal((late.body as { code: string }).code, 'already-hosted');
});

test('party games are checked: on the schedule, one night, three at most, none over', async () => {
  const none = await post('Kyle', '/api/league/parties', { gameIds: [], hosting: true });
  assert.equal(none.status, 409);
  const unknown = await post('Kyle', '/api/league/parties', { gameIds: ['g1', 'zzz'], hosting: true });
  assert.equal(unknown.status, 404);
  const split = await post('Kyle', '/api/league/parties', { gameIds: ['g1', 'g3'], hosting: true });
  assert.equal(split.status, 409);
  assert.equal((split.body as { code: string }).code, 'different-nights');
  const over = await post('Kyle', '/api/league/parties', { gameIds: ['g0'], hosting: true });
  assert.equal(over.status, 409);
  assert.equal((over.body as { code: string }).code, 'over');
  const long = await post('Kyle', '/api/league/parties', { gameIds: ['g1'], hosting: true, note: 'x'.repeat(300) });
  assert.equal(long.status, 409);
});

test('the host edits and calls off; a guest may not; the commish may', async () => {
  const party = partyOf((await post('Kyle', '/api/league/parties', { gameIds: ['g1'], hosting: true, note: 'Old.' })).body);

  const guestEdit = await post('Dustin', `/api/league/parties/${party.id}/edit`, { note: 'Mine.' });
  assert.equal(guestEdit.status, 403);

  const edited = await post('Kyle', `/api/league/parties/${party.id}/edit`, { gameIds: ['g2', 'g1'], note: 'New.' });
  assert.equal(edited.status, 200);
  assert.deepEqual(partyOf(edited.body).games.map((row) => row.id), ['g2', 'g1']);
  assert.equal(partyOf(edited.body).note, 'New.');

  const guestOff = await post('Dustin', `/api/league/parties/${party.id}/cancel`, {});
  assert.equal(guestOff.status, 403);

  const off = await post('Brey', `/api/league/parties/${party.id}/cancel`, {});
  assert.equal(off.status, 200);
  assert.ok(partyOf(off.body).cancelledAt);

  const tooLate = await post('Dustin', `/api/league/parties/${party.id}/rsvp`, { answer: 'in' });
  assert.equal(tooLate.status, 409);

  const listed = await request('/api/league/parties', { headers: auth('Amy') });
  assert.equal((listed.body as { parties: HouseParty[] }).parties.length, 1, 'called-off parties stay on the list for the screen to sort');

  const gone = await post('Kyle', '/api/league/parties/nope1234/rsvp', { answer: 'in' });
  assert.equal(gone.status, 404);
});

test('people in a party can invite; the invited see a popup until they answer or put it off', async () => {
  const party = partyOf((await post('Kyle', '/api/league/parties', { gameIds: ['g1'], hosting: true })).body);

  const outsider = await post('Ryan', `/api/league/parties/${party.id}/invite`, { owners: ['Dustin'] });
  assert.equal(outsider.status, 409);
  assert.equal((outsider.body as { code: string }).code, 'not-in');

  const asked = await post('Kyle', `/api/league/parties/${party.id}/invite`, { owners: ['Dustin', 'Amy', 'Nobody'] });
  assert.equal(asked.status, 200);
  assert.deepEqual(partyOf(asked.body).invites?.map((row) => row.owner), ['Dustin', 'Amy']);

  const waiting = await request('/api/league/invites', { headers: auth('Dustin') });
  assert.equal(waiting.status, 200);
  const invites = (waiting.body as { invites: Array<{ party: HouseParty; by: string }> }).invites;
  assert.deepEqual(invites.map((row) => [row.party.id, row.by]), [[party.id, 'Kyle']]);

  const later = await post('Dustin', `/api/league/parties/${party.id}/invite/later`, {});
  assert.equal(later.status, 200);
  const quiet = await request('/api/league/invites', { headers: auth('Dustin') });
  assert.deepEqual((quiet.body as { invites: unknown[] }).invites, []);

  await post('Amy', `/api/league/parties/${party.id}/rsvp`, { answer: 'in' });
  const answered = await request('/api/league/invites', { headers: auth('Amy') });
  assert.deepEqual((answered.body as { invites: unknown[] }).invites, []);
});

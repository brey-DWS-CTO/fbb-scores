import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import axios from 'axios';
import type { LmAddRequest } from '../src/lib/league/lmWeekend.js';
import { pacific } from '../src/lib/league/lmWeekend.js';

const root = path.resolve(import.meta.dirname, '..');
let tempRoot = '';
let server: Server;
let base = '';
let store: typeof import('../server/lib/leagueStore.ts');
let forDate = '';
const originalAdapter = axios.defaults.adapter;
const auth = (owner: string) => ({ 'content-type': 'application/json', 'x-owner': owner, 'x-pin': owner === 'Brey' ? '9000' : '1000' });

before(async () => {
  const parent = path.join(root, 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  tempRoot = mkdtempSync(path.join(parent, 'lm-privacy-'));
  cpSync(path.join(root, 'package.json'), path.join(tempRoot, 'package.json'));
  for (const folder of ['server', 'src']) cpSync(path.join(root, folder), path.join(tempRoot, folder), { recursive: true });
  process.env.DATABASE_URL = '';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  // Never contact ESPN or send a real roster transaction.
  process.env.ESPN_LEAGUE_ID = 'test';
  process.env.ESPN_COOKIE_STRING = 'test';
  process.env.ESPN_LM_DRY_RUN = '1';
  axios.defaults.adapter = async config => {
    if (config.params?.view === 'mSettings') return { config, status: 200, statusText: 'OK', headers: {}, data: {scoringPeriodId: 5} };
    if (config.params?.view === 'mTransactions2') {
      assert.deepEqual(JSON.parse(String(config.headers.get('x-fantasy-filter'))).transactions.filterType.value, ['WAIVER', 'WAIVER_ERROR']);
      return {config, status: 200, statusText:'OK', headers:{}, data:{id:1,transactions:[
        {id:'win',type:'WAIVER',status:'EXECUTED',teamId:1,processDate:Date.now()-1000,bidAmount:9,items:[{type:'ADD',playerId:100}]},
        {id:'loss',type:'WAIVER_ERROR',status:'FAILED',teamId:1,processDate:Date.now()-1000,bidAmount:3,items:[{type:'ADD',playerId:100}]},
        {id:'secret',type:'WAIVER',status:'PENDING',teamId:1,proposedDate:Date.now()-1000,bidAmount:99,items:[{type:'ADD',playerId:101}]},
      ]}};
    }
    if (config.params?.view === 'kona_player_info') return {config, status:200, statusText:'OK', headers:{}, data:{players:[]}};
    assert.ok(config.url?.includes('/scoreboard'), `Unexpected external request: ${config.url}`);
    const date = String(config.params.dates).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    return { config, status: 200, statusText: 'OK', headers: {}, data: { events: [{ competitions: [{ date: `${date}T23:00:00Z`, competitors: [{ homeAway: 'home', team: { abbreviation: 'DEN' } }, { homeAway: 'away', team: { abbreviation: 'LAL' } }] }] }] } };
  };
  const [{ default: app }, loaded] = await Promise.all([
    import(pathToFileURL(path.join(tempRoot, 'server/app.ts')).href),
    import(pathToFileURL(path.join(tempRoot, 'server/lib/leagueStore.ts')).href),
  ]);
  store = loaded;
  await store.setPin('Brey', '9000');
  await store.setPin('Joel', '1000');
  await store.setPin('Amy', '1000');
  const day = new Date(`${pacific(new Date()).date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + ((6 - day.getUTCDay() + 7) % 7 || 7));
  forDate = day.toISOString().slice(0, 10);
  const statuses: LmAddRequest['status'][] = ['queued', 'processing', 'requested', 'waiting-for-drop', 'failsafe', 'denied', 'cancelled', 'added'];
  for (const owner of ['Joel', 'Amy']) for (const status of statuses) {
    await store.saveLmAddRequest({ id: `${owner}-${status}`, season: 2027, owner, teamId: 1, playerId: 100, playerName: `${owner} secret ${status}`, proTeam: 'DEN', requestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), forDate, status, note: 'Private details', handledBy: null });
  }
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test('offers report reads ESPN reports but never returns pending offers', async () => {
  const response = await fetch(`${base}/api/league/waiver-offers`);
  const report = await response.json();
  assert.equal(response.status, 200, JSON.stringify(report));
  assert.equal(report.scoringPeriodId, 5);
  assert.equal(report.rows.length, 2);
  assert.deepEqual(report.rows.map((row: {bid: number}) => row.bid).sort((a: number,b: number)=>a-b), [3,9]);
  assert.ok(!JSON.stringify(report).includes('secret'));
  for (const period of ['0','-1','401','junk','1.5']) assert.equal((await fetch(`${base}/api/league/waiver-offers?period=${period}`)).status,400);
});

after(async () => {
  axios.defaults.adapter = originalAdapter;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('anonymous and forged credentials see completed adds only; responses cannot be shared-cached', async () => {
  for (const headers of [undefined, { 'x-owner': 'Brey', 'x-pin': 'wrong' }]) {
    const response = await fetch(`${base}/api/league/lm-adds`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json();
    assert.deepEqual(body.requests.map((row: LmAddRequest) => row.id).sort(), ['Amy-added', 'Joel-added']);
  }
});

test('members see their own requests and only other owners completed adds; commissioner sees all', async () => {
  for (const owner of ['Joel', 'Amy', 'Brey']) {
    const response = await fetch(`${base}/api/league/lm-adds`, { headers: auth(owner) });
    const body = await response.json();
    assert.equal(body.requests.length, owner === 'Brey' ? 16 : 9);
    assert.ok(body.requests.every((row: LmAddRequest) => owner === 'Brey' || row.owner === owner || row.status === 'added'));
  }
});

test('owners can cancel their own queued claim but cannot cancel someone else; commissioner can', async () => {
  const cancel = (id: string, owner: string) => fetch(`${base}/api/league/lm-claims/${id}/cancel`, { method: 'POST', headers: auth(owner), body: '{}' });
  assert.equal((await cancel('Amy-queued', 'Joel')).status, 400);
  assert.equal((await cancel('Joel-queued', 'Joel')).status, 200);
  assert.equal((await cancel('Amy-queued', 'Brey')).status, 200);
  assert.equal((await cancel('Joel-processing', 'Joel')).status, 400);
});

test('queuing through the real route is private and repeated submission does not duplicate it', async () => {
  const { FALLBACK_PLAYER_POOL } = await import(pathToFileURL(path.join(tempRoot, 'server/lib/playerPoolService.ts')).href);
  const playerId = FALLBACK_PLAYER_POOL.players.find((player: { espnId: number | null }) => player.espnId)?.espnId;
  assert.ok(playerId);
  const queue = () => fetch(`${base}/api/league/lm-claims`, { method: 'POST', headers: auth('Joel'), body: JSON.stringify({ playerId, forDate }) });
  const first = await queue();
  assert.equal(first.status, 200);
  const { request } = await first.json();
  assert.equal(request.status, 'queued');
  assert.equal((await (await queue()).json()).request.id, request.id);
  const other = await (await fetch(`${base}/api/league/lm-adds`, { headers: auth('Amy') })).json();
  assert.ok(!other.requests.some((row: LmAddRequest) => row.id === request.id));
  const commish = await (await fetch(`${base}/api/league/lm-adds`, { headers: auth('Brey') })).json();
  assert.ok(commish.requests.some((row: LmAddRequest) => row.id === request.id));
});

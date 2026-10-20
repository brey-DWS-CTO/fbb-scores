import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset, PickTradeProposal } from '../src/lib/keeper/types.ts';
import { leagueActivity, mergedActivity } from '../src/lib/league/activity.ts';
import type { Move } from '../src/lib/league/transactions.ts';

const dataset = rawDataset as unknown as LeagueDataset;
const SEASON = dataset.season;

const proposal = (id: string, status: PickTradeProposal['status'], resolvedAt?: string): PickTradeProposal => ({
  id,
  season: SEASON,
  proposer: 'Amy',
  recipient: 'Kyle',
  offer: [{ season: SEASON, round: 7, originalOwner: 'Amy' }],
  request: [{ season: SEASON, round: 4, originalOwner: 'Kyle' }],
  note: '',
  status,
  version: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-08T00:00:00.000Z',
  resolvedAt,
});

test('the activity log lists accepted trades only, newest first, with who got what', () => {
  const log = leagueActivity([
    proposal('old', 'accepted', '2026-10-02T00:00:00.000Z'),
    proposal('open', 'pending'),
    proposal('no', 'rejected', '2026-10-03T00:00:00.000Z'),
    proposal('new', 'accepted', '2026-10-05T00:00:00.000Z'),
  ], dataset);
  assert.deepEqual(log.map((entry) => entry.id), ['new', 'old']);
  assert.equal(log[0].title, 'Amy and Kyle traded');
  assert.match(log[0].lines[0], /^Amy gets 4\.\d+\.$/);
  assert.match(log[0].lines[1], /^Kyle gets 7\.\d+\.$/);
});

test('ESPN moves and pick trades share one list, newest first, cut to the limit', () => {
  const trades = leagueActivity([proposal('t1', 'accepted', '2026-10-05T00:00:00.000Z')], dataset);
  const move = (id: string, at: string): Move => ({
    id, at, kind: 'add', owners: ['Kyle'], title: `Kyle added ${id}`, lines: [], byLeagueManager: false,
  });
  const log = mergedActivity(trades, [move('m1', '2026-10-04T00:00:00.000Z'), move('m2', '2026-10-06T00:00:00.000Z')], 2);
  assert.deepEqual(log.map((entry) => [entry.id, entry.kind]), [['move:m2', 'move'], ['t1', 'trade']]);
});

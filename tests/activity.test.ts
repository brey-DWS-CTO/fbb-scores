import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset, PickTradeProposal } from '../src/lib/keeper/types.ts';
import { leagueActivity } from '../src/lib/league/activity.ts';

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

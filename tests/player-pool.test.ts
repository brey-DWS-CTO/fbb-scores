import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.ts';
import {
  playerPoolFromDataset,
  previewPlayerPoolRefresh,
  type EspnPlayerPoolPlayer,
  type PlayerPoolPlayer,
} from '../src/lib/league/playerPool.ts';

const dataset = rawDataset as unknown as LeagueDataset;

const current: PlayerPoolPlayer[] = [
  {
    key: 'p1',
    espnId: 1,
    fullName: 'Alpha Guard',
    proTeam: 'AAA',
    positions: ['PG'],
    sourceStatus: 'fetched',
  },
  {
    key: 'p2',
    espnId: 2,
    fullName: 'Beta Wing',
    proTeam: 'BBB',
    positions: ['SG', 'SF'],
    sourceStatus: 'fetched',
  },
  {
    key: 'p3',
    espnId: 3,
    fullName: 'Gamma Center',
    proTeam: 'CCC',
    positions: ['C'],
    sourceStatus: 'fetched',
  },
];

test('seeds a stable draft pool from the committed keeper dataset', () => {
  const pool = playerPoolFromDataset(dataset.players);
  assert.equal(pool.length, dataset.players.length);
  assert.equal(pool.every((player) => player.key === `p${player.espnId}`), true);
  assert.equal(pool.every((player) => !('stats2026' in player) && !('keeper' in player)), true);
});

test('previews added, removed, team-changed, and position-changed players', () => {
  const fetched: EspnPlayerPoolPlayer[] = [
    {
      espnId: 1,
      fullName: 'Alpha Guard',
      proTeam: 'DDD',
      positions: ['SG', 'PG'],
    },
    {
      espnId: 4,
      fullName: 'Delta Rookie',
      proTeam: 'EEE',
      positions: ['SF'],
    },
  ];

  const preview = previewPlayerPoolRefresh(current, fetched, new Set());

  assert.deepEqual(preview.added.map((player) => player.key), ['p4']);
  assert.deepEqual(preview.removed.map((player) => player.key), ['p2', 'p3']);
  assert.deepEqual(preview.teamChanged.map((change) => change.key), ['p1']);
  assert.deepEqual(preview.positionChanged[0]?.before, ['PG']);
  assert.deepEqual(preview.positionChanged[0]?.after, ['PG', 'SG']);
  assert.deepEqual(preview.nextPlayers.map((player) => player.key), ['p1', 'p4']);
});

test('retains a protected player when ESPN omits him', () => {
  const preview = previewPlayerPoolRefresh(current, [], new Set(['p2']));

  assert.deepEqual(preview.retainedMissing.map((player) => player.key), ['p2']);
  assert.equal(preview.retainedMissing[0]?.sourceStatus, 'retained-missing');
  assert.deepEqual(preview.removed.map((player) => player.key), ['p1', 'p3']);
  assert.deepEqual(preview.nextPlayers.map((player) => player.key), ['p2']);
});

test('preserves an existing stable key when matching by ESPN ID', () => {
  const legacy = [{ ...current[0], key: 'legacy-alpha' }];
  const preview = previewPlayerPoolRefresh(
    legacy,
    [{ espnId: 1, fullName: 'Alpha Guard', proTeam: 'AAA', positions: ['PG'] }],
    new Set(),
  );

  assert.equal(preview.nextPlayers[0]?.key, 'legacy-alpha');
});

test('rejects duplicate ESPN IDs before producing a preview', () => {
  assert.throws(
    () =>
      previewPlayerPoolRefresh(
        current,
        [
          { espnId: 8, fullName: 'One', proTeam: 'AAA', positions: ['PG'] },
          { espnId: 8, fullName: 'Two', proTeam: 'BBB', positions: ['SG'] },
        ],
        new Set(),
      ),
    /Duplicate ESPN player ID 8/,
  );
});


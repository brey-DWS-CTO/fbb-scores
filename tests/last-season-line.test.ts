import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDraftRankingPlayer, seasonStatId } from '../src/lib/league/draftRankings.ts';

const base = {
  espnId: 3112335,
  fullName: 'Nikola Jokic',
  proTeam: 'DEN',
  adp: 1.6,
  percentOwned: 99,
  standard: null,
  roto: null,
  projection: null,
};

test('last season is ESPN stat row 00{season}', () => {
  assert.equal(seasonStatId(2026), '002026');
});

test('a player without last season keeps the old stored shape', () => {
  assert.equal('lastSeason' in normalizeDraftRankingPlayer({ ...base, lastSeason: null }), false);
  assert.equal('lastSeason' in normalizeDraftRankingPlayer(base), false);
});

test('last season is stored when ESPN sends it', () => {
  const player = normalizeDraftRankingPlayer({
    ...base,
    lastSeason: { id: '002026', stats: { '0': 2200 }, averageStats: { '0': 29.6, '6': 12.7 } },
  });
  assert.deepEqual(player.lastSeason, { id: '002026', stats: { '0': 2200 }, averageStats: { '0': 29.6, '6': 12.7 } });
});

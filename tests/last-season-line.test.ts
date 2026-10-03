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

test('a blank in last season is skipped, not a failed update', async () => {
  const { parseDraftRankingCandidate } = await import('../server/lib/draftRankingService.ts');
  const { default: rawDataset } = await import('../src/data/league-2027.json', { with: { type: 'json' } });
  const players = (rawDataset as { season: number; players: Array<{ espnId: number | null; fullName: string | null; name: string; proTeam: string }> }).players
    .filter((player) => player.espnId !== null)
    .map((player, index) => ({
      espnId: player.espnId,
      fullName: player.fullName ?? player.name,
      proTeam: player.proTeam,
      adp: null,
      percentOwned: null,
      standard: { rank: index + 1, auctionValue: null },
      roto: null,
      projection: null,
      lastSeason: index === 0 ? { id: '002026', stats: { '0': 2000, '36': null }, averageStats: { '0': 27, '19': null } } : null,
    }));
  const parsed = parseDraftRankingCandidate({
    sourceSeason: (rawDataset as { season: number }).season,
    fetchedAt: '2026-10-03T06:00:00.000Z',
    scoringItems: [],
    players,
  });
  assert.deepEqual(parsed.players[0].lastSeason, { id: '002026', stats: { '0': 2000 }, averageStats: { '0': 27 } });
});

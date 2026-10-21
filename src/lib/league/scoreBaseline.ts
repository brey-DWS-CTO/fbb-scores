import { leagueDataset } from './data.js';
import { lastSeasonFppg } from './draftRankings.js';

/** Public baseline for opening night and signed-out viewers without a projection snapshot. */
export const historicalScoreBaselines = new Map<number, number>(leagueDataset.players.flatMap(player => {
  const average = lastSeasonFppg(player);
  return player.espnId !== null && average !== null ? [[player.espnId, average] as const] : [];
}));

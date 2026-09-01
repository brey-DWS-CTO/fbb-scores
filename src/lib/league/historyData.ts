import rawHistory from '../../data/source/league-history-2027.json';
import type { LeagueHistory } from './history.js';

/**
 * The committed league-history seed.
 *
 * Same job as `rulebookData.ts`: this is the fallback the app starts from, so a
 * page never flashes empty and a dead API still shows the record book. Reviewed
 * versions live in Neon once the commissioner publishes them.
 */
export const leagueHistorySeed = rawHistory as unknown as LeagueHistory;

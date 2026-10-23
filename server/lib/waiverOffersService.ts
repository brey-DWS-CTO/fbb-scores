import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import { normalizeWaiverOffers, type WaiverOffersReport } from '../../src/lib/league/transactions.js';
import { espnClient, playerLookup, PULL_TTL_MS } from './transactionService.js';

const cache = new Map<string, { at: number; value: Promise<WaiverOffersReport> }>();
export function waiverOffersReport(period?: number): Promise<WaiverOffersReport> {
  const key = period === undefined ? 'current' : String(period);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PULL_TTL_MS) return hit.value;
  const value = (async () => {
    const client = espnClient();
    if (!client) throw new Error('ESPN credentials are not configured');
    const scoringPeriodId = period ?? await client.getCurrentScoringPeriod();
    if (!Number.isInteger(scoringPeriodId) || scoringPeriodId < 1) throw new Error('ESPN did not return a valid scoring period');
    const raw = await client.fetchWaiverOffers(scoringPeriodId);
    // Redact before name lookups too: unprocessed offers must never escape this service.
    const dataset = rawDataset as unknown as LeagueDataset;
    const teams = dataset.teams;
    const processed = normalizeWaiverOffers(raw, {season: dataset.season, teams, players: new Map()});
    const ids = processed.map(row => Number(row.id.split(':').at(-1)));
    const players = await playerLookup(client, ids);
    const rows = normalizeWaiverOffers(raw, {season: dataset.season, teams, players});
    return {scoringPeriodId, rows, fetchedAt: new Date().toISOString()};
  })();
  if (cache.size >= 10) cache.delete(cache.keys().next().value!);
  cache.set(key, {at: Date.now(), value});
  void value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

/**
 * The moves feed: pull this season's adds, drops, claims and trades from
 * ESPN and keep every row the store has not seen.
 *
 * A pull runs when somebody opens the feed and the last pull is older than
 * five minutes, and once an hour from the clock in server/routes/notify.ts,
 * so the table fills even when nobody is looking. Rows are only ever added.
 * A failed pull leaves the feed as it was and says so in the response.
 */
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  normalizeTransactions,
  type LeagueTransaction,
  type PlayerLookup,
} from '../../src/lib/league/transactions.js';
import { addTransactions, appendAudit, getState, listTransactions, type LeagueTransactionRow } from './leagueStore.js';
import { resolveCurrentPlayerPool } from './playerPoolService.js';

const dataset = rawDataset as unknown as LeagueDataset;

/** How long a pull stays fresh. */
export const PULL_TTL_MS = 5 * 60 * 1000;

/** How many rows the feed answers with. A season has a few hundred moves. */
const FEED_LIMIT = 1000;

let lastPullAt = 0;
let lastPullError: string | null = null;
let inFlight: Promise<PullResult> | null = null;

export interface PullResult {
  pulledAt: string;
  /** Rows the store had not seen. */
  added: number;
  error: string | null;
}

export interface TransactionsFeed {
  season: number;
  rows: LeagueTransactionRow[];
  /** When ESPN was last asked, ISO, or null before the first pull this process. */
  pulledAt: string | null;
  /** Why the last pull failed, or null. The rows are still the last good ones. */
  pullError: string | null;
}

export function espnClient(): EspnClient | null {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID) return null;
  if (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID)) return null;
  const seasonId = ESPN_SEASON_ID ? Number.parseInt(ESPN_SEASON_ID, 10) : dataset.season;
  return new EspnClient({
    leagueId: ESPN_LEAGUE_ID,
    seasonId,
    espnS2: ESPN_S2,
    swid: ESPN_SWID,
    cookieOverride: ESPN_COOKIE_STRING ?? `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`,
  });
}

/** Names from the active pool snapshot, then ESPN for anyone it does not know. */
export async function playerLookup(client: EspnClient, ids: readonly number[]): Promise<Map<number, PlayerLookup>> {
  const { state } = await getState();
  const pool = await resolveCurrentPlayerPool(state);
  const known = new Map<number, PlayerLookup>();
  for (const player of pool.players) known.set(player.espnId, { name: player.fullName, proTeam: player.proTeam });
  const missing = [...new Set(ids)].filter((id) => !known.has(id));
  if (missing.length > 0) {
    try {
      for (const [id, found] of await client.fetchPlayerNames(missing)) known.set(id, found);
    } catch (err) {
      // The feed still works with "Player 12345"; the next pull tries again.
      console.warn('[transactions] player names:', err instanceof Error ? err.message : err);
    }
  }
  return known;
}

/** Ask ESPN now and keep what is new. */
export async function pullTransactions(): Promise<PullResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const pulledAt = new Date().toISOString();
    try {
      const client = espnClient();
      if (!client) throw new Error('ESPN credentials are not configured');
      const raw = await client.fetchTransactions();
      const ids = (raw.transactions ?? []).flatMap((tx) => (tx.items ?? []).map((item) => item.playerId ?? 0));
      const players = await playerLookup(client, ids);
      const rows: LeagueTransaction[] = normalizeTransactions(raw, { season: dataset.season, teams: dataset.teams, players });
      const added = await addTransactions(rows.map((row) => ({ ...row, seenAt: pulledAt })));
      lastPullAt = Date.now();
      lastPullError = null;
      if (added > 0) await appendAudit(null, 'transactions.pulled', { added, total: rows.length });
      return { pulledAt, added, error: null };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      lastPullAt = Date.now();
      lastPullError = error;
      console.error('[transactions] pull failed:', error);
      return { pulledAt, added: 0, error };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Pull only when the last one has gone stale. */
export async function pullTransactionsIfStale(now = Date.now()): Promise<PullResult | null> {
  if (now - lastPullAt < PULL_TTL_MS) return null;
  return pullTransactions();
}

/** What the feed page shows: the stored rows after a pull if one was due. */
export async function transactionsFeed(): Promise<TransactionsFeed> {
  await pullTransactionsIfStale();
  const rows = await listTransactions(dataset.season, FEED_LIMIT);
  return {
    season: dataset.season,
    rows,
    pulledAt: lastPullAt > 0 ? new Date(lastPullAt).toISOString() : null,
    pullError: lastPullError,
  };
}

/**
 * Draft rankings: the snapshot ESPN's draft numbers are frozen into, and the
 * order a draft board shows players in.
 *
 * The snapshot follows the player pool exactly: fetch a candidate, show the
 * commissioner every change, write only when they accept, store immutable.
 * It is keyed on `espnId` and holds, per player, ESPN's average draft
 * position, the STANDARD and ROTO draft ranks with auction values, percent
 * owned, and the full-season projection stat dict once ESPN publishes one.
 *
 * The ordering is the part that must not be got wrong. Never alphabetical.
 * Players are ordered by the best source that has a number for them:
 *
 *   1. projected FPPG in this league's scoring, once ESPN publishes it
 *   2. ESPN's draft rank, falling back to ADP, live today
 *   3. last season's FPPG in this league's scoring, from the committed dataset
 *
 * Every entry says which source ranked it, so a screen can label the list and
 * a commissioner is never left guessing whether he is reading a forecast or
 * last year. A player with no number anywhere sorts last and is marked.
 *
 * Scoring is never hardcoded. The snapshot carries the league's
 * `scoringItems` as ESPN reported them when it was fetched, and
 * `computeFpts` multiplies.
 */
import type { DatasetPlayer } from '../keeper/types.js';
import { computeFpts, round1 } from '../espn/calculations.js';

export interface ScoringItem {
  statId: number;
  points: number;
  pointsOverrides?: Record<string, number>;
}

/** One of ESPN's draft rank types, with the auction value that goes with it. */
export interface DraftRankEntry {
  rank: number;
  auctionValue: number | null;
}

/**
 * ESPN's full-season projection for one player.
 *
 * `stats` holds season totals under ESPN's stat ids (`0` PTS, `42` GP and so
 * on), which is the same dictionary the app already reads for actuals.
 * `averageStats` is the per-game view when ESPN sends one.
 */
export interface ProjectionRow {
  /** ESPN's stat entry id. `10{season}` is the full-season projection. */
  id: string;
  stats: Record<string, number>;
  averageStats: Record<string, number> | null;
}

/** One player as ESPN's `kona_player_info` reports him, trimmed to the ranking fields. */
export interface EspnDraftRankingPlayer {
  espnId: number;
  fullName: string;
  proTeam: string;
  /** Average draft position across ESPN drafts. Null when nobody has drafted him. */
  adp: number | null;
  percentOwned: number | null;
  standard: DraftRankEntry | null;
  roto: DraftRankEntry | null;
  projection: ProjectionRow | null;
}

/** The stored form. Same fields; normalized. */
export type DraftRankingPlayer = EspnDraftRankingPlayer;

/**
 * Where a snapshot's numbers came from. `espn-kona` is the live fetch;
 * `manual` is a set loaded by hand, ESPN's website numbers or somebody
 * else's, posted through the same preview and accept routes; `none` is the
 * empty fallback before anything is accepted.
 */
export type DraftRankingSource = 'espn-kona' | 'manual' | 'none';

export interface DraftRankingSnapshot {
  id: string;
  season: number;
  sourceSeason: number;
  source: DraftRankingSource;
  /** Where a hand-loaded set was taken from, when the loader said. */
  sourceUrl: string | null;
  fetchedAt: string;
  createdAt: string;
  createdBy: string;
  baseSnapshotId: string | null;
  fingerprint: string;
  /** The stat entry id a projection has to carry to count. `10{season}`. */
  projectionStatId: string;
  /** The league's scoring as ESPN reported it when this was fetched. */
  scoringItems: ScoringItem[];
  players: DraftRankingPlayer[];
}

/** ESPN's id for the full-season projection row of a season. */
export function projectionStatId(season: number): string {
  return `10${season}`;
}

// ─── Normalizing what ESPN sent ─────────────────────────────────────────────

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** ESPN reports an ADP of 0 for a player nobody has drafted. That is no ADP. */
function normalizeAdp(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function normalizeRankEntry(entry: DraftRankEntry | null): DraftRankEntry | null {
  if (!entry) return null;
  const rank = finiteOrNull(entry.rank);
  if (rank === null || rank <= 0) return null;
  return { rank, auctionValue: finiteOrNull(entry.auctionValue) };
}

function normalizeStatDict(value: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value) return out;
  for (const key of Object.keys(value).sort()) {
    const number = finiteOrNull(value[key]);
    if (number !== null) out[key] = number;
  }
  return out;
}

function normalizeProjection(row: ProjectionRow | null): ProjectionRow | null {
  if (!row) return null;
  const stats = normalizeStatDict(row.stats);
  const averages = row.averageStats ? normalizeStatDict(row.averageStats) : null;
  const hasAverages = averages !== null && Object.keys(averages).length > 0;
  if (Object.keys(stats).length === 0 && !hasAverages) return null;
  return { id: String(row.id), stats, averageStats: hasAverages ? averages : null };
}

function normalizeText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} cannot be empty`);
  return normalized;
}

/** One player in the exact shape that gets stored. */
export function normalizeDraftRankingPlayer(player: EspnDraftRankingPlayer): DraftRankingPlayer {
  if (!Number.isInteger(player.espnId) || player.espnId <= 0) {
    throw new Error(`Invalid ESPN player ID: ${player.espnId}`);
  }
  return {
    espnId: player.espnId,
    fullName: normalizeText(player.fullName, 'fullName'),
    proTeam: normalizeText(player.proTeam, 'proTeam'),
    adp: normalizeAdp(finiteOrNull(player.adp)),
    percentOwned: finiteOrNull(player.percentOwned),
    standard: normalizeRankEntry(player.standard),
    roto: normalizeRankEntry(player.roto),
    projection: normalizeProjection(player.projection),
  };
}

function uniqueByEspnId<T extends { espnId: number }>(players: readonly T[], label: string): Map<number, T> {
  const result = new Map<number, T>();
  for (const player of players) {
    if (result.has(player.espnId)) {
      throw new Error(`Duplicate ESPN player ID ${player.espnId} in ${label}`);
    }
    result.set(player.espnId, player);
  }
  return result;
}

/**
 * Stored order: ESPN rank, then ADP, then id. Deterministic, so the
 * fingerprint of the same data is always the same string.
 */
function byEspnOrder(players: DraftRankingPlayer[]): DraftRankingPlayer[] {
  return [...players].sort(
    (a, b) =>
      (a.standard?.rank ?? Number.MAX_SAFE_INTEGER) - (b.standard?.rank ?? Number.MAX_SAFE_INTEGER)
      || (a.adp ?? Number.MAX_SAFE_INTEGER) - (b.adp ?? Number.MAX_SAFE_INTEGER)
      || a.espnId - b.espnId,
  );
}

// ─── Projected points ───────────────────────────────────────────────────────

/**
 * Projected fantasy points per game in this league's scoring, or null when
 * there is nothing to compute it from.
 *
 * Per-game averages are used when ESPN sends them. Otherwise the season
 * totals go through the scoring and are divided by projected games (`42`).
 * With no scoring items there is no answer, not a zero: every player would
 * tie at 0 and the board would quietly become meaningless.
 */
export function projectedFppg(
  projection: ProjectionRow | null,
  scoringItems: readonly ScoringItem[],
): number | null {
  if (!projection || scoringItems.length === 0) return null;
  const items = [...scoringItems];
  if (projection.averageStats) {
    return computeFpts(projection.averageStats, items);
  }
  const games = projection.stats['42'] ?? 0;
  if (games <= 0) return null;
  return round1(computeFpts(projection.stats, items) / games);
}

/** Last season's FPPG in this league's scoring, from the committed dataset. */
export function lastSeasonFppg(player: DatasetPlayer): number | null {
  if (player.stats2026 && player.stats2026.gp > 0) return player.stats2026.avg;
  if (player.api2026 && player.api2026.gp > 0) return player.api2026.avg;
  return null;
}

// ─── The refresh preview ────────────────────────────────────────────────────

export interface RankMove {
  espnId: number;
  fullName: string;
  before: number;
  after: number;
  /** Positive means he rose (a smaller rank number). */
  delta: number;
}

export interface DraftRankingCounts {
  players: number;
  ranked: number;
  withAdp: number;
  projected: number;
}

export interface DraftRankingRefreshPreview {
  nextPlayers: DraftRankingPlayer[];
  nextScoringItems: ScoringItem[];
  counts: DraftRankingCounts;
  previousCounts: DraftRankingCounts;
  /** Players ESPN now reports that the current snapshot does not carry. */
  added: DraftRankingPlayer[];
  /** Players in the current snapshot ESPN no longer reports. */
  removed: DraftRankingPlayer[];
  /** STANDARD rank changes, biggest first. */
  moved: RankMove[];
  /** True the first time a projection turns up for anyone. */
  projectionArrived: boolean;
  /** True when the league's scoring items differ from the current snapshot's. */
  scoringChanged: boolean;
}

export function countRankings(players: readonly DraftRankingPlayer[]): DraftRankingCounts {
  return {
    players: players.length,
    ranked: players.filter((player) => player.standard !== null).length,
    withAdp: players.filter((player) => player.adp !== null).length,
    projected: players.filter((player) => player.projection !== null).length,
  };
}

const sameScoring = (a: readonly ScoringItem[], b: readonly ScoringItem[]): boolean => {
  const key = (items: readonly ScoringItem[]) =>
    JSON.stringify([...items].sort((x, y) => x.statId - y.statId).map((item) => [item.statId, item.points]));
  return key(a) === key(b);
};

/**
 * Build the exact snapshot contents that would be accepted, and the diff the
 * commissioner reads first. Writes nothing.
 */
export function previewDraftRankingRefresh(
  current: Pick<DraftRankingSnapshot, 'players' | 'scoringItems'>,
  fetchedPlayers: readonly EspnDraftRankingPlayer[],
  fetchedScoringItems: readonly ScoringItem[],
): DraftRankingRefreshPreview {
  const currentById = uniqueByEspnId(current.players, 'current rankings');
  const fetched = fetchedPlayers.map(normalizeDraftRankingPlayer);
  const fetchedById = uniqueByEspnId(fetched, 'ESPN response');

  const added: DraftRankingPlayer[] = [];
  const moved: RankMove[] = [];
  for (const incoming of fetched) {
    const before = currentById.get(incoming.espnId);
    if (!before) {
      added.push(incoming);
      continue;
    }
    if (before.standard && incoming.standard && before.standard.rank !== incoming.standard.rank) {
      moved.push({
        espnId: incoming.espnId,
        fullName: incoming.fullName,
        before: before.standard.rank,
        after: incoming.standard.rank,
        delta: before.standard.rank - incoming.standard.rank,
      });
    }
  }
  const removed = current.players.filter((player) => !fetchedById.has(player.espnId));
  moved.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.after - b.after);

  const nextPlayers = byEspnOrder(fetched);
  const counts = countRankings(nextPlayers);
  const previousCounts = countRankings(current.players);
  const nextScoringItems = [...fetchedScoringItems]
    .map((item) => ({ statId: item.statId, points: item.points }))
    .sort((a, b) => a.statId - b.statId);

  return {
    nextPlayers,
    nextScoringItems,
    counts,
    previousCounts,
    added: byEspnOrder(added),
    removed: byEspnOrder(removed),
    moved,
    projectionArrived: previousCounts.projected === 0 && counts.projected > 0,
    scoringChanged: !sameScoring(current.scoringItems, nextScoringItems),
  };
}

// ─── Ordering a board ───────────────────────────────────────────────────────

export type RankSource = 'projection' | 'espn-rank' | 'last-season' | 'none';

/** Best first. A user can move one to the front; the rest keep this order. */
export const RANK_SOURCE_ORDER: readonly RankSource[] = ['projection', 'espn-rank', 'last-season'];

/** How a source reads on screen. `season` is the draft season, 2027 for 2026-27. */
export function rankSourceLabel(source: RankSource, season: number): string {
  const span = (start: number) => `${start}-${String(start + 1).slice(2)}`;
  switch (source) {
    case 'projection':
      return `${span(season - 1)} projection`;
    case 'espn-rank':
      return 'ESPN draft rank';
    case 'last-season':
      return `${span(season - 2)} actual`;
    case 'none':
    default:
      return 'No data';
  }
}

export interface BoardRank {
  player: DatasetPlayer;
  /** Which source put him where he is. */
  source: RankSource;
  /**
   * The number he was ordered on: projected FPPG, ESPN rank (or ADP when ESPN
   * has no rank for him), or last season's FPPG. Null when nothing ranked him.
   */
  value: number | null;
  /** Set when `source` is `espn-rank`: which of the two numbers was used. */
  espnBasis: 'rank' | 'adp' | null;
  /** 1-based position in the returned list. */
  position: number;
  /** ESPN's numbers for display, whatever source ranked him. */
  espnRank: number | null;
  adp: number | null;
  auctionValue: number | null;
  percentOwned: number | null;
  projectedFppg: number | null;
  lastSeasonFppg: number | null;
}

export interface BoardRanking {
  /** The source order used, best first. */
  order: RankSource[];
  /** The first source in that order that ranked anyone. */
  primary: RankSource;
  entries: BoardRank[];
  /** How many players each source ranked. */
  counts: Record<RankSource, number>;
}

export interface RankBoardOptions {
  /** Put this source first. Missing players still fall through to the rest. */
  prefer?: RankSource;
}

const SOURCE_RANK: Record<RankSource, number> = {
  projection: 0,
  'espn-rank': 1,
  'last-season': 2,
  none: 3,
};

/** Name, then id. Only ever a tie-break, never a source. */
const byNameThenId = (a: DatasetPlayer, b: DatasetPlayer): number =>
  (a.fullName ?? a.name).localeCompare(b.fullName ?? b.name) || (a.espnId ?? 0) - (b.espnId ?? 0);

/**
 * Order players for a draft board.
 *
 * Each player takes the first source in `order` that has a number for him.
 * The list is then grouped by source in that same order, sorted inside each
 * group the way that source reads (points high to low, ranks low to high),
 * and players nothing ranked come last, marked `none`.
 */
export function rankBoard(
  players: readonly DatasetPlayer[],
  snapshot: Pick<DraftRankingSnapshot, 'players' | 'scoringItems'> | null,
  options: RankBoardOptions = {},
): BoardRanking {
  const order: RankSource[] = options.prefer && options.prefer !== 'none'
    ? [options.prefer, ...RANK_SOURCE_ORDER.filter((source) => source !== options.prefer)]
    : [...RANK_SOURCE_ORDER];
  const orderIndex = new Map(order.map((source, index) => [source, index]));
  const byEspnId = new Map<number, DraftRankingPlayer>();
  for (const entry of snapshot?.players ?? []) byEspnId.set(entry.espnId, entry);
  const scoringItems = snapshot?.scoringItems ?? [];

  const unsorted = players.map((player) => {
    const espn = player.espnId !== null ? byEspnId.get(player.espnId) ?? null : null;
    const projected = espn ? projectedFppg(espn.projection, scoringItems) : null;
    const espnRank = espn?.standard?.rank ?? null;
    const adp = espn?.adp ?? null;
    const last = lastSeasonFppg(player);

    const candidates: Partial<Record<RankSource, { value: number; basis: BoardRank['espnBasis'] }>> = {};
    if (projected !== null) candidates.projection = { value: projected, basis: null };
    if (espnRank !== null) candidates['espn-rank'] = { value: espnRank, basis: 'rank' };
    else if (adp !== null) candidates['espn-rank'] = { value: adp, basis: 'adp' };
    if (last !== null) candidates['last-season'] = { value: last, basis: null };

    const source = order.find((candidate) => candidates[candidate] !== undefined) ?? 'none';
    const chosen = source === 'none' ? null : candidates[source] ?? null;

    return {
      player,
      source,
      value: chosen?.value ?? null,
      espnBasis: chosen?.basis ?? null,
      position: 0,
      espnRank,
      adp,
      auctionValue: espn?.standard?.auctionValue ?? null,
      percentOwned: espn?.percentOwned ?? null,
      projectedFppg: projected,
      lastSeasonFppg: last,
    } satisfies BoardRank;
  });

  const groupOf = (source: RankSource): number =>
    source === 'none' ? order.length : orderIndex.get(source) ?? SOURCE_RANK[source];

  unsorted.sort((a, b) => {
    const group = groupOf(a.source) - groupOf(b.source);
    if (group !== 0) return group;
    if (a.source === 'none' || a.value === null || b.value === null) {
      return byNameThenId(a.player, b.player);
    }
    // Ranks read low to high; points read high to low.
    const gap = a.source === 'espn-rank' ? a.value - b.value : b.value - a.value;
    if (gap !== 0) return gap;
    if (a.source === 'espn-rank') {
      const adpGap = (a.adp ?? Number.MAX_SAFE_INTEGER) - (b.adp ?? Number.MAX_SAFE_INTEGER);
      if (adpGap !== 0) return adpGap;
    }
    return byNameThenId(a.player, b.player);
  });

  const counts: Record<RankSource, number> = { projection: 0, 'espn-rank': 0, 'last-season': 0, none: 0 };
  const entries = unsorted.map((entry, index) => {
    counts[entry.source] += 1;
    return { ...entry, position: index + 1 };
  });
  const primary = order.find((source) => counts[source] > 0) ?? 'none';

  return { order, primary, entries, counts };
}

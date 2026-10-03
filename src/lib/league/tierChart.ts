/**
 * The tier chart: every projected player in one row, ranked by the points he
 * should score this season, with his points per game drawn beside it and a
 * bar for how sure we are of each.
 *
 * The look follows Boris Chen's tier charts for football: a dot, a bar either
 * side of it, and colour bands the numbers draw for themselves. His bar is how
 * far apart the experts sit. Ours is how far apart the numbers we hold sit:
 * ESPN's projection, ESPN's own number before the commish edited it, last
 * season, and the season before. More sources slot into `estimates` without
 * touching the chart.
 *
 * Tiers come from the natural gaps in season totals: the split into k groups
 * that keeps each group as tight as it can be (one-dimensional k-means, solved
 * exactly). Boris fits a Gaussian mixture to the same end. On one line of
 * numbers both find the same gaps, and this one gives the same answer every
 * time.
 *
 * Pure. No server, no browser.
 */
import type { DatasetPlayer } from '../keeper/types.js';
import type { Position } from './draftValue.js';
import type { KeeperTag, PlayerProjection } from './projections.js';

/** One number for a player's points per game, and where it came from. */
export interface FppgEstimate {
  label: string;
  fppg: number;
}

export interface TierRow {
  key: string;
  name: string;
  /** "G. Antetokounmpo": what fits beside a bar on a phone. */
  shortName: string;
  proTeam: string;
  positions: Position[];
  tag: KeeperTag;
  keptBy: string | null;
  /** Place in this chart, by season total. */
  rank: number;
  /** 1 is the best tier. */
  tier: number;
  /** The dot: projected points per game. */
  fppg: number;
  /** The bar: lowest and highest of `estimates`. Equal when there is only one. */
  fppgLow: number;
  fppgHigh: number;
  estimates: FppgEstimate[];
  /** Projected games and the season total they make. */
  games: number;
  total: number;
  /** Games he played last season, if he played. */
  lastGames: number | null;
  /** The season total at his projected FPPG over the fewer and the more of the two game counts. */
  totalLow: number;
  totalHigh: number;
  adp: number | null;
}

export interface TierChartOptions {
  position?: Position | 'ALL';
  hideKept?: boolean;
}

// ─── Natural breaks ─────────────────────────────────────────────────────────

/**
 * Split numbers into at most `k` groups of neighbours, as tight as possible:
 * the least total squared distance from each number to its group's mean.
 * Exact, by dynamic programming over the sorted values.
 *
 * Returns a group per input value, in input order. Group 0 holds the highest
 * values. Equal values always share a group.
 */
export function naturalBreaks(values: readonly number[], k: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  const sorted = order.map((entry) => entry.value);
  const distinct = new Set(sorted).size;
  const groups = Math.max(1, Math.min(Math.floor(k), distinct));

  // Prefix sums turn any run's squared error into two subtractions.
  const sum = [0];
  const sumSq = [0];
  for (const value of sorted) {
    sum.push(sum[sum.length - 1] + value);
    sumSq.push(sumSq[sumSq.length - 1] + value * value);
  }
  const cost = (from: number, to: number) => {
    const count = to - from + 1;
    const total = sum[to + 1] - sum[from];
    return sumSq[to + 1] - sumSq[from] - (total * total) / count;
  };

  // best[g][i]: least error putting sorted[0..i] into g + 1 groups.
  // start[g][i]: where the last of those groups begins.
  const best: number[][] = [];
  const start: number[][] = [];
  best.push(sorted.map((_, i) => cost(0, i)));
  start.push(sorted.map(() => 0));
  for (let g = 1; g < groups; g += 1) {
    const row: number[] = new Array(n).fill(Infinity);
    const from: number[] = new Array(n).fill(g);
    for (let i = g; i < n; i += 1) {
      for (let j = g; j <= i; j += 1) {
        // A group may not begin inside a run of equal values.
        if (sorted[j] === sorted[j - 1]) continue;
        const candidate = best[g - 1][j - 1] + cost(j, i);
        if (candidate < row[i]) {
          row[i] = candidate;
          from[i] = j;
        }
      }
    }
    best.push(row);
    start.push(from);
  }

  // Walk back from the end to find where each group starts.
  const bySorted: number[] = new Array(n).fill(0);
  let end = n - 1;
  for (let g = groups - 1; g >= 0; g -= 1) {
    const begin = g === 0 ? 0 : start[g][end];
    for (let i = begin; i <= end; i += 1) bySorted[i] = g;
    end = begin - 1;
    if (end < 0) break;
  }

  const out: number[] = new Array(n).fill(0);
  order.forEach((entry, i) => {
    out[entry.index] = bySorted[i];
  });
  return out;
}

/**
 * How many tiers a pool gets. Boris draws 26 tiers across 200 players, about
 * one for every eight; small pools still get at least two.
 */
export function tierCountFor(players: number): number {
  if (players <= 1) return 1;
  return Math.max(2, Math.min(30, Math.round(players / 8)));
}

// ─── Rows ───────────────────────────────────────────────────────────────────

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Games he played last season: ESPN's full count first, since the league's ends early. */
function lastSeasonGames(player: DatasetPlayer | undefined): number | null {
  const games = player?.api2026?.gp ?? player?.stats2026?.gp ?? null;
  return games !== null && games > 0 ? games : null;
}

/** Every number we hold for his points per game. The projection comes first. */
export function estimatesFor(row: PlayerProjection, player: DatasetPlayer | undefined): FppgEstimate[] {
  if (row.fppg === null) return [];
  const out: FppgEstimate[] = [
    { label: row.edit ? 'Commish projection' : 'ESPN projection', fppg: row.fppg },
  ];
  if (row.edit && row.espn?.fppg != null) out.push({ label: 'ESPN projection', fppg: row.espn.fppg });
  if (row.lastSeason !== null) out.push({ label: 'Last season', fppg: row.lastSeason });
  if (player?.prior) out.push({ label: 'Season before', fppg: player.prior.avg });
  return out;
}

/**
 * The chart's rows: projected players with a season total, filtered, ranked
 * by total, and cut into tiers. Tiers are drawn over the whole filtered pool,
 * so paging through the chart never moves a player to another tier.
 */
export function buildTierRows(
  projections: readonly PlayerProjection[],
  players: readonly DatasetPlayer[],
  options: TierChartOptions = {},
): TierRow[] {
  const byKey = new Map(players.map((player) => [player.key, player]));
  const position = options.position ?? 'ALL';

  const pool = projections.filter((row) =>
    row.fppg !== null
    && row.total !== null
    && row.games !== null
    && (position === 'ALL' || row.positions.includes(position))
    && !(options.hideKept && row.tag !== 'open'));

  const ranked = [...pool].sort((a, b) =>
    b.total! - a.total! || b.fppg! - a.fppg! || a.name.localeCompare(b.name));
  const groups = naturalBreaks(ranked.map((row) => row.total!), tierCountFor(ranked.length));

  return ranked.map((row, index) => {
    const player = byKey.get(row.key);
    const estimates = estimatesFor(row, player);
    const values = estimates.map((estimate) => estimate.fppg);
    const fppg = row.fppg!;
    const games = row.games!;
    const lastGames = lastSeasonGames(player);
    const fewer = lastGames === null ? games : Math.min(games, lastGames);
    const more = lastGames === null ? games : Math.max(games, lastGames);
    return {
      key: row.key,
      name: row.name,
      shortName: player?.name ?? row.name,
      proTeam: row.proTeam,
      positions: row.positions,
      tag: row.tag,
      keptBy: row.keptBy,
      rank: index + 1,
      tier: groups[index] + 1,
      fppg,
      fppgLow: round1(Math.min(...values)),
      fppgHigh: round1(Math.max(...values)),
      estimates,
      games,
      total: row.total!,
      lastGames,
      totalLow: Math.round(fppg * fewer),
      totalHigh: Math.round(fppg * more),
      adp: row.adp,
    };
  });
}

/** The chart shows this many players at a time, like Boris's top-200 pages. */
export const TIER_PAGE_SIZE = 50;

/** Page labels: "1–50", "51–100" and so on. */
export function tierPages(count: number, size = TIER_PAGE_SIZE): string[] {
  const pages: string[] = [];
  for (let from = 1; from <= count; from += size) pages.push(`${from}–${Math.min(count, from + size - 1)}`);
  return pages;
}

// ─── Scales ─────────────────────────────────────────────────────────────────

/**
 * A range padded a little either side, and round tick marks inside it: steps
 * of 1, 2 or 5 times a power of ten, about `target` of them. The range hugs
 * the data rather than the ticks, so a narrow screen spends no width on empty
 * axis.
 */
export function niceTicks(low: number, high: number, target = 5): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { min: 0, max: 1, ticks: [0, 1] };
  if (high <= low) {
    const pad = Math.max(1, Math.abs(low) * 0.05);
    low -= pad;
    high += pad;
  }
  const pad = (high - low) * 0.03;
  const min = low - pad;
  const max = high + pad;
  const ticksAt = (step: number) => {
    const out: number[] = [];
    for (let tick = Math.ceil(min / step) * step; tick <= max; tick += step) out.push(Math.round(tick * 1000) / 1000);
    return out;
  };
  // Of the round steps near the rough one, the one whose count lands nearest
  // the target, never fewer than two ticks when any step gives two.
  const power = 10 ** Math.floor(Math.log10((max - min) / Math.max(1, target)));
  const options = [0.5, 1, 2, 5, 10].map((m) => ticksAt(m * power));
  const usable = options.filter((ticks) => ticks.length >= 2);
  const pool = usable.length > 0 ? usable : options;
  const ticks = pool.reduce((best, ticks) =>
    Math.abs(ticks.length - target) < Math.abs(best.length - target) ? ticks : best);
  return { min, max, ticks };
}

/**
 * Where a name goes: left of the bar, as Boris sets it, unless it would run
 * off the left edge of the plot. Then right of the bar.
 */
export function labelSide(barLeft: number, barRight: number, labelWidth: number, plotLeft: number, plotRight: number, gap = 6): 'left' | 'right' {
  if (barLeft - gap - labelWidth >= plotLeft) return 'left';
  if (barRight + gap + labelWidth <= plotRight) return 'right';
  // Neither fits cleanly: take the side with more room.
  return barLeft - plotLeft >= plotRight - barRight ? 'left' : 'right';
}

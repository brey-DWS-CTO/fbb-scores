/**
 * Draft value: what a player is worth to a team in this league.
 *
 * A ranking says who is better. A value says by how much, in the points this
 * league counts, over the player a team could have had instead. That is the
 * number a draft decision needs, and it is built here from three inputs the
 * app already holds:
 *
 *   1. points per game in this league's scoring, from the best source there
 *      is for each player: a 2026-27 projection scored through the league's
 *      own `scoringItems`, else ESPN's draft rank turned into points, else
 *      last season's league-official average. The source is named on every
 *      entry with the same labels `rankBoard` uses, so a screen can say
 *      whether a number is a forecast or history.
 *   2. the replacement level at each position, from the roster the league
 *      starts: 1 C, 1 PF, 1 SF, 1 SG, 1 PG, 1 F, 1 G, 3 FLEX across ten teams.
 *      A position the pool is short of gets a lower replacement level and its
 *      players a bigger margin.
 *   3. the 2026-27 weekly schedule and the league's game limit. A team that
 *      plays two games in a week gives its players two chances to score that
 *      week; a week where every team plays four games has more games than a
 *      roster may count. No other draft tool knows this league's schedule.
 *
 * Value and ADP stay two separate numbers. Value is what a player is worth
 * under our scoring: what a team should do. ADP is what the room actually
 * does. The simulation needs both and never mixes them here.
 *
 * Everything is pure. No server, no browser.
 */
import type { DatasetPlayer } from '../keeper/types.js';
import { round1 } from '../espn/calculations.js';
import {
  RANK_SOURCE_ORDER,
  lastSeasonFppg,
  projectedFppg,
  type DraftRankingPlayer,
  type DraftRankingSnapshot,
  type RankSource,
} from './draftRankings.js';
import { NBA_TEAMS, nbaTeamIdForProTeam, type LeagueSchedulePeriod, type SchedulePhase } from './schedule.js';

// ─── Positions and roster slots ─────────────────────────────────────────────

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type Position = (typeof POSITIONS)[number];

/** The slots a lineup starts, in the order the rule book lists them. */
export const STARTER_SLOTS = ['C', 'PF', 'SF', 'SG', 'PG', 'F', 'G', 'FLEX'] as const;
export type StarterSlot = (typeof STARTER_SLOTS)[number];

const SLOTS_BY_POSITION: Record<Position, readonly StarterSlot[]> = {
  PG: ['PG', 'G', 'FLEX'],
  SG: ['SG', 'G', 'FLEX'],
  SF: ['SF', 'F', 'FLEX'],
  PF: ['PF', 'F', 'FLEX'],
  C: ['C', 'FLEX'],
};

const POSITION_SET = new Set<string>(POSITIONS);

/** The positions a player may start at, in `POSITIONS` order. Unknown codes drop. */
export function positionsOf(player: Pick<DatasetPlayer, 'positions'>): Position[] {
  const found = new Set(
    player.positions
      .map((position) => position.trim().toUpperCase())
      .filter((position) => POSITION_SET.has(position)),
  );
  return POSITIONS.filter((position) => found.has(position));
}

/** Every starting slot a set of positions can fill, in `STARTER_SLOTS` order. */
export function slotsFor(positions: readonly Position[]): StarterSlot[] {
  const allowed = new Set<StarterSlot>();
  for (const position of positions) {
    for (const slot of SLOTS_BY_POSITION[position]) allowed.add(slot);
  }
  return STARTER_SLOTS.filter((slot) => allowed.has(slot));
}

export function fillsSlot(positions: readonly Position[], slot: StarterSlot): boolean {
  return positions.some((position) => SLOTS_BY_POSITION[position].includes(slot));
}

export interface RosterSettings {
  /** Starting slots per team. */
  starters: Record<StarterSlot, number>;
  bench: number;
  teamCount: number;
  /** Most games a team may count in one league week. */
  weeklyGameLimit: number;
}

/**
 * The 2026-27 roster as the rule book states it: clause
 * `rosters.size.starters.config` for the ten starting slots, `rosters.size.bench`
 * for the bench, and `season.gameLimit` for the 30 games a week. Every
 * function here takes the roster as an argument, so a vote that changes the
 * rule changes one object, not the arithmetic.
 */
export const DEFAULT_ROSTER: RosterSettings = {
  starters: { C: 1, PF: 1, SF: 1, SG: 1, PG: 1, F: 1, G: 1, FLEX: 3 },
  bench: 4,
  teamCount: 10,
  weeklyGameLimit: 30,
};

export function starterCount(roster: Pick<RosterSettings, 'starters'>): number {
  return STARTER_SLOTS.reduce((total, slot) => total + (roster.starters[slot] ?? 0), 0);
}

/** One entry per starting slot, so C, PF, SF, SG, PG, F, G, FLEX, FLEX, FLEX. */
export function starterSlotList(roster: Pick<RosterSettings, 'starters'>): StarterSlot[] {
  return STARTER_SLOTS.flatMap((slot) => Array.from({ length: roster.starters[slot] ?? 0 }, () => slot));
}

// ─── Turning an ESPN rank into points ───────────────────────────────────────

/**
 * A fitted curve from ESPN draft rank to points per game in this league's
 * scoring. Built from the players who have both a rank and a league number,
 * so the curve says "a player ESPN ranks here scored this much for us last
 * year", never a made-up scale.
 */
export interface RankBridge {
  /**
   * The centre rank of each fitted block, ascending. The curve is read by
   * straight lines between centres, so it keeps falling instead of holding
   * flat across a block and tying twenty players at one number.
   */
  ranks: number[];
  /** Fitted points at each centre. Never rises as the rank gets worse. */
  points: number[];
  /** How many players the fit was made from. */
  pairs: number;
}

/** Fewer pairs than this and the bridge is not trusted. */
export const MIN_BRIDGE_PAIRS = 10;

/**
 * Fit a non-increasing curve through rank/points pairs by pooling adjacent
 * violators, the standard isotonic fit, then place each pooled block at its
 * centre rank. Ties in rank are averaged first. Null when there is too little
 * to fit.
 */
export function fitRankToPoints(pairs: readonly { rank: number; points: number }[]): RankBridge | null {
  const usable = pairs.filter(
    (pair) => Number.isFinite(pair.rank) && pair.rank > 0 && Number.isFinite(pair.points),
  );
  if (usable.length < MIN_BRIDGE_PAIRS) return null;

  const byRank = new Map<number, { sum: number; count: number }>();
  for (const pair of usable) {
    const bucket = byRank.get(pair.rank) ?? { sum: 0, count: 0 };
    bucket.sum += pair.points;
    bucket.count += 1;
    byRank.set(pair.rank, bucket);
  }
  const uniqueRanks = [...byRank.keys()].sort((a, b) => a - b);

  interface Block { sum: number; count: number; from: number; to: number }
  const blocks: Block[] = [];
  uniqueRanks.forEach((rank, index) => {
    const bucket = byRank.get(rank)!;
    blocks.push({ sum: bucket.sum, count: bucket.count, from: index, to: index });
    // A worse rank may not fit more points than a better one. Merge until it does not.
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const previous = blocks[blocks.length - 2];
      if (previous.sum / previous.count >= last.sum / last.count) break;
      blocks.splice(blocks.length - 2, 2, {
        sum: previous.sum + last.sum,
        count: previous.count + last.count,
        from: previous.from,
        to: last.to,
      });
    }
  });

  const ranks: number[] = [];
  const points: number[] = [];
  for (const block of blocks) {
    let rankSum = 0;
    for (let index = block.from; index <= block.to; index += 1) {
      rankSum += uniqueRanks[index] * byRank.get(uniqueRanks[index])!.count;
    }
    ranks.push(rankSum / block.count);
    points.push(block.sum / block.count);
  }
  return { ranks, points, pairs: usable.length };
}

/** Points for a rank, read off the bridge. Ranks past either end take the end value. */
export function pointsForRank(bridge: RankBridge, rank: number): number {
  const { ranks, points } = bridge;
  if (rank <= ranks[0]) return points[0];
  if (rank >= ranks[ranks.length - 1]) return points[points.length - 1];
  let low = 0;
  let high = ranks.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (ranks[middle] <= rank) low = middle;
    else high = middle;
  }
  if (ranks[low] === rank) return points[low];
  const share = (rank - ranks[low]) / (ranks[high] - ranks[low]);
  return points[low] + (points[high] - points[low]) * share;
}

// ─── Replacement level by position ──────────────────────────────────────────

/**
 * The points per game of the best player left over at each position once
 * every team's starting slots are filled with the best players available.
 *
 * Slots are filled best player first, each into the most specific open slot
 * he can start at, so a centre takes C before FLEX and leaves FLEX for the
 * players who have nowhere else to go. A position the pool is short of runs
 * out of starters sooner, so its replacement level is lower and its players
 * carry a bigger margin. That is the whole point of doing this by position.
 */
export function replacementLevels(
  players: readonly { fppg: number; positions: readonly Position[] }[],
  roster: RosterSettings,
): Record<Position, number> {
  const open: Record<StarterSlot, number> = { ...roster.starters };
  for (const slot of STARTER_SLOTS) open[slot] = (open[slot] ?? 0) * roster.teamCount;

  const ordered = [...players].sort((a, b) => b.fppg - a.fppg);
  const leftOver: { fppg: number; positions: readonly Position[] }[] = [];
  for (const player of ordered) {
    const slot = slotsFor(player.positions).find((candidate) => open[candidate] > 0);
    if (slot) open[slot] -= 1;
    else leftOver.push(player);
  }

  const levels: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const position of POSITIONS) {
    const best = leftOver.find((player) => player.positions.includes(position));
    levels[position] = best ? best.fppg : 0;
  }
  return levels;
}

// ─── The weekly schedule ────────────────────────────────────────────────────

export type PhaseWeights = Record<SchedulePhase, number>;

/** Every week counts the same until the commissioner says otherwise. */
export const DEFAULT_PHASE_WEIGHTS: PhaseWeights = {
  regular: 1,
  'fantasy-play-in': 1,
  'fantasy-playoff': 1,
};

export interface ScheduleGames {
  /** Schedule-weighted games for the fantasy season, by ESPN NBA team id. */
  byTeamId: Record<number, number>;
  /** The same, averaged over the thirty teams. */
  leagueAverage: number;
}

/**
 * How many games each NBA team gives a fantasy roster over the season, with
 * every week weighted by what a roster can actually use.
 *
 * In a week where the average team plays more games than the limit lets ten
 * starters count, each game is worth the share that fits: 30 counted out of
 * 35 possible is 30/35 of a game. In a light week every game counts in full.
 * A period that spans two NBA weeks gets two weeks of limit. Play-in and
 * playoff weeks take the caller's weight, so a commissioner who cares more
 * about the playoffs can say so with a number.
 */
export function scheduleGames(
  periods: readonly LeagueSchedulePeriod[],
  roster: RosterSettings,
  phaseWeights: PhaseWeights = DEFAULT_PHASE_WEIGHTS,
): ScheduleGames {
  const byTeamId: Record<number, number> = {};
  for (const team of NBA_TEAMS) byTeamId[team.espnId] = 0;
  const starters = starterCount(roster);

  for (const period of periods) {
    const counts = NBA_TEAMS.map((team) => period.gamesByTeamId[team.espnId] ?? 0);
    const average = counts.reduce((total, games) => total + games, 0) / NBA_TEAMS.length;
    const weeks = Math.max(1, period.sourceNbaWeeks.length);
    const usable = roster.weeklyGameLimit * weeks;
    const share = starters > 0 && average > 0 ? Math.min(1, usable / (starters * average)) : 1;
    const weight = share * (phaseWeights[period.phase] ?? 1);
    NBA_TEAMS.forEach((team, index) => {
      byTeamId[team.espnId] += counts[index] * weight;
    });
  }

  const total = NBA_TEAMS.reduce((sum, team) => sum + byTeamId[team.espnId], 0);
  return { byTeamId, leagueAverage: total / NBA_TEAMS.length };
}

// ─── The value board ────────────────────────────────────────────────────────

/**
 * ESPN gives a player its mock rooms never draft an ADP of about 140, the
 * pick after a 13-round, 10-team room ends. That number means "undrafted",
 * not "the 140th pick", so an ADP at or past this floor is not a real one.
 */
export const UNDRAFTED_ADP = 139;

export interface PlayerValue {
  player: DatasetPlayer;
  positions: Position[];
  /** Points per game in this league's scoring, or null when nothing says. */
  fppg: number | null;
  /** Which source `fppg` came from. */
  source: RankSource;
  espnRank: number | null;
  /** ESPN's average draft position as reported, undrafted marker included. */
  adp: number | null;
  /**
   * What the room does with him: his ADP when one exists, else his ESPN rank
   * held at the undrafted floor, since a room drafts down ESPN's list once ADP
   * runs out. Null when ESPN has never heard of him.
   */
  roomRank: number | null;
  /** The position whose replacement level sets his margin. */
  replacementPosition: Position | null;
  replacement: number | null;
  /** Points per game over replacement. */
  perGame: number | null;
  /** Schedule-weighted games his team gives him this season. */
  weightedGames: number;
  /** His team's weighted games against the league average. 1 is average. */
  scheduleRatio: number;
  /** Share of the season he is projected to play. 1 until a projection says less. */
  availability: number;
  /**
   * Points over a replacement player for the whole season: his points over
   * his schedule, less the replacement's over an average schedule. Null when
   * nothing valued him.
   */
  seasonValue: number | null;
  /** 1-based place on the board, best first. */
  rank: number;
}

export interface ValueBoard {
  /** Source order used, best first. */
  order: RankSource[];
  /** The first source that valued anyone. */
  primary: RankSource;
  counts: Record<RankSource, number>;
  replacement: Record<Position, number>;
  leagueAverageGames: number;
  bridge: RankBridge | null;
  roster: RosterSettings;
  entries: PlayerValue[];
}

export interface ValueOptions {
  /** Put this source first. Players it misses still fall through to the rest. */
  prefer?: RankSource;
  /** The league's 22 periods. Without them every team is average. */
  schedule?: readonly LeagueSchedulePeriod[];
  roster?: RosterSettings;
  phaseWeights?: PhaseWeights;
  /** ESPN's undrafted marker, when a season changes it. */
  undraftedAdp?: number;
}

/** Fewest games last season for a player to help fit the rank bridge. */
const MIN_BRIDGE_GAMES = 25;

/** Name, then id. Only ever a tie-break. */
const byNameThenId = (a: DatasetPlayer, b: DatasetPlayer): number =>
  (a.fullName ?? a.name).localeCompare(b.fullName ?? b.name) || (a.espnId ?? 0) - (b.espnId ?? 0);

export function sourceOrder(prefer?: RankSource): RankSource[] {
  return prefer && prefer !== 'none'
    ? [prefer, ...RANK_SOURCE_ORDER.filter((source) => source !== prefer)]
    : [...RANK_SOURCE_ORDER];
}

/** ADP as the room means it, or null for the undrafted marker. */
export function realAdp(adp: number | null, undraftedAdp = UNDRAFTED_ADP): number | null {
  return adp !== null && adp > 0 && adp < undraftedAdp ? adp : null;
}

export function roomRankOf(
  espnRank: number | null,
  adp: number | null,
  undraftedAdp = UNDRAFTED_ADP,
): number | null {
  const real = realAdp(adp, undraftedAdp);
  if (real !== null) return real;
  return espnRank !== null ? Math.max(espnRank, undraftedAdp) : null;
}

/** Projected share of the season from a projection's games played, else all of it. */
function availabilityOf(espn: DraftRankingPlayer | null): number {
  const games = espn?.projection?.stats['42'];
  if (games === undefined || !Number.isFinite(games) || games <= 0) return 1;
  return Math.min(1, games / 82);
}

/**
 * Value every player for the draft.
 *
 * The snapshot may be null or empty, which is the state before the
 * commissioner accepts ESPN's numbers: everyone is then valued on last season
 * and the board says so. The schedule may be missing, in which case every
 * team plays an average season and the schedule ratio is 1 throughout.
 */
export function valueBoard(
  players: readonly DatasetPlayer[],
  snapshot: Pick<DraftRankingSnapshot, 'players' | 'scoringItems'> | null,
  options: ValueOptions = {},
): ValueBoard {
  const roster = options.roster ?? DEFAULT_ROSTER;
  const order = sourceOrder(options.prefer);
  const undraftedAdp = options.undraftedAdp ?? UNDRAFTED_ADP;
  const byEspnId = new Map<number, DraftRankingPlayer>();
  for (const entry of snapshot?.players ?? []) byEspnId.set(entry.espnId, entry);
  const scoringItems = snapshot?.scoringItems ?? [];

  const espnOf = (player: DatasetPlayer): DraftRankingPlayer | null =>
    player.espnId !== null ? byEspnId.get(player.espnId) ?? null : null;

  // The bridge from rank to points is fitted on players with a real season
  // behind them, so a rank never maps to points through a ten-game sample.
  const bridge = fitRankToPoints(players.flatMap((player) => {
    const rank = espnOf(player)?.standard?.rank ?? null;
    const last = lastSeasonFppg(player);
    const games = player.stats2026?.gp ?? player.api2026?.gp ?? 0;
    return rank !== null && last !== null && games > MIN_BRIDGE_GAMES ? [{ rank, points: last }] : [];
  }));

  const games = options.schedule ? scheduleGames(options.schedule, roster, options.phaseWeights) : null;
  const leagueAverageGames = games?.leagueAverage ?? 0;

  const valued = players.map((player): PlayerValue => {
    const espn = espnOf(player);
    const espnRank = espn?.standard?.rank ?? null;
    const adp = espn?.adp ?? null;
    const projected = espn ? projectedFppg(espn.projection, scoringItems) : null;
    const last = lastSeasonFppg(player);

    const candidates: Partial<Record<RankSource, number>> = {};
    if (projected !== null) candidates.projection = projected;
    if (espnRank !== null && bridge) candidates['espn-rank'] = round1(pointsForRank(bridge, espnRank));
    if (last !== null) candidates['last-season'] = last;
    const source = order.find((candidate) => candidates[candidate] !== undefined) ?? 'none';
    const fppg = source === 'none' ? null : candidates[source] ?? null;

    const teamId = nbaTeamIdForProTeam(player.proTeam);
    const weightedGames = games
      ? (teamId !== null ? games.byTeamId[teamId] ?? games.leagueAverage : games.leagueAverage)
      : 0;
    const scheduleRatio = leagueAverageGames > 0 ? weightedGames / leagueAverageGames : 1;

    return {
      player,
      positions: positionsOf(player),
      fppg,
      source,
      espnRank,
      adp,
      roomRank: roomRankOf(espnRank, adp, undraftedAdp),
      replacementPosition: null,
      replacement: null,
      perGame: null,
      weightedGames,
      scheduleRatio,
      availability: availabilityOf(espn),
      seasonValue: null,
      rank: 0,
    };
  });

  const replacement = replacementLevels(
    valued.flatMap((entry) => (entry.fppg !== null && entry.positions.length > 0
      ? [{ fppg: entry.fppg, positions: entry.positions }]
      : [])),
    roster,
  );

  for (const entry of valued) {
    if (entry.fppg === null) continue;
    // The position with the lowest replacement level is where he displaces
    // the least, so it is the margin he actually brings. A player with no
    // known position can only start at FLEX, which the deepest level stands for.
    let level: number;
    if (entry.positions.length > 0) {
      let best: Position = entry.positions[0];
      for (const position of entry.positions) {
        if (replacement[position] < replacement[best]) best = position;
      }
      entry.replacementPosition = best;
      level = replacement[best];
    } else {
      level = Math.max(...POSITIONS.map((position) => replacement[position]));
    }
    entry.replacement = level;
    entry.perGame = round1(entry.fppg - level);
    // With no schedule, one average season each: the margin alone has to
    // order the board, so games default to 1.
    const own = games ? entry.weightedGames : 1;
    const average = games ? leagueAverageGames : 1;
    entry.seasonValue = round1(entry.fppg * own * entry.availability - level * average);
  }

  valued.sort((a, b) => {
    if (a.seasonValue === null || b.seasonValue === null) {
      if (a.seasonValue === null && b.seasonValue === null) return byNameThenId(a.player, b.player);
      return a.seasonValue === null ? 1 : -1;
    }
    return b.seasonValue - a.seasonValue
      || (b.fppg ?? 0) - (a.fppg ?? 0)
      || (a.espnRank ?? Number.MAX_SAFE_INTEGER) - (b.espnRank ?? Number.MAX_SAFE_INTEGER)
      || byNameThenId(a.player, b.player);
  });

  const counts: Record<RankSource, number> = { projection: 0, 'espn-rank': 0, 'last-season': 0, none: 0 };
  const entries = valued.map((entry, index) => {
    counts[entry.source] += 1;
    return { ...entry, rank: index + 1 };
  });
  const primary = order.find((source) => counts[source] > 0) ?? 'none';

  return { order, primary, counts, replacement, leagueAverageGames, bridge, roster, entries };
}

/**
 * The draft recap: grades, a roast and the best and worst pick for every
 * team, the draft's numbers, and a value score on every pick for the heat map.
 *
 * A team's grade weighs five things, each turned into a z-score across the
 * league so no one number swamps the rest:
 *
 *   45%  projected points of the best ten starters (the mock grade's lineup)
 *   15%  ceiling: each player at his best known points a game, 70+ games
 *   15%  floor: each player at his lowest known number, 15% fewer games
 *   15%  pick value: the sum of every pick's score below
 *   10%  bench: projected points of the players who don't start
 *
 * A pick's score sets where he went against two lists, the value board (60%)
 * and ESPN's ADP (40%). A drafted player is measured among the players who
 * were open, so keepers come off both lists first; a keeper is measured
 * against the pick he cost. The gap is scaled down as the draft goes on, since
 * ten places in round one matter more than ten in round twelve.
 *
 * Pure. No server, no browser.
 */
import type { BoardCell, DatasetPlayer } from '../keeper/types.js';
import { lastSeasonFppg } from './draftRankings.js';
import { DEFAULT_ROSTER, positionsOf, type Position, type RosterSettings, type ValueBoard } from './draftValue.js';
import { bestLineup, type GradePlayer } from './mockGrade.js';

export interface PlayerAge {
  /** Birth date, YYYY-MM-DD. */
  born: string | null;
  draftYear: number | null;
}

export interface RecapTeamInput {
  owner: string;
  name: string;
  draftPosition: number;
}

export interface RecapInput {
  season: number;
  board: readonly BoardCell[];
  values: Pick<ValueBoard, 'entries'>;
  /** Season totals and games, as the projections page shows them, by player key. */
  projections: ReadonlyMap<string, { total: number | null; games: number | null; adp: number | null }>;
  teams: readonly RecapTeamInput[];
  /** By ESPN id. */
  ages: Readonly<Record<string, PlayerAge>>;
  /** Ages are taken on this day. */
  asOf: string;
  roster?: RosterSettings;
  /** The commissioner's saved roasts. An empty string means "use the line the numbers write". */
  roasts?: Readonly<Record<string, string>>;
  /** The roasts written on draft night, used until the commissioner saves one. */
  seedRoasts?: Readonly<Record<string, string>>;
}

export type Verdict = 'Steal' | 'Good value' | 'Fair price' | 'A bit early' | 'Reach' | 'No numbers';

export interface RecapPick {
  overall: number;
  round: number;
  /** Place within the round, 1 to 10, snake order applied. */
  slot: number;
  owner: string;
  originalOwner: string;
  /** Column on the board: the draft position of the team the pick started with. */
  column: number;
  keeper: boolean;
  auto: boolean;
  /** Seconds on the clock. Null for keepers and picks saved before the timer. */
  seconds: number | null;
  clockCalledBy: string | null;
  key: string | null;
  name: string;
  shortName: string;
  proTeam: string;
  positions: Position[];
  fppg: number | null;
  games: number | null;
  total: number | null;
  valueRank: number | null;
  adp: number | null;
  age: number | null;
  /** Birth date, YYYY-MM-DD, for ties on age. */
  born: string | null;
  rookie: boolean;
  /** -3 (a reach) to +3 (a steal). Null when nothing values him. */
  score: number | null;
  verdict: Verdict;
}

export interface ClubStack {
  club: string;
  players: string[];
}

export interface RecapTeam {
  owner: string;
  name: string;
  draftPosition: number;
  grade: string;
  /** Weighted z-score behind the grade. */
  composite: number;
  /** 1 is the best grade. */
  rank: number;
  projected: number;
  ceiling: number;
  floor: number;
  bench: number;
  pickValue: number;
  averageAge: number | null;
  rookies: string[];
  positions: Record<Position, number>;
  stacks: ClubStack[];
  best: RecapPick | null;
  worst: RecapPick | null;
  /** Average seconds over the picks the owner made, not the app. */
  averageSeconds: number | null;
  ownPicks: number;
  autoPicks: number;
  clockCalls: number;
  timesClocked: number;
  roast: string;
  /** Where the roast came from. */
  roastSource: 'saved' | 'draft-night' | 'numbers';
}

export interface Superlative {
  label: string;
  who: string;
  detail: string;
}

export interface DraftRecap {
  season: number;
  /** Every pick on the board is filled. */
  complete: boolean;
  picks: RecapPick[];
  /** Best grade first. */
  teams: RecapTeam[];
  headline: {
    picks: number;
    keepers: number;
    autoPicks: number;
    clockCalls: number;
    tradedPicks: number;
    /** First pick in to last pick in. Null without timestamps. */
    lengthMinutes: number | null;
    averageSeconds: number | null;
  };
  fastest: RecapTeam | null;
  slowest: RecapTeam | null;
  makeup: Superlative[];
  /**
   * Drafted picks only (a keeper was never on offer), by plain picks after
   * or before ADP, so the list reads the way it sounds.
   */
  steals: RecapPick[];
  reaches: RecapPick[];
  /** After round one, the drafted pick nearest both his ADP and his value rank. */
  spotOn: RecapPick | null;
  /** The keeper who beat his cost by the most. */
  bestKeeper: RecapPick | null;
  /** Players drafted from each NBA team, most first. */
  clubs: ClubCount[];
  /** Players who can play each position, across every roster. */
  positionTotals: Record<Position, number>;
  /** The team with the most players at each position. */
  positionLeaders: PositionLeader[];
  /** The most players one team took from one NBA team. */
  biggestStack: { owner: string; club: string; players: string[] } | null;
}

export interface ClubCount {
  club: string;
  count: number;
}

export interface PositionLeader {
  position: Position;
  /** More than one on a tie. */
  owners: string[];
  count: number;
}


export const GRADE_WEIGHTS = { projected: 0.45, ceiling: 0.15, floor: 0.15, pickValue: 0.15, bench: 0.1 } as const;

/** Composite at or above each line earns the grade. */
const GRADE_LINES: readonly [number, string][] = [
  [1.2, 'A'], [0.6, 'A-'], [0.25, 'B+'], [0, 'B'], [-0.4, 'B-'], [-0.8, 'C+'], [-1.2, 'C'], [-1.45, 'C-'], [-1.8, 'D+'],
];

export function gradeForComposite(composite: number): string {
  return GRADE_LINES.find(([line]) => composite >= line)?.[1] ?? 'D';
}

export function verdictFor(score: number | null): Verdict {
  if (score === null) return 'No numbers';
  if (score >= 1) return 'Steal';
  if (score >= 0.3) return 'Good value';
  if (score > -0.3) return 'Fair price';
  if (score > -1.2) return 'A bit early';
  return 'Reach';
}

/** Whole years old on `asOf`. */
export function ageOn(born: string | null, asOf: string): number | null {
  if (!born) return null;
  const birth = new Date(`${born}T12:00:00Z`);
  const day = new Date(asOf);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(day.getTime())) return null;
  let years = day.getUTCFullYear() - birth.getUTCFullYear();
  const before = day.getUTCMonth() < birth.getUTCMonth()
    || (day.getUTCMonth() === birth.getUTCMonth() && day.getUTCDate() < birth.getUTCDate());
  if (before) years -= 1;
  return years;
}

const UNVALUED_RANK = 400;
const UNDRAFTED_ADP = 150;
const SCORE_SCALE = 1.6;
const SCORE_CAP = 3;

/** How far one place counts at this point in the draft. */
const spread = (n: number) => Math.pow(n + 4, 0.75);

const round1 = (value: number) => Math.round(value * 10) / 10;

function zScores(values: readonly number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length || 1)) || 1;
  return values.map((value) => (value - mean) / sd);
}

function shortOf(player: DatasetPlayer | null, fallback: string): string {
  return player?.name ?? fallback;
}

export function buildDraftRecap(input: RecapInput): DraftRecap {
  const roster = input.roster ?? DEFAULT_ROSTER;
  const valueByKey = new Map(input.values.entries.map((entry) => [entry.player.key, entry]));
  const columnOf = new Map(input.teams.map((team) => [team.owner, team.draftPosition]));

  // The raw rows, before any score.
  const rows = input.board.map((cell) => {
    const key = cell.selection?.playerKey ?? cell.keeper?.selection.playerKey ?? null;
    const value = key ? valueByKey.get(key) ?? null : null;
    const player = value?.player ?? cell.keeper?.player ?? null;
    const projection = key ? input.projections.get(key) ?? null : null;
    const espnId = player?.espnId ?? (key && /^p\d+$/.test(key) ? Number(key.slice(1)) : null);
    const age = espnId !== null ? input.ages[String(espnId)] ?? null : null;
    const name = player?.fullName ?? player?.name ?? cell.selection?.playerName ?? cell.keeper?.selection.playerName ?? '';
    return {
      cell,
      key,
      value,
      player,
      pick: {
        overall: cell.pick.overall,
        round: cell.pick.round,
        slot: cell.pick.slot,
        owner: cell.pick.currentOwner,
        originalOwner: cell.pick.originalOwner,
        column: columnOf.get(cell.pick.originalOwner) ?? cell.pick.slot,
        keeper: cell.keeper !== null && !cell.selection,
        auto: cell.selection?.auto === true,
        seconds: cell.selection && typeof cell.selection.seconds === 'number' ? cell.selection.seconds : null,
        clockCalledBy: cell.selection?.clockCalledBy ?? null,
        key,
        name,
        shortName: shortOf(player, cell.selection?.playerName ?? name),
        proTeam: player?.proTeam ?? cell.selection?.proTeam ?? '',
        positions: player ? positionsOf(player) : positionsOf({ positions: cell.selection?.positions ?? [] }),
        fppg: value?.fppg ?? null,
        games: projection?.games ?? null,
        total: projection?.total ?? null,
        valueRank: value && value.seasonValue !== null ? value.rank : null,
        adp: projection?.adp ?? null,
        age: ageOn(age?.born ?? null, input.asOf),
        born: age?.born ?? null,
        rookie: age?.draftYear === input.season - 1,
        score: null,
        verdict: 'No numbers',
      } as RecapPick,
    };
  });
  const filled = rows.filter((row) => row.key !== null);

  // Keepers come off both lists before a drafted player is measured.
  const keeperRanks = filled.filter((row) => row.pick.keeper).map((row) => row.pick.valueRank ?? UNVALUED_RANK);
  const keeperAdps = filled.filter((row) => row.pick.keeper).map((row) => row.pick.adp ?? UNDRAFTED_ADP);
  let openIndex = 0;
  for (const row of rows) {
    if (!row.key) continue;
    const pick = row.pick;
    if (!pick.keeper) openIndex += 1;
    if (pick.valueRank === null) continue;
    const rank = pick.valueRank;
    const adp = pick.adp ?? UNDRAFTED_ADP;
    let valueGap: number;
    let adpGap: number;
    if (pick.keeper) {
      valueGap = (pick.overall - rank) / spread(pick.overall);
      adpGap = (pick.overall - adp) / spread(pick.overall);
    } else {
      const openRank = rank - keeperRanks.filter((other) => other < rank).length;
      const openAdp = adp - keeperAdps.filter((other) => other < adp).length;
      valueGap = (openIndex - openRank) / spread(openIndex);
      adpGap = (openIndex - openAdp) / spread(openIndex);
    }
    const score = Math.max(-SCORE_CAP, Math.min(SCORE_CAP, SCORE_SCALE * (0.6 * valueGap + 0.4 * adpGap)));
    pick.score = Math.round(score * 100) / 100;
    pick.verdict = verdictFor(pick.score);
  }
  const picks = rows.map((row) => row.pick);

  // Totals for the three lineups.
  const ceilingOf = (row: (typeof rows)[number]): number | null => {
    if (row.pick.fppg === null) return null;
    const best = Math.max(row.pick.fppg, row.player ? lastSeasonFppg(row.player) ?? 0 : 0, row.player?.prior?.avg ?? 0);
    return best * Math.max(row.pick.games ?? 0, 70);
  };
  const floorOf = (row: (typeof rows)[number]): number | null => {
    const low = row.value?.fppgLow ?? null;
    return low === null ? null : low * (row.pick.games ?? 0) * 0.85;
  };
  const lineupOf = (owner: string, total: (row: (typeof rows)[number]) => number | null) => {
    const mine = filled.filter((row) => row.pick.owner === owner);
    const players = new Map<string, GradePlayer>(mine.map((row) => [row.key!, {
      name: row.pick.name, positions: row.pick.positions, total: total(row), adp: row.pick.adp,
    }]));
    const lineup = bestLineup(mine.map((row) => row.key!), players, roster);
    const all = mine.reduce((sum, row) => sum + (total(row) ?? 0), 0);
    return { points: lineup.points, bench: Math.round(all - lineup.points) };
  };

  const base = input.teams.map((team) => {
    const mine = picks.filter((pick) => pick.owner === team.owner && pick.key !== null);
    const projected = lineupOf(team.owner, (row) => row.pick.total);
    const ages = mine.map((pick) => pick.age).filter((age): age is number => age !== null);
    const own = mine.filter((pick) => !pick.keeper && !pick.auto && pick.seconds !== null);
    const scored = mine.filter((pick) => pick.score !== null);
    const positions = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<Position, number>;
    for (const pick of mine) for (const position of pick.positions) positions[position] += 1;
    const clubs = new Map<string, string[]>();
    for (const pick of mine) if (pick.proTeam && pick.proTeam !== 'FA') clubs.set(pick.proTeam, [...(clubs.get(pick.proTeam) ?? []), pick.name]);
    return {
      owner: team.owner,
      name: team.name,
      draftPosition: team.draftPosition,
      projected: projected.points,
      bench: projected.bench,
      ceiling: lineupOf(team.owner, ceilingOf).points,
      floor: lineupOf(team.owner, floorOf).points,
      pickValue: round1(scored.reduce((sum, pick) => sum + (pick.score ?? 0), 0)),
      averageAge: ages.length > 0 ? round1(ages.reduce((sum, age) => sum + age, 0) / ages.length) : null,
      rookies: mine.filter((pick) => pick.rookie).map((pick) => pick.name),
      positions,
      stacks: [...clubs.entries()].filter(([, names]) => names.length >= 3).map(([club, names]) => ({ club, players: names })),
      // Keepers were never on offer, so a team's best and worst picks are drafted ones.
      best: scored.filter((pick) => !pick.keeper).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.overall - b.overall)[0] ?? null,
      worst: scored.filter((pick) => !pick.keeper).sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.overall - b.overall)[0] ?? null,
      averageSeconds: own.length > 0 ? Math.round(own.reduce((sum, pick) => sum + (pick.seconds ?? 0), 0) / own.length) : null,
      ownPicks: own.length,
      autoPicks: mine.filter((pick) => pick.auto).length,
      clockCalls: picks.filter((pick) => pick.clockCalledBy === team.owner).length,
      timesClocked: mine.filter((pick) => pick.clockCalledBy).length,
    };
  });

  const z = {
    projected: zScores(base.map((team) => team.projected)),
    ceiling: zScores(base.map((team) => team.ceiling)),
    floor: zScores(base.map((team) => team.floor)),
    pickValue: zScores(base.map((team) => team.pickValue)),
    bench: zScores(base.map((team) => team.bench)),
  };
  const graded = base.map((team, index) => {
    const composite = Math.round((
      GRADE_WEIGHTS.projected * z.projected[index]
      + GRADE_WEIGHTS.ceiling * z.ceiling[index]
      + GRADE_WEIGHTS.floor * z.floor[index]
      + GRADE_WEIGHTS.pickValue * z.pickValue[index]
      + GRADE_WEIGHTS.bench * z.bench[index]
    ) * 100) / 100;
    return { ...team, composite, grade: gradeForComposite(composite) };
  });
  graded.sort((a, b) => b.composite - a.composite || a.owner.localeCompare(b.owner));

  const teams: RecapTeam[] = graded.map((team, index) => {
    const saved = input.roasts?.[team.owner];
    const seed = input.seedRoasts?.[team.owner];
    const roastSource: RecapTeam['roastSource'] = saved !== undefined && saved.trim() !== ''
      ? 'saved'
      : saved === undefined && seed ? 'draft-night' : 'numbers';
    const withRank = { ...team, rank: index + 1, roast: '', roastSource };
    withRank.roast = roastSource === 'saved' ? saved!.trim() : roastSource === 'draft-night' ? seed! : numbersRoast(withRank, graded);
    return withRank;
  });

  const timed = teams.filter((team) => team.averageSeconds !== null);
  const fastest = [...timed].sort((a, b) => a.averageSeconds! - b.averageSeconds!)[0] ?? null;
  const slowest = [...timed].sort((a, b) => b.averageSeconds! - a.averageSeconds!)[0] ?? null;

  const stamps = input.board.map((cell) => cell.selection?.timestamp).filter((stamp): stamp is string => !!stamp).map((stamp) => Date.parse(stamp)).filter(Number.isFinite);
  const humanTimes = picks.filter((pick) => !pick.keeper && !pick.auto && pick.seconds !== null).map((pick) => pick.seconds!);
  const scoredPicks = picks.filter((pick) => pick.score !== null && pick.key !== null);
  const drafted = scoredPicks.filter((pick) => !pick.keeper);
  const withAdp = drafted.filter((pick) => pick.adp !== null);
  // How far a pick landed from the nearer-missed of his ADP and his value rank.
  const missOf = (pick: RecapPick) => Math.max(Math.abs(adpGap(pick)!), Math.abs(pick.overall - (pick.valueRank ?? UNVALUED_RANK)));

  return {
    season: input.season,
    complete: rows.every((row) => row.key !== null),
    picks,
    teams,
    headline: {
      picks: filled.length,
      keepers: picks.filter((pick) => pick.keeper && pick.key).length,
      autoPicks: picks.filter((pick) => pick.auto).length,
      clockCalls: picks.filter((pick) => pick.clockCalledBy).length,
      tradedPicks: picks.filter((pick) => pick.owner !== pick.originalOwner).length,
      lengthMinutes: stamps.length > 1 ? Math.round((Math.max(...stamps) - Math.min(...stamps)) / 60000) : null,
      averageSeconds: humanTimes.length > 0 ? Math.round(humanTimes.reduce((sum, value) => sum + value, 0) / humanTimes.length) : null,
    },
    fastest,
    slowest: slowest && slowest !== fastest ? slowest : null,
    makeup: makeupOf(teams, picks),
    // A steal fell past ESPN's spot and the value math agrees; a reach is the mirror.
    steals: withAdp.filter((pick) => adpGap(pick)! > 0 && (pick.score ?? 0) > 0).sort((a, b) => adpGap(b)! - adpGap(a)! || a.overall - b.overall).slice(0, 5),
    reaches: withAdp.filter((pick) => adpGap(pick)! < 0 && (pick.score ?? 0) < 0).sort((a, b) => adpGap(a)! - adpGap(b)! || a.overall - b.overall).slice(0, 5),
    // Round one is spot on by default, so it doesn't count.
    spotOn: withAdp.filter((pick) => pick.round > 1)
      .sort((a, b) => missOf(a) - missOf(b) || b.overall - a.overall)[0] ?? null,
    clubs: clubsOf(picks),
    positionTotals: positionTotalsOf(teams),
    positionLeaders: positionLeadersOf(teams),
    biggestStack: biggestStackOf(teams),
    bestKeeper: [...scoredPicks].filter((pick) => pick.keeper).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.overall - b.overall)[0] ?? null,
  };
}

function makeupOf(teams: readonly RecapTeam[], picks: readonly RecapPick[]): Superlative[] {
  const out: Superlative[] = [];
  // Birth dates, not whole years, so two 19-year-olds still have a youngest.
  const withAge = picks.filter((pick) => pick.age !== null && pick.born !== null && pick.key);
  const oldMan = [...withAge].sort((a, b) => a.born!.localeCompare(b.born!) || a.overall - b.overall)[0];
  const kid = [...withAge].sort((a, b) => b.born!.localeCompare(a.born!) || a.overall - b.overall)[0];
  if (oldMan) out.push({ label: 'Oldest player', who: oldMan.owner, detail: `${oldMan.name}, ${oldMan.age}, taken at ${pickPlace(oldMan)}.` });
  if (kid) out.push({ label: 'Youngest player', who: kid.owner, detail: `${kid.name}, ${kid.age}, taken at ${pickPlace(kid)}.` });
  const rookieTeam = [...teams].sort((a, b) => b.rookies.length - a.rookies.length)[0];
  const rookieCount = picks.filter((pick) => pick.rookie).length;
  if (rookieTeam && rookieTeam.rookies.length > 0) {
    out.push({ label: 'Most rookies', who: rookieTeam.owner, detail: `${rookieTeam.rookies.join(', ')}. ${rookieCount} rookies went in all.` });
  }
  const caller = [...teams].sort((a, b) => b.clockCalls - a.clockCalls)[0];
  if (caller && caller.clockCalls > 0) out.push({ label: 'Most clocks called', who: caller.owner, detail: `${caller.clockCalls} of ${picks.filter((pick) => pick.clockCalledBy).length}.` });
  const robot = [...teams].sort((a, b) => b.autoPicks - a.autoPicks)[0];
  if (robot && robot.autoPicks > 0) out.push({ label: 'Most auto picks', who: robot.owner, detail: `${robot.autoPicks} picks made by the app.` });
  return out;
}

/** A short line the numbers write when nobody has written a roast. */
export function numbersRoast(
  team: Pick<RecapTeam, 'owner' | 'averageAge' | 'rookies' | 'positions' | 'stacks' | 'autoPicks' | 'best' | 'worst' | 'clockCalls'>,
  league: readonly Pick<RecapTeam, 'owner' | 'averageAge'>[],
): string {
  const lines: string[] = [];
  const ages = league.map((other) => other.averageAge).filter((age): age is number => age !== null);
  if (team.autoPicks >= 5) lines.push(`The app made ${team.autoPicks} of these picks.`);
  if (team.averageAge !== null && ages.length > 0 && team.averageAge === Math.max(...ages)) lines.push(`Oldest roster in the league, average age ${team.averageAge}.`);
  if (team.averageAge !== null && ages.length > 0 && team.averageAge === Math.min(...ages)) lines.push(`Youngest roster in the league, average age ${team.averageAge}.`);
  for (const stack of team.stacks) lines.push(`Took ${stack.players.length} players from ${stack.club}.`);
  if (team.positions.C <= 1) lines.push(`Has ${team.positions.C === 1 ? 'one center' : 'no centers'}.`);
  if (team.rookies.length >= 2) lines.push(`Drafted ${team.rookies.length} rookies.`);
  if (team.clockCalls >= 3) lines.push(`Called the clock ${team.clockCalls} times.`);
  if (team.worst && team.worst.verdict === 'Reach') lines.push(`Reached for ${team.worst.name} in round ${team.worst.round}.`);
  if (team.best && team.best.verdict === 'Steal') lines.push(`Stole ${team.best.name} in round ${team.best.round}.`);
  return lines.slice(0, 3).join(' ') || 'Drafted a team. Nothing more to say yet.';
}

/** 1st, 2nd, 3rd, 11th, 22nd. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Round, then the pick within it: 9.7 is round 9's seventh pick. */
export function pickPlace(pick: Pick<RecapPick, 'round' | 'slot'>): string {
  return `${pick.round}.${pick.slot}`;
}

// ─── Clubs and positions ─────────────────────────────────────────────────────

export const POSITION_ORDER: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export function clubsOf(picks: readonly Pick<RecapPick, 'key' | 'proTeam'>[]): ClubCount[] {
  const counts = new Map<string, number>();
  for (const pick of picks) if (pick.key && pick.proTeam && pick.proTeam !== 'FA') counts.set(pick.proTeam, (counts.get(pick.proTeam) ?? 0) + 1);
  return [...counts.entries()].map(([club, count]) => ({ club, count })).sort((a, b) => b.count - a.count || a.club.localeCompare(b.club));
}

export function positionTotalsOf(teams: readonly Pick<RecapTeam, 'positions'>[]): Record<Position, number> {
  const totals = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<Position, number>;
  for (const team of teams) for (const position of POSITION_ORDER) totals[position] += team.positions[position];
  return totals;
}

export function positionLeadersOf(teams: readonly Pick<RecapTeam, 'owner' | 'positions'>[]): PositionLeader[] {
  return POSITION_ORDER.map((position) => {
    const count = Math.max(0, ...teams.map((team) => team.positions[position]));
    return { position, count, owners: teams.filter((team) => team.positions[position] === count).map((team) => team.owner) };
  });
}

export function biggestStackOf(teams: readonly Pick<RecapTeam, 'owner' | 'stacks'>[]): DraftRecap['biggestStack'] {
  const all = teams.flatMap((team) => team.stacks.map((stack) => ({ owner: team.owner, club: stack.club, players: stack.players })));
  return all.sort((a, b) => b.players.length - a.players.length || a.owner.localeCompare(b.owner))[0] ?? null;
}

/** Picks after his ADP he went: positive fell to you, negative was taken early. Null without an ADP. */
export function adpGap(pick: Pick<RecapPick, 'overall' | 'adp'>): number | null {
  return pick.adp === null ? null : Math.round(pick.overall - pick.adp);
}

/** The ADP gap in words: "34 picks later than ESPN drafts take him". */
export function adpGapText(pick: Pick<RecapPick, 'overall' | 'adp'>): string {
  const gap = adpGap(pick);
  if (gap === null) return 'ESPN drafts rarely take him';
  if (gap === 0) return 'Right where ESPN drafts take him';
  const count = Math.abs(gap);
  return `${count} pick${count === 1 ? '' : 's'} ${gap > 0 ? 'later' : 'earlier'} than ESPN drafts take him`;
}

// ─── The pick table ──────────────────────────────────────────────────────────

export type RecapColumnId = 'place' | 'overall' | 'owner' | 'name' | 'positions' | 'proTeam' | 'age' | 'fppg' | 'games' | 'valueRank' | 'adp' | 'adpGap' | 'seconds' | 'score' | 'verdict';

export interface RecapColumn {
  id: RecapColumnId;
  header: string;
  value: (pick: RecapPick) => string | number | null;
}

export const RECAP_COLUMNS: readonly RecapColumn[] = [
  { id: 'place', header: 'Pick', value: (pick) => pickPlace(pick) },
  { id: 'overall', header: 'Overall', value: (pick) => pick.overall },
  { id: 'owner', header: 'Team', value: (pick) => pick.owner },
  { id: 'name', header: 'Player', value: (pick) => pick.name },
  { id: 'positions', header: 'Pos', value: (pick) => pick.positions.join('/') },
  { id: 'proTeam', header: 'NBA', value: (pick) => pick.proTeam },
  { id: 'age', header: 'Age', value: (pick) => pick.age },
  { id: 'fppg', header: 'FPPG', value: (pick) => pick.fppg },
  { id: 'games', header: 'Games', value: (pick) => pick.games },
  { id: 'valueRank', header: 'Value rank', value: (pick) => pick.valueRank },
  { id: 'adp', header: 'ESPN draft spot', value: (pick) => (pick.adp === null ? null : Math.round(pick.adp * 10) / 10) },
  { id: 'adpGap', header: 'Picks later than ESPN', value: (pick) => (pick.keeper ? null : adpGap(pick)) },
  { id: 'seconds', header: 'Seconds', value: (pick) => pick.seconds },
  { id: 'score', header: 'Value score', value: (pick) => pick.score },
  { id: 'verdict', header: 'Verdict', value: (pick) => (pick.keeper ? `${pick.verdict} (keeper)` : pick.auto ? `${pick.verdict} (auto)` : pick.verdict) },
];

export interface RecapSort {
  column: RecapColumnId;
  dir: 'asc' | 'desc';
}

/** Ascending, then descending, then back to draft order. */
export function nextRecapSort(current: RecapSort | null, column: RecapColumnId): RecapSort | null {
  if (!current || current.column !== column) return { column, dir: 'asc' };
  return current.dir === 'asc' ? { column, dir: 'desc' } : null;
}

/** Filter by a search across every column, then sort. Empty values sort last both ways. */
export function recapRows(picks: readonly RecapPick[], query: string, sort: RecapSort | null): RecapPick[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = picks.filter((pick) => pick.key !== null && words.every((word) =>
    RECAP_COLUMNS.some((column) => String(column.value(pick) ?? '').toLowerCase().includes(word))
    ));
  if (!sort) return shown;
  // 10.1 sorts after 9.7, so the pick column sorts by overall.
  const column = RECAP_COLUMNS.find((entry) => entry.id === (sort.column === 'place' ? 'overall' : sort.column))!;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...shown].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (left === null && right === null) return a.overall - b.overall;
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right));
    return order * sign || a.overall - b.overall;
  });
}

export interface RecapPage {
  rows: RecapPick[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

export function recapPage(rows: readonly RecapPick[], page: number, size: number): RecapPage {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const shown = rows.slice(start, start + size);
  return { rows: shown, page: current, pageCount, from: shown.length > 0 ? start + 1 : 0, to: start + shown.length, total: rows.length };
}

const csvCell = (value: string | number | null) => {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function recapCsv(rows: readonly RecapPick[]): string {
  const header = RECAP_COLUMNS.map((column) => csvCell(column.header)).join(',');
  const body = rows.map((pick) => RECAP_COLUMNS.map((column) => csvCell(column.value(pick))).join(','));
  return `${[header, ...body].join('\n')}\n`;
}

// ─── Saved roasts ────────────────────────────────────────────────────────────

export const ROAST_MAX_LENGTH = 600;

/** Check a roast the commissioner sends. Returns the cleaned text, or throws. */
export function parseRoast(owners: readonly string[], body: unknown): { owner: string; text: string } {
  const { owner, text } = (body ?? {}) as { owner?: unknown; text?: unknown };
  if (typeof owner !== 'string' || !owners.includes(owner)) throw new Error('Pick a team in the league.');
  if (typeof text !== 'string') throw new Error('Send the roast as text.');
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length > ROAST_MAX_LENGTH) throw new Error(`Keep a roast to ${ROAST_MAX_LENGTH} characters.`);
  return { owner, text: clean };
}

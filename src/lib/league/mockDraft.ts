/**
 * The mock draft: a seeded simulation of this league's draft, run many times,
 * that answers "who is likely to be there at my pick".
 *
 * It starts from the real board. `buildMockBoard` takes the picks with trade
 * ownership resolved, the keepers the viewer is allowed to know, and any
 * picks already made, all through the keeper engine and nothing else. A
 * keeper fills its pick slot. Every other slot is a live pick.
 *
 * Nine opponents then draft. Each reads its own settings, even though every
 * team starts with the same ones, so the commissioner can later say "Kyle
 * reaches" by changing a number. A team scores every available player on a
 * blend of our value (what it should do) and the room's ADP (what people
 * actually do), pulls up players that fill an open starting slot, adds
 * noise, and picks from the best few rather than always the best one.
 *
 * Two presets. Sharp: every team drafts to our value, as if all ten had read
 * the projections. Realistic: weighted toward ADP, so the room reaches the
 * way real people do. They disagree, and the disagreement is the point.
 *
 * The board is an input, so a board with an assumed trade applied runs the
 * same way. Keeper secrecy holds: before the reveal, other teams' keepers
 * come from the viewer's scenario and a real hidden keeper never gets in.
 *
 * Same seed, same draft, every time. Pure. No server, no browser.
 */
import { availablePlayers, buildDraftBoard, pickLabel, resolveTeamKeepers } from '../keeper/engine.js';
import type { KeeperSelection, LeagueDataset, LeagueDynamicState, PickSlot } from '../keeper/types.js';
import type { RankSource } from './draftRankings.js';
import {
  DEFAULT_ROSTER,
  fillsSlot,
  starterSlotList,
  type Position,
  type RosterSettings,
  type StarterSlot,
  type ValueBoard,
} from './draftValue.js';
import type { KeeperScenario } from './keeperScenario.js';

// ─── Seeded randomness ──────────────────────────────────────────────────────

/** Mulberry32: a small, fast generator that repeats exactly for a seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A different but repeatable seed for each run of the same base seed. */
export function runSeed(seed: number, run: number): number {
  return (Math.imul(seed >>> 0, 0x9e3779b1) + Math.imul(run + 1, 0x85ebca6b)) >>> 0;
}

/** Standard normal draws from a uniform generator, by Box-Muller. */
export function gaussian(random: () => number): number {
  let u = 0;
  while (u === 0) u = random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── The board the mock starts from ─────────────────────────────────────────

export type KeeperStatus = 'known' | 'assumed';

export interface MockKeeper extends KeeperSelection {
  /** Known: the real keeper, visible to the viewer. Assumed: a guess. */
  status: KeeperStatus;
}

export interface MockSlot {
  pick: PickSlot;
  /** The keeper charged to this pick, when there is one. */
  keeper: MockKeeper | null;
  /** A pick already made in the real draft. */
  made: KeeperSelection | null;
}

export interface RejectedKeepers {
  owner: string;
  status: KeeperStatus;
  errors: string[];
}

export interface MockBoard {
  season: number;
  slots: MockSlot[];
  /** Player keys off the board before the mock starts: keepers and picks made. */
  taken: string[];
  /**
   * Owners whose keeper set the engine refused, with why. The engine drops
   * an illegal set silently and leaves the picks live, which a guess must
   * not be allowed to do without saying so.
   */
  rejected: RejectedKeepers[];
  assumedOwners: string[];
  knownOwners: string[];
}

export interface MockBoardInput {
  /** Whose eyes. Their own real keepers are always theirs to see. */
  viewer: string | null;
  state: LeagueDynamicState;
  /** The viewer's guesses at what other teams keep, and their own what-ifs. */
  scenario: KeeperScenario;
}

export interface MockKeeperSets {
  keepers: Record<string, KeeperSelection[]>;
  status: Record<string, KeeperStatus>;
}

/**
 * The keeper selections the mock may use, team by team.
 *
 * After the reveal every team's real keepers are known. Before it, only the
 * viewer's own are; every other team gets the viewer's assumption from the
 * scenario, or nothing. The real hidden keepers are never read for another
 * team pre-reveal, so they cannot leak into a guess. The viewer's own
 * scenario entry, when there is one, is a what-if and wins over their real
 * selection, which is how "if I keep Cade" gets asked.
 */
export function keepersForMock(
  dataset: Pick<LeagueDataset, 'teams'>,
  input: MockBoardInput,
): MockKeeperSets {
  const revealed = input.state.keepersRevealed === true;
  const keepers: Record<string, KeeperSelection[]> = {};
  const status: Record<string, KeeperStatus> = {};
  const copy = (selections: readonly KeeperSelection[] | undefined): KeeperSelection[] =>
    (selections ?? []).map((selection) => ({ ...selection }));

  for (const team of dataset.teams) {
    const owner = team.owner;
    const assumed = input.scenario[owner];
    if (owner === input.viewer) {
      if (assumed) {
        keepers[owner] = copy(assumed);
        status[owner] = 'assumed';
      } else {
        keepers[owner] = copy(input.state.keepers[owner]);
        status[owner] = 'known';
      }
    } else if (revealed) {
      keepers[owner] = copy(input.state.keepers[owner]);
      status[owner] = 'known';
    } else {
      keepers[owner] = copy(assumed);
      status[owner] = 'assumed';
    }
  }
  return { keepers, status };
}

/** The board a mock draft starts from. Reads everything through the keeper engine. */
export function buildMockBoard(dataset: LeagueDataset, input: MockBoardInput): MockBoard {
  const { keepers, status } = keepersForMock(dataset, input);
  const dynamic: LeagueDynamicState = { ...input.state, keepers };
  const cells = buildDraftBoard(dataset, dynamic);
  const available = new Set(availablePlayers(dataset, dynamic).map((player) => player.key));

  const rejected: RejectedKeepers[] = [];
  for (const team of dataset.teams) {
    const selections = keepers[team.owner] ?? [];
    if (selections.length === 0) continue;
    const result = resolveTeamKeepers(dataset, team.owner, selections);
    if (!result.valid) rejected.push({ owner: team.owner, status: status[team.owner], errors: [...result.errors] });
  }

  const slots = cells.map((cell): MockSlot => ({
    pick: { ...cell.pick },
    keeper: cell.keeper
      ? {
          playerKey: cell.keeper.selection.playerKey,
          playerName: cell.keeper.selection.playerName,
          status: status[cell.pick.currentOwner] ?? 'assumed',
        }
      : null,
    made: cell.selection?.playerKey
      ? { playerKey: cell.selection.playerKey, playerName: cell.selection.playerName ?? cell.selection.playerKey }
      : null,
  }));

  const owners = dataset.teams.map((team) => team.owner);
  return {
    season: dataset.season,
    slots,
    taken: dataset.players.filter((player) => !available.has(player.key)).map((player) => player.key),
    rejected,
    assumedOwners: owners.filter((owner) => status[owner] === 'assumed'),
    knownOwners: owners.filter((owner) => status[owner] === 'known'),
  };
}

// ─── How each team drafts ───────────────────────────────────────────────────

export interface OwnerTendency {
  /** 0 drafts to our value, 1 drafts to the room's ADP. */
  adpWeight: number;
  /** How far a player who fills an open starting slot moves up, as a share of his score. */
  needWeight: number;
  /** Random spread as a share of the score. 0 is a robot. */
  noise: number;
  /** Picks from the best this many, not only the best, when they are close. */
  topK: number;
  /**
   * How close a player must be to the best one to be in that draw, as a share
   * of the best score. A clear best is taken; a near tie is a coin flip. This
   * is what keeps the second pick of the draft from falling to fifth.
   */
  topBand: number;
  /** Per-position pull as a share of score. Negative pulls the position up. */
  positionBias: Partial<Record<Position, number>>;
}

export type MockMode = 'sharp' | 'realistic';

export const MODE_PRESETS: Record<MockMode, OwnerTendency> = {
  sharp: { adpWeight: 0, needWeight: 0.1, noise: 0.08, topK: 2, topBand: 0.05, positionBias: {} },
  realistic: { adpWeight: 0.75, needWeight: 0.15, noise: 0.22, topK: 3, topBand: 0.25, positionBias: {} },
};

/** In the draw among close candidates, each next one has this share of the chance of the one before. */
const DRAW_DECAY = 0.6;

export interface MockDraftSettings {
  mode: MockMode;
  /** Per-owner changes on top of the preset. Every owner has an entry, even an empty one. */
  owners: Record<string, Partial<OwnerTendency>>;
  seed: number;
}

/** The settings every mock starts with: one entry per owner, all identical. */
export function defaultMockSettings(mode: MockMode, owners: readonly string[], seed = 1): MockDraftSettings {
  return {
    mode,
    owners: Object.fromEntries(owners.map((owner) => [owner, {}])),
    seed,
  };
}

/** What one team does at the table: the preset with that owner's changes on top. */
export function tendencyFor(settings: MockDraftSettings, owner: string): OwnerTendency {
  const preset = MODE_PRESETS[settings.mode];
  const own = settings.owners[owner] ?? {};
  return {
    ...preset,
    ...own,
    positionBias: { ...preset.positionBias, ...(own.positionBias ?? {}) },
  };
}

// ─── Lineups ────────────────────────────────────────────────────────────────

export interface LineupFit {
  /** Starting slots a roster can fill at once. */
  filled: number;
  /** Slots nobody on the roster can start at, in rule-book order. */
  open: StarterSlot[];
}

/** One player's eligibility, as the matching sees it. */
type Eligible = readonly Position[];

/**
 * Try to seat player `who` in a starting slot, moving others along if that
 * frees one. Standard augmenting path over a bipartite matching. `seat[slot]`
 * holds the index of the player in it, or -1.
 */
function seatPlayer(
  who: number,
  players: readonly Eligible[],
  slots: readonly StarterSlot[],
  seat: number[],
  visited: boolean[],
): boolean {
  for (let index = 0; index < slots.length; index += 1) {
    if (visited[index] || !fillsSlot(players[who], slots[index])) continue;
    visited[index] = true;
    if (seat[index] === -1 || seatPlayer(seat[index], players, slots, seat, visited)) {
      seat[index] = who;
      return true;
    }
  }
  return false;
}

/** Seat as many of a roster as possible, best effort, and say which slots stay open. */
export function lineupFit(players: readonly Eligible[], roster: RosterSettings): LineupFit {
  const slots = starterSlotList(roster);
  const seat = slots.map(() => -1);
  let filled = 0;
  for (let who = 0; who < players.length; who += 1) {
    if (seatPlayer(who, players, slots, seat, slots.map(() => false))) filled += 1;
  }
  return { filled, open: slots.filter((_, index) => seat[index] === -1) };
}

// ─── The draft itself ───────────────────────────────────────────────────────

/** One player as the mock sees him: the value board's numbers, nothing more. */
export interface MockCandidate {
  playerKey: string;
  playerName: string;
  positions: Position[];
  /** Place on the value board, best first. */
  valueRank: number;
  roomRank: number | null;
  source: RankSource;
}

export interface MockPick {
  overall: number;
  round: number;
  slot: number;
  /** "1.9" */
  label: string;
  owner: string;
  playerKey: string | null;
  playerName: string | null;
  positions: Position[];
  how: 'keeper' | 'made' | 'pick' | 'empty';
  keeperStatus: KeeperStatus | null;
  valueRank: number | null;
  roomRank: number | null;
}

export interface MockWarning {
  owner: string;
  /** The pick it was noticed at, or null for the end of the draft. */
  overall: number | null;
  message: string;
}

export interface MockDraftResult {
  seed: number;
  mode: MockMode;
  picks: MockPick[];
  rosters: Record<string, string[]>;
  lineups: Record<string, LineupFit>;
  warnings: MockWarning[];
  /** Every player who was on the board when the mock started. Shared across runs. */
  pool: MockCandidate[];
}

export interface MockDraftInput {
  board: MockBoard;
  values: ValueBoard;
  settings: MockDraftSettings;
  roster?: RosterSettings;
}

/** How deep a team looks before it stops considering players. */
const CANDIDATE_WINDOW = 30;

interface TeamState {
  owner: string;
  keys: string[];
  eligible: Eligible[];
  /** The starting lineup so far: the index of the player in each slot, or -1. */
  seat: number[];
  picksLeft: number;
}

interface PreparedMock {
  input: MockDraftInput;
  roster: RosterSettings;
  pool: MockCandidate[];
  byKey: Map<string, MockCandidate>;
  /** Pool indexes in each owner's preferred order, best first. */
  orderByOwner: Map<string, number[]>;
  tendencies: Map<string, OwnerTendency>;
  owners: string[];
}

/** Everything about a mock that does not change between runs. */
export function prepareMock(input: MockDraftInput): PreparedMock {
  const roster = input.roster ?? DEFAULT_ROSTER;
  const taken = new Set(input.board.taken);
  const pool: MockCandidate[] = input.values.entries
    .filter((entry) => !taken.has(entry.player.key))
    .map((entry) => ({
      playerKey: entry.player.key,
      playerName: entry.player.name,
      positions: entry.positions,
      valueRank: entry.rank,
      roomRank: entry.roomRank,
      source: entry.source,
    }));
  const byKey = new Map(input.values.entries.map((entry) => [entry.player.key, {
    playerKey: entry.player.key,
    playerName: entry.player.name,
    positions: entry.positions,
    valueRank: entry.rank,
    roomRank: entry.roomRank,
    source: entry.source,
  } satisfies MockCandidate]));

  const owners = [...new Set(input.board.slots.map((slot) => slot.pick.currentOwner))];
  const tendencies = new Map(owners.map((owner) => [owner, tendencyFor(input.settings, owner)]));
  const orderByOwner = new Map<string, number[]>();
  for (const owner of owners) {
    const weight = tendencies.get(owner)!.adpWeight;
    const scores = pool.map((candidate) => baseScore(candidate, weight));
    const order = pool.map((_, index) => index).sort((a, b) => scores[a] - scores[b] || a - b);
    orderByOwner.set(owner, order);
  }
  return { input, roster, pool, byKey, orderByOwner, tendencies, owners };
}

/** Where a team puts a player before need and noise: our value, the room's ADP, or a blend. */
export function baseScore(candidate: Pick<MockCandidate, 'valueRank' | 'roomRank'>, adpWeight: number): number {
  const room = candidate.roomRank ?? candidate.valueRank;
  return (1 - adpWeight) * candidate.valueRank + adpWeight * room;
}

/** Add a player to a team and seat him if a starting slot can be found. */
function addToTeam(team: TeamState, key: string, positions: Eligible, slots: readonly StarterSlot[]): void {
  team.keys.push(key);
  team.eligible.push(positions);
  seatPlayer(team.eligible.length - 1, team.eligible, slots, team.seat, slots.map(() => false));
}

function openSlots(team: TeamState, slots: readonly StarterSlot[]): StarterSlot[] {
  return slots.filter((_, index) => team.seat[index] === -1);
}

/** Whether adding a player would seat one more starter. Leaves the team as it was. */
function wouldFill(team: TeamState, positions: Eligible, slots: readonly StarterSlot[]): boolean {
  team.eligible.push(positions);
  const seated = seatPlayer(team.eligible.length - 1, team.eligible, slots, [...team.seat], slots.map(() => false));
  team.eligible.pop();
  return seated;
}

/** Run one draft from a prepared mock with one seed. */
export function runMock(prepared: PreparedMock, seed: number): MockDraftResult {
  const { input, roster, pool, byKey, orderByOwner, tendencies } = prepared;
  const random = seededRandom(seed);
  const slots = starterSlotList(roster);
  const gone = new Set<string>();
  const teams = new Map<string, TeamState>();
  const teamOf = (owner: string): TeamState => {
    let team = teams.get(owner);
    if (!team) {
      team = { owner, keys: [], eligible: [], seat: slots.map(() => -1), picksLeft: 0 };
      teams.set(owner, team);
    }
    return team;
  };
  const warnings: MockWarning[] = [];
  const warnedShort = new Set<string>();

  // Keepers and picks already made fill their slots before anyone drafts.
  for (const slot of input.board.slots) {
    const team = teamOf(slot.pick.currentOwner);
    const fixed = slot.keeper ?? slot.made;
    if (fixed) {
      gone.add(fixed.playerKey);
      addToTeam(team, fixed.playerKey, byKey.get(fixed.playerKey)?.positions ?? [], slots);
    } else {
      team.picksLeft += 1;
    }
  }

  const picks: MockPick[] = input.board.slots.map((slot) => {
    const owner = slot.pick.currentOwner;
    const team = teamOf(owner);
    const shared = {
      overall: slot.pick.overall,
      round: slot.pick.round,
      slot: slot.pick.slot,
      label: pickLabel(slot.pick),
      owner,
    };
    if (slot.keeper) {
      const known = byKey.get(slot.keeper.playerKey);
      return {
        ...shared,
        playerKey: slot.keeper.playerKey,
        playerName: slot.keeper.playerName,
        positions: known?.positions ?? [],
        how: 'keeper',
        keeperStatus: slot.keeper.status,
        valueRank: known?.valueRank ?? null,
        roomRank: known?.roomRank ?? null,
      };
    }
    if (slot.made) {
      const known = byKey.get(slot.made.playerKey);
      return {
        ...shared,
        playerKey: slot.made.playerKey,
        playerName: slot.made.playerName,
        positions: known?.positions ?? [],
        how: 'made',
        keeperStatus: null,
        valueRank: known?.valueRank ?? null,
        roomRank: known?.roomRank ?? null,
      };
    }

    const tendency = tendencies.get(owner) ?? tendencyFor(input.settings, owner);
    const open = openSlots(team, slots);
    const mustFill = open.length > 0 && team.picksLeft <= open.length;
    if (mustFill && !warnedShort.has(owner)) {
      warnedShort.add(owner);
      if (team.picksLeft < open.length) {
        warnings.push({
          owner,
          overall: slot.pick.overall,
          message: `${owner} has ${team.picksLeft} pick${team.picksLeft === 1 ? '' : 's'} left and ${open.length} starting slots still open (${open.join(', ')}).`,
        });
      }
    }

    // Walk this team's list, skipping players gone, until it has a window's
    // worth of candidates. A team that must fill a slot keeps walking until
    // it finds players who do.
    const order = orderByOwner.get(owner) ?? [];
    const weight = tendency.adpWeight;
    const candidates: { candidate: MockCandidate; score: number; fills: boolean }[] = [];
    let fillers = 0;
    for (const index of order) {
      const candidate = pool[index];
      if (gone.has(candidate.playerKey)) continue;
      const fills = open.length > 0 && wouldFill(team, candidate.positions, slots);
      if (mustFill && !fills) {
        if (candidates.length >= CANDIDATE_WINDOW) continue;
      }
      if (fills) fillers += 1;
      candidates.push({ candidate, score: baseScore(candidate, weight), fills });
      const enough = candidates.length >= CANDIDATE_WINDOW && (!mustFill || fillers >= tendency.topK);
      if (enough) break;
    }
    const considered = mustFill && fillers > 0 ? candidates.filter((entry) => entry.fills) : candidates;
    if (mustFill && fillers === 0 && open.length > 0) {
      warnings.push({
        owner,
        overall: slot.pick.overall,
        message: `Nobody left on the board can start at ${open.join(' or ')} for ${owner}.`,
      });
    }

    if (considered.length === 0) {
      team.picksLeft -= 1;
      warnings.push({ owner, overall: slot.pick.overall, message: `The board ran out of players at ${pickLabel(slot.pick)}.` });
      return { ...shared, playerKey: null, playerName: null, positions: [], how: 'empty', keeperStatus: null, valueRank: null, roomRank: null };
    }

    for (const entry of considered) {
      let score = entry.score;
      if (entry.fills) score *= 1 - tendency.needWeight;
      const biases = entry.candidate.positions.map((position) => tendency.positionBias[position] ?? 0);
      if (biases.length > 0) score *= 1 + Math.min(...biases);
      score *= 1 + tendency.noise * gaussian(random);
      entry.score = Math.max(0, score);
    }
    considered.sort((a, b) => a.score - b.score || a.candidate.valueRank - b.candidate.valueRank);

    const ceiling = considered[0].score * (1 + Math.max(0, tendency.topBand));
    const top = considered
      .slice(0, Math.max(1, tendency.topK))
      .filter((entry, index) => index === 0 || entry.score <= ceiling);
    const weights = top.map((_, index) => Math.pow(DRAW_DECAY, index));
    let roll = random() * weights.reduce((total, w) => total + w, 0);
    let chosen = top[0];
    for (let index = 0; index < top.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) {
        chosen = top[index];
        break;
      }
    }

    const picked = chosen.candidate;
    gone.add(picked.playerKey);
    addToTeam(team, picked.playerKey, picked.positions, slots);
    team.picksLeft -= 1;
    return {
      ...shared,
      playerKey: picked.playerKey,
      playerName: picked.playerName,
      positions: picked.positions,
      how: 'pick',
      keeperStatus: null,
      valueRank: picked.valueRank,
      roomRank: picked.roomRank,
    };
  });

  const rosters: Record<string, string[]> = {};
  const lineups: Record<string, LineupFit> = {};
  for (const [owner, team] of teams) {
    rosters[owner] = [...team.keys];
    const fit: LineupFit = { filled: team.seat.filter((index) => index !== -1).length, open: openSlots(team, slots) };
    lineups[owner] = fit;
    if (fit.open.length > 0) {
      warnings.push({ owner, overall: null, message: `${owner} ends the draft unable to start a ${fit.open.join(' or ')}.` });
    }
  }

  return { seed, mode: input.settings.mode, picks, rosters, lineups, warnings, pool };
}

/** One draft. Same input and seed, same picks. */
export function simulateDraft(input: MockDraftInput, seed = input.settings.seed): MockDraftResult {
  return runMock(prepareMock(input), seed);
}

/** Many drafts from one seed, each with its own derived seed. */
export function simulateMany(input: MockDraftInput, runs: number): MockDraftResult[] {
  const prepared = prepareMock(input);
  const results: MockDraftResult[] = [];
  for (let run = 0; run < runs; run += 1) {
    results.push(runMock(prepared, runSeed(input.settings.seed, run)));
  }
  return results;
}

// ─── What the runs say ──────────────────────────────────────────────────────

export interface AvailabilityRow extends MockCandidate {
  /** Runs in which he was still on the board at the pick. */
  available: number;
  /** The same as a share of runs, 0 to 1. */
  availableShare: number;
  /** Runs in which this very pick took him. */
  takenHere: number;
  takenHereShare: number;
}

export interface AvailabilityReport {
  overall: number;
  label: string;
  owner: string;
  runs: number;
  /** Everyone who was there at least once, best value first. */
  rows: AvailabilityRow[];
}

/**
 * For one pick, how often each player was still on the board across the
 * runs, and how often that pick took him. This distribution is the product.
 */
export function availabilityAt(results: readonly MockDraftResult[], overall: number): AvailabilityReport {
  if (results.length === 0) throw new Error('No runs to report on');
  const first = results[0];
  const slot = first.picks.find((pick) => pick.overall === overall);
  if (!slot) throw new Error(`No pick ${overall} on the board`);

  const available = new Map<string, number>();
  const takenHere = new Map<string, number>();
  for (const result of results) {
    const gone = new Set<string>();
    for (const pick of result.picks) {
      if (pick.overall >= overall) break;
      if (pick.playerKey) gone.add(pick.playerKey);
    }
    for (const candidate of result.pool) {
      if (!gone.has(candidate.playerKey)) available.set(candidate.playerKey, (available.get(candidate.playerKey) ?? 0) + 1);
    }
    const here = result.picks.find((pick) => pick.overall === overall);
    if (here?.playerKey) takenHere.set(here.playerKey, (takenHere.get(here.playerKey) ?? 0) + 1);
  }

  const runs = results.length;
  const rows = first.pool
    .filter((candidate) => (available.get(candidate.playerKey) ?? 0) > 0)
    .map((candidate): AvailabilityRow => {
      const there = available.get(candidate.playerKey) ?? 0;
      const took = takenHere.get(candidate.playerKey) ?? 0;
      return {
        ...candidate,
        available: there,
        availableShare: there / runs,
        takenHere: took,
        takenHereShare: took / runs,
      };
    })
    .sort((a, b) => a.valueRank - b.valueRank);

  return { overall, label: slot.label, owner: slot.owner, runs, rows };
}

/** "1.9 (Brey), 200 runs: A. Davis 71%, L. James 64%, ..." */
export function describeAvailability(report: AvailabilityReport, limit = 8): string {
  const parts = report.rows
    .slice(0, limit)
    .map((row) => `${row.playerName} ${Math.round(row.availableShare * 100)}%`);
  return `${report.label} (${report.owner}), ${report.runs} runs: ${parts.join(', ')}`;
}

/** One run as a list of lines, "1.1 Joel: N. Jokic (keeper)". */
export function describeRound(result: MockDraftResult, round: number): string[] {
  return result.picks
    .filter((pick) => pick.round === round)
    .map((pick) => {
      const how = pick.how === 'keeper'
        ? ` (${pick.keeperStatus === 'known' ? 'keeper' : 'assumed keeper'})`
        : pick.how === 'made' ? ' (already picked)' : '';
      return `${pick.label} ${pick.owner}: ${pick.playerName ?? 'nobody'}${how}`;
    });
}

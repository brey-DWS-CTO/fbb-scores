/**
 * The mock draft room: the pieces a draft screen needs around the live mock.
 * Who picks next, how far off your turn is, your roster by slot, your queue,
 * the rounds-by-teams grid, and a saved copy of the draft so leaving the page
 * never loses it.
 *
 * Pure. No server, no browser. Storage is passed in.
 */
import { STARTER_SLOTS, fillsSlot, type Position, type RosterSettings, type StarterSlot } from './draftValue.js';
import { replayLive, type LiveChoices, type LiveState } from './liveMock.js';
import type { MockCandidate, MockMode, MockPick, MockSlot, PreparedMock } from './mockDraft.js';

// ─── Who is up ──────────────────────────────────────────────────────────────

export interface UpcomingPick {
  overall: number;
  round: number;
  slot: number;
  owner: string;
  /** A keeper or a pick already made fills this slot; nobody is on the clock for it. */
  fixed: boolean;
  /** True for the person's own slots. */
  mine: boolean;
}

/** The slots from `fromOverall` on, in draft order. */
export function upcomingPicks(
  slots: readonly MockSlot[],
  fromOverall: number,
  person: string,
  limit = 20,
): UpcomingPick[] {
  return slots
    .filter((slot) => slot.pick.overall >= fromOverall)
    .slice(0, limit)
    .map((slot) => ({
      overall: slot.pick.overall,
      round: slot.pick.round,
      slot: slot.pick.slot,
      owner: slot.pick.currentOwner,
      fixed: slot.keeper !== null || slot.made !== null,
      mine: slot.pick.currentOwner === person,
    }));
}

/**
 * Picks the room makes before the person is on the clock again: live slots
 * between `fromOverall` (included) and the person's next live slot. Null when
 * the person has no live slot left.
 */
export function picksUntilTurn(slots: readonly MockSlot[], fromOverall: number, person: string): number | null {
  let count = 0;
  for (const slot of slots) {
    if (slot.pick.overall < fromOverall) continue;
    const live = slot.keeper === null && slot.made === null;
    if (!live) continue;
    if (slot.pick.currentOwner === person) return count;
    count += 1;
  }
  return null;
}

// ─── Your roster by slot ────────────────────────────────────────────────────

export type RosterSlotName = StarterSlot | 'BE';

export interface RosterSlotFill {
  slot: RosterSlotName;
  playerKey: string | null;
}

/**
 * The person's roster laid out the way a draft room shows it: C, PF, SF, SG,
 * PG, F, G, FLEX, FLEX, FLEX, then the bench. Players go in draft order, each
 * into the first open starting slot he can fill, else the bench. A display,
 * not the lineup maths; the mock's own matching still decides needs.
 */
export function rosterBySlot(
  players: readonly { playerKey: string; positions: readonly Position[] }[],
  roster: RosterSettings,
): RosterSlotFill[] {
  const fills: RosterSlotFill[] = STARTER_SLOTS.flatMap((slot) =>
    Array.from({ length: roster.starters[slot] ?? 0 }, () => ({ slot: slot as RosterSlotName, playerKey: null as string | null })));
  const bench: RosterSlotFill[] = Array.from({ length: roster.bench }, () => ({ slot: 'BE' as const, playerKey: null }));
  for (const player of players) {
    const open = fills.find((fill) => fill.playerKey === null && fillsSlot(player.positions, fill.slot as StarterSlot));
    if (open) {
      open.playerKey = player.playerKey;
      continue;
    }
    const seat = bench.find((fill) => fill.playerKey === null);
    if (seat) seat.playerKey = player.playerKey;
    else bench.push({ slot: 'BE', playerKey: player.playerKey });
  }
  return [...fills, ...bench];
}

// ─── The queue ──────────────────────────────────────────────────────────────

export function toggleQueued(queue: readonly string[], key: string): string[] {
  return queue.includes(key) ? queue.filter((entry) => entry !== key) : [...queue, key];
}

/** Move one entry up (-1) or down (+1). Out of range does nothing. */
export function moveQueued(queue: readonly string[], key: string, by: -1 | 1): string[] {
  const from = queue.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= queue.length) return [...queue];
  const next = [...queue];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** The first queued player still on the board, else the best value left. */
export function queuedPick(queue: readonly string[], available: readonly MockCandidate[]): MockCandidate | null {
  const open = new Map(available.map((candidate) => [candidate.playerKey, candidate]));
  for (const key of queue) {
    const candidate = open.get(key);
    if (candidate) return candidate;
  }
  return available[0] ?? null;
}

// ─── The grid ───────────────────────────────────────────────────────────────

export interface GridCell {
  overall: number;
  round: number;
  slot: number;
  owner: string;
  /** Who held the pick at the start, when it was traded. */
  via: string | null;
  pick: MockPick | null;
  /** The pick on the clock now. */
  current: boolean;
}

export interface DraftGrid {
  /** Teams in first-round order, left to right. */
  owners: string[];
  rounds: GridCell[][];
}

/**
 * Rounds by teams. Columns follow the first round's order, so a snake draft
 * reads right to left on even rounds, the way a draft board does. A traded
 * pick sits in its original team's column and names who holds it.
 */
export function draftGrid(slots: readonly MockSlot[], picks: readonly MockPick[], currentOverall: number | null): DraftGrid {
  const firstRound = slots.filter((slot) => slot.pick.round === 1).sort((a, b) => a.pick.slot - b.pick.slot);
  const owners = firstRound.map((slot) => slot.pick.originalOwner ?? slot.pick.currentOwner);
  const byOverall = new Map(picks.map((pick) => [pick.overall, pick]));
  const rounds = new Map<number, GridCell[]>();
  for (const slot of slots) {
    const original = slot.pick.originalOwner ?? slot.pick.currentOwner;
    const column = owners.indexOf(original);
    const row = rounds.get(slot.pick.round) ?? Array.from({ length: owners.length }, () => null as unknown as GridCell);
    const cell: GridCell = {
      overall: slot.pick.overall,
      round: slot.pick.round,
      slot: slot.pick.slot,
      owner: slot.pick.currentOwner,
      via: slot.pick.currentOwner !== original ? original : null,
      pick: byOverall.get(slot.pick.overall) ?? null,
      current: slot.pick.overall === currentOverall,
    };
    if (column >= 0) row[column] = cell;
    rounds.set(slot.pick.round, row);
  }
  return {
    owners,
    rounds: [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row.filter(Boolean)),
  };
}

// ─── Saving a draft ─────────────────────────────────────────────────────────

/** Everything a person needs to come back to the draft they left. */
export interface MockSave {
  version: 1;
  seed: number;
  mode: MockMode;
  started: boolean;
  choices: Record<number, string>;
  queue: string[];
  /** Seconds left on the person's clock when they left, if it was running. */
  clockLeft: number | null;
  /** The what-if switches that shape the board. */
  tradesOn: string[];
  tryKeepers: boolean;
  tryPicks: [string, string];
  useEntered: boolean;
  guessInstead: string[];
}

export function mockSaveKey(owner: string): string {
  return `nerds.mock.${owner}`;
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** Read a save back, or null when it is missing or not one of ours. */
export function parseMockSave(raw: string | null): MockSave | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const save = value as Record<string, unknown>;
  if (save.version !== 1) return null;
  if (typeof save.seed !== 'number' || !Number.isFinite(save.seed)) return null;
  if (save.mode !== 'sharp' && save.mode !== 'realistic') return null;
  const choices: Record<number, string> = {};
  if (typeof save.choices === 'object' && save.choices !== null) {
    for (const [overall, key] of Object.entries(save.choices as Record<string, unknown>)) {
      const number = Number(overall);
      if (Number.isInteger(number) && number > 0 && typeof key === 'string') choices[number] = key;
    }
  }
  const tryPicks = isStringList(save.tryPicks) && save.tryPicks.length === 2 ? [save.tryPicks[0], save.tryPicks[1]] as [string, string] : ['', ''] as [string, string];
  return {
    version: 1,
    seed: save.seed,
    mode: save.mode,
    started: save.started === true,
    choices,
    queue: isStringList(save.queue) ? save.queue : [],
    clockLeft: typeof save.clockLeft === 'number' && save.clockLeft >= 0 ? save.clockLeft : null,
    tradesOn: isStringList(save.tradesOn) ? save.tradesOn : [],
    tryKeepers: save.tryKeepers === true,
    tryPicks,
    useEntered: save.useEntered !== false,
    guessInstead: isStringList(save.guessInstead) ? save.guessInstead : [],
  };
}

/**
 * Replay the saved choices against today's board. A keeper set or a trade can
 * change after the save, and a saved choice can then name a player who is
 * already gone. Rather than lose the whole draft, drop choices from the end
 * until the rest replay, and say how many went.
 */
export function replaySaved(
  prepared: PreparedMock,
  seed: number,
  person: string,
  choices: LiveChoices,
): { live: LiveState; choices: Record<number, string>; dropped: number } {
  const kept: Record<number, string> = { ...choices };
  const order = Object.keys(kept).map(Number).sort((a, b) => a - b);
  let dropped = 0;
  for (;;) {
    try {
      return { live: replayLive(prepared, seed, person, kept), choices: kept, dropped };
    } catch {
      const last = order.pop();
      if (last === undefined) throw new Error('The mock draft cannot be replayed');
      delete kept[last];
      dropped += 1;
    }
  }
}

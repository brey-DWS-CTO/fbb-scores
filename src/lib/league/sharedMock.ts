/**
 * A mock draft with a friend: two people at one table, or more, and the rest
 * of the room computer teams. The room lives on the server so every phone
 * sees the same draft: who was asked, who has sat down, the board frozen as
 * the draft starts, the people's picks by pick number, and whose clock runs.
 *
 * The draft itself is still the replay in `liveMock.ts`: same seed, same
 * choices, same draft on every phone. The server never replays it. It only
 * needs the board, the people and their choices to say whose pick is on the
 * clock, because the computer teams pick at once between the people's picks.
 *
 * Pure. No server, no browser. The time is passed in.
 */
import type { LeagueDataset, LeagueDynamicState } from '../keeper/types.js';
import type { TeamScore } from './mockGrade.js';
import {
  boardFromKeeperSets,
  type MockBoard,
  type MockKeeperSets,
  type MockMode,
  type MockSlot,
} from './mockDraft.js';

/** Seconds on the clock at each person's pick, the same as a mock alone. */
export const SHARED_PICK_SECONDS = 120;
/**
 * Seconds past the deadline before anyone but the person on the clock may
 * run it out. Their own phone, which knows their queue, gets the first go.
 */
export const SHARED_GRACE_SECONDS = 5;
/** Most people at one table. The screen offers one friend; the room allows more. */
export const MAX_PEOPLE = 4;

export interface SharedClock {
  overall: number;
  /** When the clock started, server time. */
  startedAt: string;
}

export interface SharedMockRoom {
  id: string;
  season: number;
  host: string;
  /**
   * An open room: anyone in the league may sit down while it waits, and the
   * host starts it when ready. Otherwise the people were asked by name and
   * the draft starts when the last of them sits down.
   */
  open?: boolean;
  /** Everyone at the table, the host first. In an open room, everyone who has sat down. */
  people: string[];
  /** Who has sat down. The host is in from the start. */
  joined: string[];
  mode: MockMode;
  seed: number;
  createdAt: string;
  startedAt: string | null;
  /** The board, frozen as the draft starts, so every phone replays the same draft. */
  board: MockBoard | null;
  /** The people's picks, by overall pick. The computer teams are replayed from the seed. */
  choices: Record<number, string>;
  /** Picks the clock made rather than the person. */
  auto: number[];
  clock: SharedClock | null;
  finishedAt: string | null;
  /** Somebody quit, which ends it for everyone. */
  endedAt: string | null;
  endedBy: string | null;
  /** Who has cleared a finished or ended mock off their mock page. */
  dismissed: string[];
}

export type SharedMockPhase = 'waiting' | 'live' | 'finished' | 'ended';

export function sharedMockPhase(room: Pick<SharedMockRoom, 'startedAt' | 'finishedAt' | 'endedAt'>): SharedMockPhase {
  if (room.endedAt) return 'ended';
  if (room.finishedAt) return 'finished';
  if (room.startedAt) return 'live';
  return 'waiting';
}

/** A short id that is safe in a link. */
export function sharedMockId(at: string, random: number): string {
  const stamp = Math.max(0, Date.parse(at) || 0).toString(36);
  const salt = Math.floor(Math.min(0.999999, Math.max(0, random)) * 36 ** 4).toString(36).padStart(4, '0');
  return `with-${stamp}-${salt}`;
}

export interface NewSharedMockInput {
  id: string;
  season: number;
  host: string;
  guests: readonly string[];
  mode: MockMode;
  at: string;
}

/** A room waiting for its guests. The host has the first seat. */
export function newSharedMock(input: NewSharedMockInput): SharedMockRoom {
  const guests = [...new Set(input.guests)].filter((owner) => owner !== input.host);
  if (guests.length === 0) throw new Error('Pick somebody to draft with.');
  if (guests.length + 1 > MAX_PEOPLE) throw new Error(`Up to ${MAX_PEOPLE} people can share a mock.`);
  return {
    id: input.id,
    season: input.season,
    host: input.host,
    people: [input.host, ...guests],
    joined: [input.host],
    mode: input.mode,
    seed: 0,
    createdAt: input.at,
    startedAt: null,
    board: null,
    choices: {},
    auto: [],
    clock: null,
    finishedAt: null,
    endedAt: null,
    endedBy: null,
    dismissed: [],
  };
}

/** A room anyone may join. The host has the first seat and starts it when ready. */
export function openSharedMock(input: Omit<NewSharedMockInput, 'guests'>): SharedMockRoom {
  return {
    ...newSharedMock({ ...input, guests: ['\u0000'] }),
    open: true,
    people: [input.host],
    joined: [input.host],
  };
}

/** The other people at the table, from one person's seat. */
export function othersAt(room: Pick<SharedMockRoom, 'people'>, viewer: string): string[] {
  return room.people.filter((owner) => owner !== viewer);
}

/** "Kyle", or "Kyle and Amy". */
export function namesOf(people: readonly string[]): string {
  if (people.length <= 1) return people[0] ?? '';
  return `${people.slice(0, -1).join(', ')} and ${people[people.length - 1]}`;
}

const copy = (selections: readonly { playerKey: string; playerName: string }[] | undefined) =>
  (selections ?? []).map((selection) => ({ ...selection }));

/**
 * Whose keepers go on a shared board: only the ones everyone at the table
 * can see. After the reveal, everyone's real ones. Before it, the people at
 * the table show each other their real keepers, which they agreed to by
 * sitting down, and every other team's picks stay live. Nobody's
 * projections go on, since each person projects the room differently and
 * one person's guesses would tilt the draft for the rest. No other team's
 * real keepers are read, so none can leak.
 */
export function sharedMockKeepers(
  dataset: Pick<LeagueDataset, 'teams'>,
  state: Pick<LeagueDynamicState, 'keepers' | 'keepersRevealed'>,
  people: readonly string[],
): MockKeeperSets {
  const revealed = state.keepersRevealed === true;
  const keepers: MockKeeperSets['keepers'] = {};
  const status: MockKeeperSets['status'] = {};
  for (const team of dataset.teams) {
    const owner = team.owner;
    const seen = revealed || people.includes(owner);
    keepers[owner] = seen ? copy(state.keepers[owner]) : [];
    status[owner] = seen ? 'known' : 'assumed';
  }
  return { keepers, status };
}

/** The board a shared mock starts from. */
export function sharedMockBoard(
  dataset: LeagueDataset,
  state: LeagueDynamicState,
  people: readonly string[],
): MockBoard {
  return boardFromKeeperSets(dataset, state, sharedMockKeepers(dataset, state, people));
}

/** The first of the people's live picks without a choice, in draft order, or null once they are all made. */
export function nextPersonSlot(
  board: Pick<MockBoard, 'slots'>,
  people: readonly string[],
  choices: Readonly<Record<number, string>>,
): MockSlot | null {
  return board.slots.find((slot) =>
    !slot.keeper && !slot.made && people.includes(slot.pick.currentOwner) && choices[slot.pick.overall] === undefined) ?? null;
}

function slotOwner(board: Pick<MockBoard, 'slots'>, overall: number): string | null {
  return board.slots.find((slot) => slot.pick.overall === overall)?.pick.currentOwner ?? null;
}

/** The draft starts: the board is frozen and the first person's clock runs. */
export function startSharedMock(room: SharedMockRoom, board: MockBoard, seed: number, at: string): SharedMockRoom {
  const next = nextPersonSlot(board, room.people, {});
  return {
    ...room,
    startedAt: at,
    board,
    seed,
    choices: {},
    auto: [],
    clock: next ? { overall: next.pick.overall, startedAt: at } : null,
    finishedAt: next ? null : at,
  };
}

/**
 * Take a seat. In a room where people were asked by name, the draft starts
 * when the last of them sits down, on the board `start` builds. Building one
 * reads the league, so the caller brings it. In an open room sitting down
 * only adds a seat; the host starts it.
 */
export function joinSharedMock(
  room: SharedMockRoom,
  who: string,
  at: string,
  start: () => { board: MockBoard; seed: number },
): SharedMockRoom {
  const phase = sharedMockPhase(room);
  if (phase === 'ended') throw new Error('This mock is over.');
  if (room.open) {
    if (room.people.includes(who)) return room;
    if (phase !== 'waiting') throw new Error('This mock has started.');
    if (room.people.length >= MAX_PEOPLE) throw new Error(`The room is full: ${MAX_PEOPLE} seats.`);
    return { ...room, people: [...room.people, who], joined: [...room.joined, who] };
  }
  if (!room.people.includes(who)) throw new Error('You were not asked to this mock.');
  if (room.joined.includes(who)) return room;
  const joined = [...room.joined, who];
  const seated = { ...room, joined };
  if (!room.people.every((person) => joined.includes(person))) return seated;
  const { board, seed } = start();
  return startSharedMock(seated, board, seed, at);
}

/** The host starts an open room, once somebody else is in it. */
export function startOpenSharedMock(
  room: SharedMockRoom,
  by: string,
  at: string,
  start: () => { board: MockBoard; seed: number },
): SharedMockRoom {
  const phase = sharedMockPhase(room);
  if (phase === 'ended') throw new Error('This mock is over.');
  if (phase !== 'waiting') throw new Error('This mock has started.');
  if (!room.open) throw new Error('This mock starts when everyone asked has sat down.');
  if (by !== room.host) throw new Error(`Only ${room.host} can start it.`);
  if (room.people.length < 2) throw new Error('Wait for somebody to join first.');
  const { board, seed } = start();
  return startSharedMock(room, board, seed, at);
}

/** When the clock on a pick runs out, in milliseconds since the epoch. */
export function clockDeadlineMs(clock: SharedClock, seconds = SHARED_PICK_SECONDS): number {
  return Date.parse(clock.startedAt) + seconds * 1000;
}

/**
 * Whether `by` may run the clock out at `nowMs`: the person on the clock the
 * moment it hits zero, anyone else at the table a few seconds later.
 */
export function clockHasRunOut(room: SharedMockRoom, by: string, nowMs: number): boolean {
  if (!room.clock || !room.board) return false;
  const grace = slotOwner(room.board, room.clock.overall) === by ? 0 : SHARED_GRACE_SECONDS * 1000;
  return nowMs >= clockDeadlineMs(room.clock) + grace;
}

export type SharedPickHow = 'pick' | 'auto';

/** One person's pick lands, or the clock makes it. Throws in plain words when it may not. */
export function pickInSharedMock(
  room: SharedMockRoom,
  by: string,
  overall: number,
  playerKey: string,
  at: string,
  how: SharedPickHow,
): SharedMockRoom {
  const phase = sharedMockPhase(room);
  if (phase !== 'live' || !room.board || !room.clock) {
    throw new Error(phase === 'finished' ? 'This mock is finished.' : phase === 'ended' ? 'This mock is over.' : 'This mock has not started.');
  }
  if (!room.joined.includes(by)) throw new Error('You are not in this mock.');
  if (room.clock.overall !== overall) throw new Error('That pick is not on the clock.');
  const owner = slotOwner(room.board, overall);
  if (owner === null) throw new Error('No such pick.');
  if (how === 'pick' && owner !== by) throw new Error(`It is ${owner}'s pick, not yours.`);
  if (room.board.taken.includes(playerKey) || Object.values(room.choices).includes(playerKey)) {
    throw new Error('He is already gone.');
  }
  const choices = { ...room.choices, [overall]: playerKey };
  const next = nextPersonSlot(room.board, room.people, choices);
  return {
    ...room,
    choices,
    auto: how === 'auto' ? [...room.auto, overall] : room.auto,
    clock: next ? { overall: next.pick.overall, startedAt: at } : null,
    finishedAt: next ? null : at,
  };
}

/**
 * Leave. A draft under way ends for everyone, and so does a waiting room
 * when its host leaves. Anyone else leaving an open room that is still
 * waiting just gives up their seat. A finished or ended one only leaves
 * this person's mock page.
 */
export function quitSharedMock(room: SharedMockRoom, by: string, at: string): SharedMockRoom {
  if (!room.people.includes(by)) throw new Error('You are not in this mock.');
  const dismissed = room.dismissed.includes(by) ? room.dismissed : [...room.dismissed, by];
  const phase = sharedMockPhase(room);
  if (phase === 'finished' || phase === 'ended') return { ...room, dismissed };
  if (room.open && phase === 'waiting' && by !== room.host) {
    return {
      ...room,
      people: room.people.filter((person) => person !== by),
      joined: room.joined.filter((person) => person !== by),
    };
  }
  return { ...room, endedAt: at, endedBy: by, clock: null, dismissed };
}

/** Whether a waiting open room has a seat for this person. */
export function canJoinOpenRoom(room: SharedMockRoom, who: string): boolean {
  return room.open === true && sharedMockPhase(room) === 'waiting' && !room.people.includes(who) && room.people.length < MAX_PEOPLE;
}

/** Whether a room still gets a line on this person's mock page. */
export function showsFor(room: Pick<SharedMockRoom, 'people' | 'dismissed'>, viewer: string): boolean {
  return room.people.includes(viewer) && !room.dismissed.includes(viewer);
}

/** Whose pick is on the clock, or null between picks and after the draft. */
export function onTheClock(room: Pick<SharedMockRoom, 'board' | 'clock'>): string | null {
  return room.board && room.clock ? slotOwner(room.board, room.clock.overall) : null;
}

const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`);

/** "You beat Kyle: 3rd to his 6th." One sentence per other person. */
export function headToHead(standings: readonly TeamScore[], person: string, others: readonly string[]): string {
  const rankOf = (owner: string) => standings.find((team) => team.owner === owner)?.rank ?? null;
  const mine = rankOf(person);
  if (mine === null) return '';
  return others.map((other) => {
    const theirs = rankOf(other);
    if (theirs === null) return `${other} has no team here.`;
    if (mine < theirs) return `You beat ${other}: ${ordinal(mine)} to his ${ordinal(theirs)}.`;
    if (mine > theirs) return `${other} beat you: ${ordinal(theirs)} to your ${ordinal(mine)}.`;
    return `You and ${other} tied at ${ordinal(mine)}.`;
  }).join(' ');
}

const isNameList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 40);
const isoOrNull = (value: unknown): string | null => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

/** A room read back from the store, checked, or null when it is not one. */
export function parseSharedMockRoom(value: unknown): SharedMockRoom | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.host !== 'string' || typeof raw.season !== 'number') return null;
  if (!isNameList(raw.people) || !isNameList(raw.joined)) return null;
  if (raw.mode !== 'sharp' && raw.mode !== 'realistic') return null;
  const choices: Record<number, string> = {};
  if (typeof raw.choices === 'object' && raw.choices !== null) {
    for (const [overall, key] of Object.entries(raw.choices as Record<string, unknown>)) {
      const number = Number(overall);
      if (Number.isInteger(number) && number > 0 && typeof key === 'string') choices[number] = key;
    }
  }
  const clock = raw.clock as Partial<SharedClock> | null | undefined;
  const board = raw.board as MockBoard | null | undefined;
  return {
    id: raw.id,
    season: raw.season,
    host: raw.host,
    ...(raw.open === true ? { open: true } : {}),
    people: raw.people,
    joined: raw.joined,
    mode: raw.mode,
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed : 0,
    createdAt: isoOrNull(raw.createdAt) ?? new Date(0).toISOString(),
    startedAt: isoOrNull(raw.startedAt),
    board: board && Array.isArray(board.slots) && Array.isArray(board.taken) ? board : null,
    choices,
    auto: Array.isArray(raw.auto) ? raw.auto.filter((entry): entry is number => typeof entry === 'number') : [],
    clock: clock && typeof clock.overall === 'number' && typeof clock.startedAt === 'string'
      ? { overall: clock.overall, startedAt: clock.startedAt }
      : null,
    finishedAt: isoOrNull(raw.finishedAt),
    endedAt: isoOrNull(raw.endedAt),
    endedBy: typeof raw.endedBy === 'string' ? raw.endedBy : null,
    dismissed: isNameList(raw.dismissed) ? raw.dismissed : [],
  };
}

/**
 * Grading a finished mock draft.
 *
 * A team is scored on the projected season points of its best starting
 * lineup: the ten starting slots (PG, SG, SF, PF, C, G, F and three FLEX),
 * filled from the roster best season total first. That is the number a
 * draft is trying to win. Every team in the mock is scored the same way, the
 * person is ranked among them, and the rank sets the grade.
 *
 * Also picked out: the person's best value (the player who fell furthest
 * past his ADP) and biggest reach (taken furthest ahead of it), and any
 * starting slot the roster cannot fill.
 *
 * Pure. No server, no browser.
 */
import { fillsSlot, type Position, type RosterSettings, type StarterSlot } from './draftValue.js';
import { ROSTER_ORDER } from './draftRoom.js';
import type { MockMode, MockPick } from './mockDraft.js';

/** What grading needs to know about one player. */
export interface GradePlayer {
  name: string;
  positions: readonly Position[];
  /** Projected season points in league scoring, or null when unknown. */
  total: number | null;
  /** Average draft position, when it means something. */
  adp: number | null;
}

export interface GradedPick {
  label: string;
  overall: number;
  playerKey: string;
  name: string;
  positions: Position[];
  total: number | null;
  /** Starting slot in the best lineup, or 'BE'. */
  slot: StarterSlot | 'BE';
  how: MockPick['how'];
}

export interface TeamScore {
  owner: string;
  /** Projected season points of the best starting lineup. */
  points: number;
  rank: number;
}

export interface MockGrade {
  grade: string;
  rank: number;
  teams: number;
  points: number;
  /** The other teams' average, for scale. */
  average: number;
  standings: TeamScore[];
  roster: GradedPick[];
  openSlots: StarterSlot[];
  /** The person's pick who came furthest past his ADP. */
  steal: { name: string; label: string; by: number } | null;
  /** Taken furthest ahead of his ADP. */
  reach: { name: string; label: string; by: number } | null;
}

/** Grades by finish among ten teams: first is A+, last is F. */
const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'] as const;

export function gradeForRank(rank: number, teams: number): string {
  if (teams <= 1) return GRADES[0];
  // Spread the ten grades over however many teams there are.
  const index = Math.round(((rank - 1) / (teams - 1)) * (GRADES.length - 1));
  return GRADES[Math.min(GRADES.length - 1, Math.max(0, index))];
}

interface Seat {
  playerKey: string;
  slot: StarterSlot | 'BE';
}

/** Best season total first, each into the first open starting slot he fits. */
export function bestLineup(
  keys: readonly string[],
  players: ReadonlyMap<string, GradePlayer>,
  roster: Pick<RosterSettings, 'starters'>,
): { seats: Seat[]; points: number; open: StarterSlot[] } {
  const open: StarterSlot[] = ROSTER_ORDER.flatMap((slot) => Array.from({ length: roster.starters[slot] ?? 0 }, () => slot));
  const filled = open.map(() => false);
  const ordered = [...keys].sort((a, b) => (players.get(b)?.total ?? 0) - (players.get(a)?.total ?? 0));
  const seats: Seat[] = [];
  let points = 0;
  for (const key of ordered) {
    const player = players.get(key);
    const index = open.findIndex((slot, at) => !filled[at] && fillsSlot(player?.positions ?? [], slot));
    if (index >= 0) {
      filled[index] = true;
      points += player?.total ?? 0;
      seats.push({ playerKey: key, slot: open[index] });
    } else {
      seats.push({ playerKey: key, slot: 'BE' });
    }
  }
  return { seats, points: Math.round(points), open: open.filter((_, at) => !filled[at]) };
}

export function gradeMock(
  picks: readonly MockPick[],
  person: string,
  players: ReadonlyMap<string, GradePlayer>,
  roster: Pick<RosterSettings, 'starters'>,
): MockGrade {
  const byOwner = new Map<string, MockPick[]>();
  for (const pick of picks) {
    if (!pick.playerKey) continue;
    const list = byOwner.get(pick.owner) ?? [];
    list.push(pick);
    byOwner.set(pick.owner, list);
  }
  const scored = [...byOwner.entries()].map(([owner, list]) => ({
    owner,
    list,
    lineup: bestLineup(list.map((pick) => pick.playerKey!), players, roster),
  }));
  scored.sort((a, b) => b.lineup.points - a.lineup.points || a.owner.localeCompare(b.owner));
  const standings: TeamScore[] = scored.map((team, index) => ({ owner: team.owner, points: team.lineup.points, rank: index + 1 }));

  const mine = scored.find((team) => team.owner === person);
  const rank = standings.find((team) => team.owner === person)?.rank ?? standings.length;
  const others = standings.filter((team) => team.owner !== person);
  const average = others.length > 0 ? Math.round(others.reduce((sum, team) => sum + team.points, 0) / others.length) : 0;

  const seatOf = new Map((mine?.lineup.seats ?? []).map((seat) => [seat.playerKey, seat.slot]));
  const myRoster: GradedPick[] = (mine?.list ?? []).map((pick) => ({
    label: pick.label,
    overall: pick.overall,
    playerKey: pick.playerKey!,
    name: players.get(pick.playerKey!)?.name ?? pick.playerName ?? pick.playerKey!,
    positions: [...pick.positions],
    total: players.get(pick.playerKey!)?.total ?? null,
    slot: seatOf.get(pick.playerKey!) ?? 'BE',
    how: pick.how,
  }));

  // Only real picks count for value against ADP; keepers were never on offer.
  let steal: MockGrade['steal'] = null;
  let reach: MockGrade['reach'] = null;
  for (const pick of mine?.list ?? []) {
    if (pick.how !== 'pick') continue;
    const adp = players.get(pick.playerKey!)?.adp;
    if (adp === null || adp === undefined) continue;
    const gap = Math.round(pick.overall - adp);
    const name = players.get(pick.playerKey!)?.name ?? pick.playerName ?? '';
    if (gap > 0 && (!steal || gap > steal.by)) steal = { name, label: pick.label, by: gap };
    if (gap < 0 && (!reach || -gap > reach.by)) reach = { name, label: pick.label, by: -gap };
  }

  return {
    grade: gradeForRank(rank, standings.length),
    rank,
    teams: standings.length,
    points: mine?.lineup.points ?? 0,
    average,
    standings,
    roster: myRoster,
    openSlots: mine?.lineup.open ?? [],
    steal,
    reach,
  };
}

const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? `${n}st` : n % 10 === 2 && n % 100 !== 12 ? `${n}nd` : n % 10 === 3 && n % 100 !== 13 ? `${n}rd` : `${n}th`);

/** One line on how the draft went, in plain words. */
export function gradeSummary(grade: MockGrade): string {
  const gap = grade.points - grade.average;
  const versus = gap === 0 ? 'right at' : `${Math.abs(gap).toLocaleString()} ${gap > 0 ? 'above' : 'below'}`;
  return `${ordinal(grade.rank)} of ${grade.teams}: ${grade.points.toLocaleString()} projected points from your best ten, ${versus} the room's average.`;
}

// ─── The saved record ───────────────────────────────────────────────────────

export interface MockResultRecord {
  /** Stable per draft, so the same finished draft is never saved twice. */
  id: string;
  owner: string;
  finishedAt: string;
  seed: number;
  mode: MockMode;
  grade: MockGrade;
}

/** Commissioner keeps every mock; everyone else keeps their latest ten. */
export const MEMBER_MOCK_LIMIT = 10;

/** A short, stable id for one finished draft: same seed, room and picks, same id. */
export function mockResultId(owner: string, seed: number, mode: MockMode, choices: Readonly<Record<number, string>>): string {
  const text = `${owner}|${seed}|${mode}|${Object.keys(choices).map(Number).sort((a, b) => a - b).map((key) => `${key}:${choices[key]}`).join(',')}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mock-${(hash >>> 0).toString(36)}-${seed}`;
}

/** Check a record a client sent before storing it. Throws in plain words. */
export function parseMockResult(owner: string, body: unknown): MockResultRecord {
  if (typeof body !== 'object' || body === null) throw new Error('Send the result as an object.');
  const value = body as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^mock-[a-z0-9]+-\d+$/.test(value.id)) throw new Error('The result needs its id.');
  if (typeof value.seed !== 'number' || !Number.isFinite(value.seed)) throw new Error('The result needs its seed.');
  if (value.mode !== 'sharp' && value.mode !== 'realistic') throw new Error('The result needs its room.');
  const grade = value.grade as MockGrade | undefined;
  if (!grade || typeof grade.grade !== 'string' || !Array.isArray(grade.roster) || !Array.isArray(grade.standings)) {
    throw new Error('The result needs its grade.');
  }
  if (JSON.stringify(grade).length > 20_000) throw new Error('That result is too large.');
  return {
    id: value.id,
    owner,
    finishedAt: new Date().toISOString(),
    seed: value.seed,
    mode: value.mode,
    grade,
  };
}

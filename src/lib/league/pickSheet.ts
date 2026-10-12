/**
 * The live draft picker's list: how it is sorted and filtered, and which
 * numbers the commissioner sees next to each name. Pure, so the sheet and
 * the tests agree without a browser.
 *
 * Everyone sorts by name, NBA team or position. Only the commissioner sees
 * projections, and only he can sort by them. The wall board shows none.
 */
import type { DatasetPlayer } from '../keeper/types.js';

export const PLAYER_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type PlayerPosition = (typeof PLAYER_POSITIONS)[number];
export type PositionFilter = 'ALL' | PlayerPosition;

/** Sorts anyone may use. */
export const MEMBER_SORTS = ['name', 'team', 'position'] as const;
/** Sorts only the commissioner may use, on numbers only he sees. */
export const COMMISH_SORTS = ['fppg', 'total', 'adp', 'gone'] as const;
export type PickSort = (typeof MEMBER_SORTS)[number] | (typeof COMMISH_SORTS)[number];

export const SORT_LABELS: Record<PickSort, string> = {
  name: 'NAME',
  team: 'TEAM',
  position: 'POS',
  fppg: 'FPPG',
  total: 'TOTAL',
  adp: 'ADP',
  gone: 'GONE',
};

/** The numbers the commissioner sees beside a player. Members never get these. */
export interface PickNumbers {
  /** Projected fantasy points per game in our scoring. */
  fppg: number | null;
  /** Projected points for the season: FPPG times the games ESPN projects. */
  total: number | null;
  /** ESPN's average draft position. */
  adp: number | null;
  /** Place on our value board. */
  rank: number | null;
  /** His NBA team's games in our play-in weeks. */
  playIn: number | null;
  /** His NBA team's games in our playoff weeks. */
  playoff: number | null;
  /** Share of simulated drafts in which he is gone before the commissioner's next pick. */
  gone: number | null;
}

export type PickNumbersByKey = ReadonlyMap<string, PickNumbers>;

/** Which sorts this viewer may pick from. */
export function sortsFor(isCommissioner: boolean): readonly PickSort[] {
  return isCommissioner ? [...MEMBER_SORTS, ...COMMISH_SORTS] : MEMBER_SORTS;
}

/** A sort the viewer may not use falls back to name. */
export function allowedSort(sort: PickSort, isCommissioner: boolean): PickSort {
  return sortsFor(isCommissioner).includes(sort) ? sort : 'name';
}

export function displayName(player: Pick<DatasetPlayer, 'name' | 'fullName'>): string {
  return player.fullName ?? player.name;
}

const byName = (a: DatasetPlayer, b: DatasetPlayer) =>
  displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key);

function positionIndex(player: Pick<DatasetPlayer, 'positions'>): number {
  const first = player.positions[0];
  const index = first ? (PLAYER_POSITIONS as readonly string[]).indexOf(first) : -1;
  return index === -1 ? PLAYER_POSITIONS.length : index;
}

/** Bigger first, nulls last. */
function numberDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Smaller first, nulls last. */
function numberAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Sort the picker's list. Name is the tie-break for every other sort so the
 * order never shifts between polls.
 */
export function sortPool(
  players: readonly DatasetPlayer[],
  sort: PickSort,
  numbers?: PickNumbersByKey | null,
): DatasetPlayer[] {
  const rows = [...players];
  const of = (player: DatasetPlayer) => numbers?.get(player.key) ?? null;
  switch (sort) {
    case 'name':
      return rows.sort(byName);
    case 'team':
      return rows.sort((a, b) => a.proTeam.localeCompare(b.proTeam, 'en', { sensitivity: 'base' }) || byName(a, b));
    case 'position':
      return rows.sort((a, b) => positionIndex(a) - positionIndex(b) || byName(a, b));
    case 'fppg':
      return rows.sort((a, b) => numberDesc(of(a)?.fppg ?? null, of(b)?.fppg ?? null) || byName(a, b));
    case 'total':
      return rows.sort((a, b) => numberDesc(of(a)?.total ?? null, of(b)?.total ?? null) || byName(a, b));
    case 'adp':
      return rows.sort((a, b) => numberAsc(of(a)?.adp ?? null, of(b)?.adp ?? null) || byName(a, b));
    case 'gone':
      return rows.sort((a, b) => numberDesc(of(a)?.gone ?? null, of(b)?.gone ?? null) || byName(a, b));
  }
}

/** Position chip first, then the search box over name, team and positions. */
export function filterPool(
  players: readonly DatasetPlayer[],
  input: { query: string; position: PositionFilter },
): DatasetPlayer[] {
  const q = input.query.trim().toLocaleLowerCase();
  return players
    .filter((player) => input.position === 'ALL' || player.positions.includes(input.position))
    .filter((player) => {
      if (!q) return true;
      return [player.name, player.fullName ?? '', player.proTeam, ...player.positions]
        .some((value) => value.toLocaleLowerCase().includes(q));
    });
}

/** A number for the picker row, or a dash. */
export function pickNumber(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? '–' : value.toFixed(digits);
}

/** A share as a whole percent, or a dash. */
export function pickPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`;
}

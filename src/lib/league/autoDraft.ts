/**
 * Auto pick from a private list.
 *
 * A member who cannot be at the draft types a list of names, best first, and
 * saves it. Nobody else can read it, the commissioner included. When the
 * commissioner puts that team on auto, each of its picks takes the first name
 * on the list still available. A list that runs dry, or a team with no list,
 * takes the best player left on the board's own order.
 *
 * Pure. No server, no browser. The server stores lists and runs the picks;
 * the screens only show what this file decides.
 */
import type { DatasetPlayer, LeagueDynamicState } from '../keeper/types.js';

/** The most names one list may hold. A draft is 13 rounds for 10 teams. */
export const DRAFT_LIST_MAX = 300;
/** The most text one save may carry, so a pasted spreadsheet cannot flood the store. */
export const DRAFT_LIST_MAX_CHARS = 20_000;

export interface DraftListEntry {
  /** 1-based position on the list. */
  rank: number;
  /** The name as typed. */
  name: string;
  /** The pool player this line matched, or null when nobody did. */
  playerKey: string | null;
  /** How the pool spells him, for the member's own check. */
  playerName: string | null;
}

export interface DraftList {
  entries: DraftListEntry[];
  updatedAt: string;
}

/** A line, less its rank, tabs and trailing cells: `12. Nikola Jokic, DEN` reads Nikola Jokic. */
export function cleanListLine(line: string): string {
  const unranked = line
    .replace(/^\s*[#([]?\s*\d+\s*[.):\]\-–]*\s*/, '')
    .replace(/^\s*[-–•*]\s*/, '');
  const firstCell = unranked.split(/\t|,|;|\|/)[0] ?? '';
  return firstCell.replace(/\s+/g, ' ').trim();
}

/** Lower case, no accents, no punctuation, no suffix: `Jaren Jackson Jr.` reads `jaren jackson`. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The names on a pasted list, in order, one per line. Blank lines go; a name
 * typed twice counts once, where it first appears.
 */
export function parseListText(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.slice(0, DRAFT_LIST_MAX_CHARS).split(/\r?\n/)) {
    const name = cleanListLine(raw);
    if (!name) continue;
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= DRAFT_LIST_MAX) break;
  }
  return names;
}

interface NameIndex {
  full: Map<string, DatasetPlayer[]>;
  short: Map<string, DatasetPlayer[]>;
  last: Map<string, DatasetPlayer[]>;
}

const push = (map: Map<string, DatasetPlayer[]>, key: string, player: DatasetPlayer) => {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(player);
  else map.set(key, [player]);
};

/** The short form the pool shows: `N. Jokic` for Nikola Jokic. */
function shortForm(full: string): string {
  const parts = full.split(' ');
  return parts.length < 2 ? full : `${parts[0][0]} ${parts.slice(1).join(' ')}`;
}

function indexPlayers(players: readonly DatasetPlayer[]): NameIndex {
  const index: NameIndex = { full: new Map(), short: new Map(), last: new Map() };
  for (const player of players) {
    const full = normalizeName(player.fullName ?? player.name);
    push(index.full, full, player);
    push(index.short, normalizeName(player.name), player);
    if (full) push(index.short, shortForm(full), player);
    const parts = full.split(' ');
    if (parts.length > 1) push(index.last, parts[parts.length - 1], player);
  }
  return index;
}

/**
 * The pool player a typed name means, or null when no one does or two could.
 * Full name first, then the pool's short form (`N. Jokic`), then a last name
 * that only one player has, then a last name plus first initial.
 */
export function matchPlayer(name: string, index: NameIndex): DatasetPlayer | null {
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const only = (list: DatasetPlayer[] | undefined) => (list && list.length === 1 ? list[0] : null);
  const exact = only(index.full.get(wanted));
  if (exact) return exact;
  const short = only(index.short.get(wanted));
  if (short) return short;
  const parts = wanted.split(' ');
  const last = parts[parts.length - 1];
  const sameLast = index.last.get(last) ?? [];
  if (parts.length === 1) return only(sameLast);
  const initial = parts[0][0];
  const byInitial = sameLast.filter((player) => normalizeName(player.fullName ?? player.name).startsWith(initial));
  return only(byInitial) ?? only(sameLast);
}

/**
 * A saved list: every typed name, matched to the pool where it can be. A
 * player named twice in different spellings keeps his first line only.
 */
export function buildDraftList(text: string, players: readonly DatasetPlayer[], updatedAt: string): DraftList {
  const index = indexPlayers(players);
  const seen = new Set<string>();
  const entries: DraftListEntry[] = [];
  for (const name of parseListText(text)) {
    const player = matchPlayer(name, index);
    if (player) {
      if (seen.has(player.key)) continue;
      seen.add(player.key);
    }
    entries.push({
      rank: entries.length + 1,
      name,
      playerKey: player?.key ?? null,
      playerName: player ? player.fullName ?? player.name : null,
    });
  }
  return { entries, updatedAt };
}

/** The text a saved list reads back as, one name a line, numbered. */
export function listToText(list: DraftList | null): string {
  if (!list) return '';
  return list.entries.map((entry) => `${entry.rank}. ${entry.name}`).join('\n');
}

export interface AutoChoice {
  player: DatasetPlayer;
  /** True when the list named him; false when the board's order did. */
  fromList: boolean;
}

/**
 * Who an auto pick takes: the first name on the list still available, else
 * the first player in `fallback` still available. Null when nobody is left.
 */
export function nextAutoPick(
  list: DraftList | null,
  available: readonly DatasetPlayer[],
  fallback: readonly DatasetPlayer[],
): AutoChoice | null {
  const open = new Map(available.map((player) => [player.key, player]));
  for (const entry of list?.entries ?? []) {
    if (!entry.playerKey) continue;
    const player = open.get(entry.playerKey);
    if (player) return { player, fromList: true };
  }
  for (const player of fallback) {
    const match = open.get(player.key);
    if (match) return { player: match, fromList: false };
  }
  const first = available[0];
  return first ? { player: first, fromList: false } : null;
}

/** Teams the commissioner has put on auto. */
export function autoOwners(state: Pick<LeagueDynamicState, 'draft'>): string[] {
  return state.draft.autoOwners ?? [];
}

export function isOnAuto(state: Pick<LeagueDynamicState, 'draft'>, owner: string): boolean {
  return autoOwners(state).includes(owner);
}

/** The auto set with one team put on or taken off. Never mutates. */
export function withAuto(current: readonly string[] | undefined, owner: string, on: boolean): string[] {
  const rest = (current ?? []).filter((entry) => entry !== owner);
  return on ? [...rest, owner] : rest;
}

import type { DatasetPlayer } from '../keeper/types.js';

export type PlayerPoolSourceStatus = 'fetched' | 'retained-missing';

/** Draft-facing player metadata. Keeper averages and tier math do not belong here. */
export interface PlayerPoolPlayer {
  key: string;
  espnId: number;
  fullName: string;
  proTeam: string;
  positions: string[];
  sourceStatus: PlayerPoolSourceStatus;
}

/** Normalized output from ESPN's kona_player_info response. */
export interface EspnPlayerPoolPlayer {
  espnId: number;
  fullName: string;
  proTeam: string;
  positions: string[];
}

export interface PlayerPoolSnapshot {
  id: string;
  season: number;
  sourceSeason: number;
  source: 'espn-kona';
  fetchedAt: string;
  acceptedAt: string;
  acceptedBy: string;
  players: PlayerPoolPlayer[];
}

export interface PlayerPoolFieldChange {
  key: string;
  espnId: number;
  fullName: string;
  before: string | string[];
  after: string | string[];
}

export interface PlayerPoolRefreshPreview {
  nextPlayers: PlayerPoolPlayer[];
  added: PlayerPoolPlayer[];
  removed: PlayerPoolPlayer[];
  retainedMissing: PlayerPoolPlayer[];
  nameChanged: PlayerPoolFieldChange[];
  teamChanged: PlayerPoolFieldChange[];
  positionChanged: PlayerPoolFieldChange[];
}

const POSITION_ORDER = new Map([
  ['PG', 0],
  ['SG', 1],
  ['SF', 2],
  ['PF', 3],
  ['C', 4],
]);

function normalizeText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} cannot be empty`);
  return normalized;
}

function normalizePositions(positions: string[]): string[] {
  return [...new Set(positions.map((position) => normalizeText(position, 'position').toUpperCase()))]
    .sort(
      (a, b) =>
        (POSITION_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (POSITION_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    );
}

function normalizeFetched(player: EspnPlayerPoolPlayer): PlayerPoolPlayer {
  if (!Number.isInteger(player.espnId) || player.espnId <= 0) {
    throw new Error(`Invalid ESPN player ID: ${player.espnId}`);
  }
  return {
    key: `p${player.espnId}`,
    espnId: player.espnId,
    fullName: normalizeText(player.fullName, 'fullName'),
    proTeam: normalizeText(player.proTeam, 'proTeam'),
    positions: normalizePositions(player.positions),
    sourceStatus: 'fetched',
  };
}

function uniqueByEspnId<T extends { espnId: number }>(players: T[], label: string): Map<number, T> {
  const result = new Map<number, T>();
  for (const player of players) {
    if (result.has(player.espnId)) {
      throw new Error(`Duplicate ESPN player ID ${player.espnId} in ${label}`);
    }
    result.set(player.espnId, player);
  }
  return result;
}

function byName(players: PlayerPoolPlayer[]): PlayerPoolPlayer[] {
  return [...players].sort(
    (a, b) => a.fullName.localeCompare(b.fullName) || a.espnId - b.espnId,
  );
}

function fieldChange(
  player: PlayerPoolPlayer,
  before: string | string[],
  after: string | string[],
): PlayerPoolFieldChange {
  return {
    key: player.key,
    espnId: player.espnId,
    fullName: player.fullName,
    before,
    after,
  };
}

/** Seed the fallback pool from the committed keeper dataset. */
export function playerPoolFromDataset(players: DatasetPlayer[]): PlayerPoolPlayer[] {
  return byName(
    players.map((player) => {
      if (player.espnId === null) {
        throw new Error(`Player ${player.key} has no ESPN ID`);
      }
      return {
        key: player.key,
        espnId: player.espnId,
        fullName: normalizeText(player.fullName ?? player.name, 'fullName'),
        proTeam: normalizeText(player.proTeam, 'proTeam'),
        positions: normalizePositions(player.positions),
        sourceStatus: 'fetched' as const,
      };
    }),
  );
}

/**
 * Build the exact pool that would be accepted and the commissioner-facing diff.
 * Missing protected players stay in the pool and are marked for review.
 */
export function previewPlayerPoolRefresh(
  currentPlayers: PlayerPoolPlayer[],
  fetchedPlayers: EspnPlayerPoolPlayer[],
  protectedPlayerKeys: ReadonlySet<string>,
): PlayerPoolRefreshPreview {
  const currentById = uniqueByEspnId(currentPlayers, 'current pool');
  const fetched = fetchedPlayers.map(normalizeFetched);
  const fetchedById = uniqueByEspnId(fetched, 'ESPN response');

  const nextPlayers: PlayerPoolPlayer[] = [];
  const added: PlayerPoolPlayer[] = [];
  const removed: PlayerPoolPlayer[] = [];
  const retainedMissing: PlayerPoolPlayer[] = [];
  const nameChanged: PlayerPoolFieldChange[] = [];
  const teamChanged: PlayerPoolFieldChange[] = [];
  const positionChanged: PlayerPoolFieldChange[] = [];

  for (const incoming of fetched) {
    const current = currentById.get(incoming.espnId);
    const next = current ? { ...incoming, key: current.key } : incoming;
    nextPlayers.push(next);
    if (!current) {
      added.push(next);
      continue;
    }
    if (current.fullName !== next.fullName) {
      nameChanged.push(fieldChange(next, current.fullName, next.fullName));
    }
    if (current.proTeam !== next.proTeam) {
      teamChanged.push(fieldChange(next, current.proTeam, next.proTeam));
    }
    if (current.positions.join('|') !== next.positions.join('|')) {
      positionChanged.push(fieldChange(next, current.positions, next.positions));
    }
  }

  for (const current of currentPlayers) {
    if (fetchedById.has(current.espnId)) continue;
    if (protectedPlayerKeys.has(current.key)) {
      const retained = { ...current, sourceStatus: 'retained-missing' as const };
      nextPlayers.push(retained);
      retainedMissing.push(retained);
    } else {
      removed.push(current);
    }
  }

  return {
    nextPlayers: byName(nextPlayers),
    added: byName(added),
    removed: byName(removed),
    retainedMissing: byName(retainedMissing),
    nameChanged,
    teamChanged,
    positionChanged,
  };
}


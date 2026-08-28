import { createHash } from 'node:crypto';
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  applyPlayerPoolToDataset,
  playerPoolFromDataset,
  previewPlayerPoolRefresh,
  type EspnPlayerPoolPlayer,
  type PlayerPoolRefreshPreview,
  type PlayerPoolSnapshot,
} from '../../src/lib/league/playerPool.js';
import {
  getPlayerPoolSnapshot,
  type LeagueDynamicState,
} from './leagueStore.js';

const dataset = rawDataset as unknown as LeagueDataset;
const MIN_PLAYER_COUNT = 250;
const MAX_PLAYER_COUNT = 2_000;
const VALID_POSITIONS = new Set(['PG', 'SG', 'SF', 'PF', 'C']);

export interface PlayerPoolCandidate {
  sourceSeason: number;
  fetchedAt: string;
  players: EspnPlayerPoolPlayer[];
}

export interface PreparedPlayerPoolCandidate {
  currentSnapshot: PlayerPoolSnapshot;
  preview: PlayerPoolRefreshPreview;
  fingerprint: string;
  snapshotId: string;
}

function contentFingerprint(
  source: PlayerPoolSnapshot['source'],
  sourceSeason: number,
  players: PlayerPoolSnapshot['players'],
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify({ season: dataset.season, source, sourceSeason, players }))
    .digest('hex');
  return `sha256:${hash}`;
}

function snapshotId(fingerprint: string): string {
  return `pp-${dataset.season}-${fingerprint.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

const fallbackPlayers = playerPoolFromDataset(dataset.players);
const fallbackFingerprint = contentFingerprint('committed-dataset', dataset.season, fallbackPlayers);

export const FALLBACK_PLAYER_POOL: PlayerPoolSnapshot = {
  id: `dataset-${dataset.season}`,
  season: dataset.season,
  sourceSeason: dataset.season,
  source: 'committed-dataset',
  fetchedAt: dataset.generatedAt,
  createdAt: dataset.generatedAt,
  createdBy: 'system',
  baseSnapshotId: null,
  fingerprint: fallbackFingerprint,
  players: fallbackPlayers,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parsePlayerPoolCandidate(value: unknown): PlayerPoolCandidate {
  const body = record(value);
  if (!body) throw new Error('Request body must be an object');

  const sourceSeason = body.sourceSeason;
  if (
    typeof sourceSeason !== 'number' ||
    !Number.isInteger(sourceSeason) ||
    sourceSeason !== dataset.season
  ) {
    throw new Error(`sourceSeason must be ${dataset.season}`);
  }

  if (typeof body.fetchedAt !== 'string' || !Number.isFinite(Date.parse(body.fetchedAt))) {
    throw new Error('fetchedAt must be an ISO date-time');
  }
  const fetchedAt = new Date(body.fetchedAt).toISOString();

  if (!Array.isArray(body.players)) throw new Error('players must be an array');
  if (body.players.length < MIN_PLAYER_COUNT || body.players.length > MAX_PLAYER_COUNT) {
    throw new Error(`players must contain ${MIN_PLAYER_COUNT}-${MAX_PLAYER_COUNT} entries`);
  }

  const players = body.players.map((valueAtIndex, index): EspnPlayerPoolPlayer => {
    const player = record(valueAtIndex);
    if (!player) throw new Error(`players[${index}] must be an object`);
    if (typeof player.espnId !== 'number' || !Number.isInteger(player.espnId) || player.espnId <= 0) {
      throw new Error(`players[${index}].espnId must be a positive integer`);
    }
    if (typeof player.fullName !== 'string' || player.fullName.trim().length === 0) {
      throw new Error(`players[${index}].fullName is required`);
    }
    if (typeof player.proTeam !== 'string' || player.proTeam.trim().length === 0) {
      throw new Error(`players[${index}].proTeam is required`);
    }
    if (!Array.isArray(player.positions) || player.positions.length === 0) {
      throw new Error(`players[${index}].positions must be a non-empty array`);
    }
    const positions = player.positions.map((position, positionIndex) => {
      if (typeof position !== 'string') {
        throw new Error(`players[${index}].positions[${positionIndex}] must be a string`);
      }
      const normalized = position.trim().toUpperCase();
      if (!VALID_POSITIONS.has(normalized)) {
        throw new Error(`players[${index}] has an unknown position: ${position}`);
      }
      return normalized;
    });
    return {
      espnId: player.espnId,
      fullName: player.fullName,
      proTeam: player.proTeam,
      positions,
    };
  });

  return { sourceSeason, fetchedAt, players };
}

export async function resolveCurrentPlayerPool(
  state: LeagueDynamicState,
): Promise<PlayerPoolSnapshot> {
  const activeId = state.playerPool?.activeSnapshotId;
  if (!activeId) return FALLBACK_PLAYER_POOL;
  const snapshot = await getPlayerPoolSnapshot(activeId);
  if (!snapshot) {
    throw new Error(`Active player-pool snapshot is missing: ${activeId}`);
  }
  return snapshot;
}

export async function resolveDraftPlayerPool(
  state: LeagueDynamicState,
): Promise<PlayerPoolSnapshot> {
  const snapshotId = state.draft.startedAt !== null
    ? state.draft.playerPoolSnapshotId
    : state.playerPool?.activeSnapshotId;
  if (!snapshotId || snapshotId === FALLBACK_PLAYER_POOL.id) return FALLBACK_PLAYER_POOL;
  const snapshot = await getPlayerPoolSnapshot(snapshotId);
  if (!snapshot) throw new Error(`Draft player-pool snapshot is missing: ${snapshotId}`);
  return snapshot;
}

export async function resolveDraftDataset(state: LeagueDynamicState): Promise<LeagueDataset> {
  const snapshot = await resolveDraftPlayerPool(state);
  return applyPlayerPoolToDataset(dataset, snapshot.players);
}

export async function fetchEspnPlayerPoolCandidate(): Promise<PlayerPoolCandidate> {
  const { ESPN_LEAGUE_ID, ESPN_SEASON_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID) throw new Error('ESPN_LEAGUE_ID is not configured');
  const sourceSeason = ESPN_SEASON_ID ? Number.parseInt(ESPN_SEASON_ID, 10) : dataset.season;
  if (sourceSeason !== dataset.season) {
    throw new Error(`ESPN_SEASON_ID must be ${dataset.season} before refreshing the draft pool`);
  }
  if (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID)) {
    throw new Error('ESPN credentials are not configured');
  }
  const cookieOverride = ESPN_COOKIE_STRING ?? `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`;
  const client = new EspnClient({
    leagueId: ESPN_LEAGUE_ID,
    seasonId: sourceSeason,
    espnS2: ESPN_S2,
    swid: ESPN_SWID,
    cookieOverride,
  });
  const players = await client.fetchPlayerPool();
  return parsePlayerPoolCandidate({
    sourceSeason,
    fetchedAt: new Date().toISOString(),
    players,
  });
}

function protectedPlayerKeys(state: LeagueDynamicState): Set<string> {
  const keys = new Set<string>();
  for (const player of dataset.players) {
    if (player.fantasyTeam !== null || player.keeper.contract?.currentOwner) keys.add(player.key);
  }
  for (const selections of Object.values(state.keepers)) {
    for (const selection of selections) keys.add(selection.playerKey);
  }
  for (const pick of Object.values(state.draft.picks)) {
    if (pick.playerKey) keys.add(pick.playerKey);
  }
  return keys;
}

export async function preparePlayerPoolCandidate(
  state: LeagueDynamicState,
  candidate: PlayerPoolCandidate,
): Promise<PreparedPlayerPoolCandidate> {
  const currentSnapshot = await resolveCurrentPlayerPool(state);
  const preview = previewPlayerPoolRefresh(
    currentSnapshot.players,
    candidate.players,
    protectedPlayerKeys(state),
  );
  const fingerprint = contentFingerprint('espn-kona', candidate.sourceSeason, preview.nextPlayers);
  return {
    currentSnapshot,
    preview,
    fingerprint,
    snapshotId: snapshotId(fingerprint),
  };
}

export function makePlayerPoolSnapshot(
  candidate: PlayerPoolCandidate,
  prepared: PreparedPlayerPoolCandidate,
  createdAt: string,
  createdBy: string,
): PlayerPoolSnapshot {
  return {
    id: prepared.snapshotId,
    season: dataset.season,
    sourceSeason: candidate.sourceSeason,
    source: 'espn-kona',
    fetchedAt: candidate.fetchedAt,
    createdAt,
    createdBy,
    baseSnapshotId: prepared.currentSnapshot.id,
    fingerprint: prepared.fingerprint,
    players: prepared.preview.nextPlayers,
  };
}

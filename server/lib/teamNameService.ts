/**
 * Refresh the ESPN team names, the same way the player pool is refreshed:
 * fetch a candidate, show the commissioner every change, write only when they
 * accept. The accepted names live in league state, not in the committed config.
 */
import { createHash } from 'node:crypto';
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  normalizeTeamName,
  previewTeamNameRefresh,
  type EspnTeamName,
  type TeamNameChange,
  type TeamNameRefreshPreview,
} from '../../src/lib/league/teamNames.js';
import { appendAudit, getState, mutateState, type LeagueDynamicState } from './leagueStore.js';

const dataset = rawDataset as unknown as LeagueDataset;
const MAX_TEAMS = 40;
const MAX_NAME_LENGTH = 200;

/** The ESPN season the live league runs in, when the environment names one. */
const DEFAULT_ESPN_SEASON = 2026;

export interface TeamNameRefreshResult {
  changed: number;
  changes: TeamNameChange[];
}

export interface TeamNameCandidate {
  sourceSeason: number;
  fetchedAt: string;
  teams: EspnTeamName[];
}

export interface PreparedTeamNameCandidate {
  preview: TeamNameRefreshPreview;
  fingerprint: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseTeamNameCandidate(value: unknown): TeamNameCandidate {
  const body = record(value);
  if (!body) throw new Error('Request body must be an object');

  const sourceSeason = body.sourceSeason;
  if (typeof sourceSeason !== 'number' || !Number.isInteger(sourceSeason)) {
    throw new Error('sourceSeason must be a whole number');
  }
  if (typeof body.fetchedAt !== 'string' || !Number.isFinite(Date.parse(body.fetchedAt))) {
    throw new Error('fetchedAt must be an ISO date-time');
  }
  const fetchedAt = new Date(body.fetchedAt).toISOString();

  if (!Array.isArray(body.teams) || body.teams.length === 0) {
    throw new Error('teams must be a non-empty array');
  }
  if (body.teams.length > MAX_TEAMS) {
    throw new Error(`teams must contain at most ${MAX_TEAMS} entries`);
  }

  const teams = body.teams.map((valueAtIndex, index): EspnTeamName => {
    const team = record(valueAtIndex);
    if (!team) throw new Error(`teams[${index}] must be an object`);
    if (
      typeof team.espnTeamId !== 'number'
      || !Number.isInteger(team.espnTeamId)
      || team.espnTeamId <= 0
    ) {
      throw new Error(`teams[${index}].espnTeamId must be a positive whole number`);
    }
    if (typeof team.name !== 'string' || normalizeTeamName(team.name) === '') {
      throw new Error(`teams[${index}].name is required`);
    }
    if (normalizeTeamName(team.name).length > MAX_NAME_LENGTH) {
      throw new Error(`teams[${index}].name is too long`);
    }
    if (team.ownerName !== undefined && typeof team.ownerName !== 'string') {
      throw new Error(`teams[${index}].ownerName must be text`);
    }
    return {
      espnTeamId: team.espnTeamId,
      name: normalizeTeamName(team.name),
      ownerName: normalizeTeamName(team.ownerName ?? ''),
    };
  });

  return { sourceSeason, fetchedAt, teams };
}

/**
 * A hash of the exact names that would be stored. The accept call sends it
 * back, so a candidate that changed since the preview is refused instead of
 * written.
 */
function fingerprint(preview: TeamNameRefreshPreview): string {
  const names = Object.keys(preview.nextNames)
    .sort()
    .map((owner) => [owner, preview.nextNames[owner]]);
  const hash = createHash('sha256')
    .update(JSON.stringify({ season: dataset.season, names }))
    .digest('hex');
  return `sha256:${hash}`;
}

/**
 * The ESPN season to read team names from.
 *
 * Unlike the draft player pool, this does not have to be the keeper season:
 * the league ID is the same either way and the names come off whichever season
 * the environment points at.
 */
export function espnSeasonId(): number {
  const raw = process.env.ESPN_SEASON_ID;
  if (!raw) return DEFAULT_ESPN_SEASON;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : DEFAULT_ESPN_SEASON;
}

export async function fetchEspnTeamNameCandidate(): Promise<TeamNameCandidate> {
  const { ESPN_LEAGUE_ID, ESPN_S2, ESPN_SWID, ESPN_COOKIE_STRING } = process.env;
  if (!ESPN_LEAGUE_ID) throw new Error('ESPN_LEAGUE_ID is not configured');
  if (!ESPN_COOKIE_STRING && (!ESPN_S2 || !ESPN_SWID)) {
    throw new Error('ESPN credentials are not configured');
  }
  const sourceSeason = espnSeasonId();
  const client = new EspnClient({
    leagueId: ESPN_LEAGUE_ID,
    seasonId: sourceSeason,
    espnS2: ESPN_S2,
    swid: ESPN_SWID,
    cookieOverride: ESPN_COOKIE_STRING ?? `espn_s2=${ESPN_S2}; SWID=${ESPN_SWID}`,
  });
  const teams = await client.fetchTeamNames();
  return parseTeamNameCandidate({
    sourceSeason,
    fetchedAt: new Date().toISOString(),
    teams,
  });
}

export function prepareTeamNameCandidate(
  state: LeagueDynamicState,
  candidate: TeamNameCandidate,
): PreparedTeamNameCandidate {
  const preview = previewTeamNameRefresh(dataset.teams, candidate.teams, state.teamNames);
  return { preview, fingerprint: fingerprint(preview) };
}

/**
 * Refresh the names on a clock, with nobody watching.
 *
 * This one writes without asking, which the player pool refresh would never
 * do. The difference is what the data decides. A frozen player pool decides
 * who can be drafted, so a person has to look at it. A team name decides
 * nothing: ESPN is simply where the name lives, and somebody renaming their
 * team is not a thing the commissioner should have to approve at 2am.
 *
 * Every failure is the caller's to swallow. Nothing here is worth interrupting
 * a reminder run for.
 */
export async function refreshTeamNamesNow(): Promise<TeamNameRefreshResult> {
  const candidate = await fetchEspnTeamNameCandidate();
  const { state } = await getState();
  const prepared = prepareTeamNameCandidate(state, candidate);
  if (prepared.preview.changes.length === 0) return { changed: 0, changes: [] };

  await mutateState((draft) => {
    draft.teamNames = { ...prepared.preview.nextNames };
  });
  // A team name is not personal data, and this is the only trail for "when did
  // that change". Silent when nothing moved, so an hourly job stays quiet.
  for (const change of prepared.preview.changes) {
    console.log(`[teams] ${change.owner}: ${change.before} -> ${change.after}`);
  }
  await appendAudit(null, 'team_names.refreshed', {
    by: 'clock',
    changes: prepared.preview.changes,
  });
  return { changed: prepared.preview.changes.length, changes: prepared.preview.changes };
}

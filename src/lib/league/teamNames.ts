/**
 * Live ESPN team names.
 *
 * The committed dataset carries the team name each owner had when the config
 * was written. People rename their team on ESPN whenever they like, so the
 * committed name goes stale and nothing here can stop that. The commissioner
 * refreshes the names from ESPN and the live map is stored in league state,
 * never in the committed config, which ships to the browser.
 *
 * Teams are matched on `espnTeamId`. Never on the name: the name is the thing
 * that changes.
 */
import type { TeamInfo } from '../keeper/types.js';

/** One team as ESPN reports it right now. */
export interface EspnTeamName {
  espnTeamId: number;
  name: string;
  ownerName: string;
}

/** Owner name to the team name ESPN last reported for them. */
export type TeamNameOverrides = Record<string, string>;

export interface TeamNameChange {
  owner: string;
  espnTeamId: number;
  before: string;
  after: string;
}

export interface TeamNameRow {
  owner: string;
  espnTeamId: number;
  name: string;
}

export interface TeamNameRefreshPreview {
  /** Real renames, old name to new. */
  changes: TeamNameChange[];
  /** Teams ESPN returned whose name reads the same as the one on file. */
  unchanged: TeamNameRow[];
  /** League teams ESPN did not send back. Their stored name stays put. */
  missing: TeamNameRow[];
  /** ESPN team IDs this league does not know. Ignored, never guessed at. */
  unknownEspnTeamIds: number[];
  /** The exact map that gets stored when the commissioner accepts. */
  nextNames: TeamNameOverrides;
}

/**
 * Collapse runs of whitespace and trim.
 *
 * ESPN hands back "Tu  Mamacita" and names with a trailing space. Without this
 * every refresh would report those as changes and the preview would be noise.
 */
export function normalizeTeamName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The team name to show for one owner: the live name when there is one, else
 * the committed name. Every screen goes through this so a name can never be
 * fresh in one place and stale in another.
 */
export function teamNameOf(
  team: Pick<TeamInfo, 'owner' | 'espnTeamName'> | null | undefined,
  overrides?: TeamNameOverrides | null,
): string {
  if (!team) return '';
  const live = overrides?.[team.owner];
  const normalized = typeof live === 'string' ? normalizeTeamName(live) : '';
  return normalized || normalizeTeamName(team.espnTeamName);
}

/** The name on file for a team before any refresh: live name, else committed. */
function currentName(team: TeamInfo, overrides?: TeamNameOverrides | null): string {
  return teamNameOf(team, overrides);
}

/**
 * Work out what a fetch from ESPN would change, without writing anything.
 *
 * A name that differs only by whitespace is not a change. An ESPN team the
 * league does not know is ignored. A league team ESPN did not send keeps the
 * name it already has.
 */
export function previewTeamNameRefresh(
  teams: readonly TeamInfo[],
  fetched: readonly EspnTeamName[],
  overrides?: TeamNameOverrides | null,
): TeamNameRefreshPreview {
  const teamById = new Map<number, TeamInfo>();
  for (const team of teams) teamById.set(team.espnTeamId, team);

  const seen = new Set<number>();
  const changes: TeamNameChange[] = [];
  const unchanged: TeamNameRow[] = [];
  const unknownEspnTeamIds: number[] = [];
  const nextNames: TeamNameOverrides = {};

  for (const team of teams) {
    const stored = overrides?.[team.owner];
    if (typeof stored === 'string' && normalizeTeamName(stored)) {
      nextNames[team.owner] = normalizeTeamName(stored);
    }
  }

  for (const incoming of fetched) {
    if (seen.has(incoming.espnTeamId)) {
      throw new Error(`Duplicate ESPN team ID ${incoming.espnTeamId} in the ESPN response`);
    }
    seen.add(incoming.espnTeamId);

    const team = teamById.get(incoming.espnTeamId);
    if (!team) {
      unknownEspnTeamIds.push(incoming.espnTeamId);
      continue;
    }
    const after = normalizeTeamName(incoming.name);
    if (!after) continue;
    const before = currentName(team, overrides);
    nextNames[team.owner] = after;
    if (before === after) {
      unchanged.push({ owner: team.owner, espnTeamId: team.espnTeamId, name: after });
    } else {
      changes.push({ owner: team.owner, espnTeamId: team.espnTeamId, before, after });
    }
  }

  const missing = teams
    .filter((team) => !seen.has(team.espnTeamId))
    .map((team) => ({
      owner: team.owner,
      espnTeamId: team.espnTeamId,
      name: currentName(team, overrides),
    }));

  return { changes, unchanged, missing, unknownEspnTeamIds, nextNames };
}

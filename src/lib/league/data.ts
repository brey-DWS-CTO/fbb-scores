import raw from '../../data/league-2027.json';
import type { LeagueDataset } from '../keeper/types.js';

/** The static 2027 league dataset (players, tiers, teams, trades, contracts). */
export const leagueDataset = raw as unknown as LeagueDataset;

export const teamByOwner = new Map(leagueDataset.teams.map((t) => [t.owner, t]));

export const OWNERS = leagueDataset.teams
  .slice()
  .sort((a, b) => a.draftPosition - b.draftPosition)
  .map((t) => t.owner);

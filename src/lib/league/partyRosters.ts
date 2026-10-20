/**
 * Every owner's players for the WATCH page, read off the draft board: the
 * keepers each team kept and the picks each team made, on whichever team
 * holds the pick after trades. Once the ESPN roster sync lands, that will
 * replace this.
 *
 * Pure. No server, no browser.
 */
import { buildDraftBoard } from '../keeper/engine.js';
import type { LeagueDataset, LeagueDynamicState } from '../keeper/types.js';
import type { RosterPlayer, RostersByOwner } from './houseParty.js';

export function leagueRosters(dataset: LeagueDataset, state: LeagueDynamicState): RostersByOwner {
  const rosters: RostersByOwner = {};
  for (const team of dataset.teams) rosters[team.owner] = [];
  const seen = new Set<string>();
  const add = (owner: string, player: RosterPlayer) => {
    const id = `${owner}:${player.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    (rosters[owner] ??= []).push(player);
  };
  const byKey = new Map(dataset.players.map((player) => [player.key, player]));
  for (const cell of buildDraftBoard(dataset, state)) {
    const owner = cell.pick.currentOwner;
    const kept = cell.keeper?.player;
    if (kept) {
      add(owner, { key: kept.key, name: kept.fullName ?? kept.name, proTeam: kept.proTeam });
      continue;
    }
    const pick = cell.selection;
    if (!pick?.playerKey) continue;
    const known = byKey.get(pick.playerKey);
    add(owner, {
      key: pick.playerKey,
      name: pick.playerName ?? known?.fullName ?? known?.name ?? pick.playerKey,
      proTeam: pick.proTeam ?? known?.proTeam ?? '',
    });
  }
  return rosters;
}

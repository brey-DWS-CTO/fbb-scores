import { completeLine, type BoxLine, type ScoringItem } from './partyScore.js';
import { computeFpts, round1 } from '../espn/calculations.js';
import type { CastSchedule } from './castPolling.js';

export interface CastPlay {
  id: string; gameId: string; text: string; clock: string; period: number;
  timestamp: string | null; order: number; game: string;
  /** The score right after this play. Missing on plays saved before scores were kept. */
  awayScore?: number; homeScore?: number;
  changes: { athleteId: string; name: string; team: string; stat: string; stats: Record<string, number> }[];
}
export interface FantasyCast { plays: CastPlay[]; error: string | null; fetchedAt: string; schedule?: CastSchedule }
type RawPlay = { id?: string; text?: string; awayScore?: number | string; homeScore?: number | string; scoreValue?: number; pointsAttempted?: number; wallclock?: string; sequenceNumber?: string; period?: { number?: number }; clock?: { displayValue?: string } };

/** Keep every play, including substitutions and team events with no fantasy impact. */
export function parseCastPlays(raw: unknown, gameId: string, game: string, players: readonly BoxLine[]): CastPlay[] {
  const plays = (raw as { plays?: RawPlay[] } | null)?.plays;
  if (!Array.isArray(plays)) return [];
  const totals = new Map<string, Record<string, number>>();
  const uniquePlayers = [...new Map(players.map(player => [player.athleteId, player])).values()];
  return [...plays].sort((a, b) => Number(a.sequenceNumber ?? a.id ?? 0) - Number(b.sequenceNumber ?? b.id ?? 0)).map((play, index) => {
    const text = play.text ?? '';
    const changes: CastPlay['changes'] = [];
    const add = (player: BoxLine, stat: string, stats: Record<string, number>) => {
      const previous = totals.get(player.athleteId) ?? {};
      const next = { ...previous };
      for (const [id, value] of Object.entries(stats)) next[id] = (next[id] ?? 0) + value;
      const before = completeLine(previous), after = completeLine(next);
      for (const id of ['37', '38', '39']) if (after[id] !== before[id]) stats[id] = after[id] - before[id];
      totals.set(player.athleteId, next);
      changes.push({ athleteId: player.athleteId, name: player.name, team: player.team, stat, stats });
    };
    for (const player of uniquePlayers) {
      const name = [player.name, player.shortName].filter(Boolean).find(name => text.startsWith(`${name} `));
      if (name) {
        const action = text.slice(name.length).trim().toLowerCase();
        if (action.startsWith('makes ')) {
          const free = action.includes('free throw'), three = play.scoreValue === 3 || play.pointsAttempted === 3 || /three point|three-point/.test(action);
          add(player, free ? 'Free throw made' : three ? '3-pointer made' : 'Field goal made', free ? { '0': 1, '15': 1, '16': 1 } : { '0': three ? 3 : 2, '13': 1, '14': 1, ...(three ? { '17': 1, '18': 1 } : {}) });
        } else if (action.startsWith('misses ')) {
          const free = action.includes('free throw');
          add(player, free ? 'Free throw missed' : 'Field goal missed', free ? { '24': 1, '16': 1 } : { '23': 1, '14': 1 });
        } else if (/^(offensive|defensive) rebound/.test(action)) add(player, 'Rebound', { '6': 1 });
        else if (action.includes('turnover')) add(player, 'Turnover', { '11': 1 });
        else if (action.startsWith('blocks ')) add(player, 'Block', { '1': 1 });
      }
      if ([player.name, player.shortName].filter(Boolean).some(name => text.includes(`blocks ${name} 's `) || text.includes(`blocks ${name}'s `))) {
        add(player, 'Field goal missed · blocked', { '23': 1, '14': 1 });
      }
      for (const name of new Set([player.name, player.shortName].filter(Boolean))) {
        if (text.includes(`(${name} assists)`)) { add(player, 'Assist', { '3': 1 }); break; }
      }
      for (const name of new Set([player.name, player.shortName].filter(Boolean))) {
        if (text.includes(`(${name} steals)`)) { add(player, 'Steal', { '2': 1 }); break; }
      }
    }
    return { id: `${gameId}:${play.id ?? index}`, gameId, text, game, clock: play.clock?.displayValue ?? '', period: play.period?.number ?? 0,
      timestamp: play.wallclock && Number.isFinite(Date.parse(play.wallclock)) ? play.wallclock : null,
      order: Number(play.sequenceNumber ?? index), changes,
      ...(Number.isFinite(Number(play.awayScore)) && Number.isFinite(Number(play.homeScore)) && play.awayScore !== undefined && play.homeScore !== undefined
        ? { awayScore: Number(play.awayScore), homeScore: Number(play.homeScore) } : {}) };
  });
}

export function castPoints(stats: Record<string, number>, scoring: readonly ScoringItem[]): number {
  return round1(computeFpts(stats, [...scoring]));
}

export function castMatchesTeams(play: CastPlay, teamIds: readonly (number | undefined)[], rosters: ReadonlyMap<string, { team: { teamId: number }; started: boolean }>, scoring: readonly ScoringItem[]): boolean {
  return play.changes.some(change => {
    const roster = rosters.get(change.athleteId);
    return roster?.started === true && teamIds.includes(roster.team.teamId) && castPoints(change.stats, scoring) !== 0;
  });
}

/** Final box scores include official changes that are not always rewritten into plays. */
export function reconcileCastPlays(plays: CastPlay[], players: readonly BoxLine[]): CastPlay[] {
  if (!plays.length) return plays;
  const changes: CastPlay['changes'] = [];
  const ids = ['0', '1', '2', '3', '6', '11', '13', '14', '15', '16', '17', '23', '24', '37', '38', '39'];
  const totals = new Map<string, Record<string, number>>();
  for (const play of plays) for (const change of play.changes) {
    const sum = totals.get(change.athleteId) ?? {};
    for (const [id, value] of Object.entries(change.stats)) sum[id] = (sum[id] ?? 0) + value;
    totals.set(change.athleteId, sum);
  }
  for (const player of new Map(players.map(player => [player.athleteId, player])).values()) {
    const summed = totals.get(player.athleteId) ?? {};
    const stats = Object.fromEntries(ids.filter(id => player.stats[id] !== undefined && player.stats[id] !== (summed[id] ?? 0)).map(id => [id, player.stats[id] - (summed[id] ?? 0)]));
    if (Object.keys(stats).length) changes.push({ athleteId: player.athleteId, name: player.name, team: player.team, stat: 'Official stat correction', stats });
  }
  const last = plays[plays.length - 1];
  return changes.length ? [...plays, { ...last, id: `${last.gameId}:corrections`, order: last.order + 1, text: 'Final official stat corrections · Adjustments from the box score', changes }] : plays;
}

/** Wall clock interleaves games; undated events stay in game/sequence order. */
export function sortCastPlays(plays: readonly CastPlay[], newest: boolean): CastPlay[] {
  return [...plays].sort((a, b) => {
    const order = a.timestamp && b.timestamp ? Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.gameId.localeCompare(b.gameId) || a.order - b.order
      : a.timestamp ? -1 : b.timestamp ? 1 : a.gameId.localeCompare(b.gameId) || a.order - b.order;
    return newest ? -order : order;
  });
}

import type { CastPlay } from './fantasyCast.js';
import { castPoints } from './fantasyCast.js';
import type { ScoringItem } from './partyScore.js';

export function castShortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(part => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(part));
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)![0]}.` : name;
}

/** Input is chronological. Each displayed delta gets its running game total. */
export function castRunningTotals(plays: readonly CastPlay[], scoring: readonly ScoringItem[]): Map<CastPlay['changes'][number], number> {
  const running = new Map<string, number>();
  const totals = new Map<CastPlay['changes'][number], number>();
  for (const play of plays) for (const change of play.changes) {
    const key = `${play.gameId}:${change.athleteId}`;
    const total = Math.round(((running.get(key) ?? 0) + castPoints(change.stats, scoring)) * 10) / 10;
    running.set(key, total); totals.set(change, total);
  }
  return totals;
}

export function castOwnership(teamId: number | undefined, myTeamId: number | undefined, opponentId: number | undefined): 'own' | 'opponent' | 'neutral' {
  if (teamId === undefined) return 'neutral';
  if (myTeamId !== undefined && teamId === myTeamId) return 'own';
  return opponentId !== undefined && teamId === opponentId ? 'opponent' : 'neutral';
}

/** Keep the original action, including distance and shot type, once per scorer. */
export function castAction(play: CastPlay, change: CastPlay['changes'][number]): string {
  if (play.text.startsWith(`${change.name} `)) return play.text.slice(change.name.length).trim();
  const actor = play.changes.find(entry => play.text.startsWith(`${entry.name} `));
  if (change.stat === 'Assist' && actor) return `assists ${actor.name}`;
  if (change.stat === 'Steal' && actor) return `steals from ${actor.name}`;
  if (play.changes.length === 1) return play.text;
  if (change.stat.includes('blocked')) return `shot blocked · ${play.text}`;
  return change.stat.toLowerCase();
}

/**
 * Foul trouble, from ESPN's play feed. A player is in foul trouble with 2
 * fouls in the 1st, 3 in the 2nd, 4 in the 3rd, 5 in the 4th or overtime.
 * The bar rises each quarter, so a player can be in trouble in one quarter
 * and out of it in the next without a whistle: 2 fouls in the 1st is
 * trouble, the same 2 in the 2nd is not. Six fouls and he is gone.
 *
 * Pure. No server, no browser.
 */
import type { BoxScore } from './partyScore.js';

export const FOUL_OUT = 6;

/** Fouls that mean trouble in a period: one more than the quarter, 5 from the 4th on. */
export function troubleAt(period: number): number {
  return Math.min(Math.max(period, 1) + 1, 5);
}

export type FoulState =
  /** In trouble right now. */
  | 'trouble'
  /** Was in trouble earlier in the game, below the bar now. */
  | 'cleared'
  | 'fouled-out';

export interface FoulRead {
  state: FoulState;
  fouls: number;
  /** The first period he hit the bar in. */
  since: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Personal fouls in each period, by ESPN athlete id: index 0 is the 1st
 * quarter. Technicals are not personal fouls. ESPN logs an offensive foul
 * twice, as the foul and as the turnover, so the turnover is skipped.
 */
export function foulsByPeriod(raw: unknown): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const plays = record(raw)?.plays;
  for (const entry of Array.isArray(plays) ? plays : []) {
    const play = record(entry);
    const kind = record(play?.type)?.text;
    if (typeof kind !== 'string' || !/foul|charge/i.test(kind) || /technical|turnover/i.test(kind)) continue;
    const period = record(play?.period)?.number;
    const first = record(Array.isArray(play?.participants) ? play.participants[0] : null);
    const athleteId = record(first?.athlete)?.id;
    if (typeof period !== 'number' || period < 1 || typeof athleteId !== 'string' || !athleteId) continue;
    const counts = out.get(athleteId) ?? [];
    while (counts.length < period) counts.push(0);
    counts[period - 1] += 1;
    out.set(athleteId, counts);
  }
  return out;
}

/**
 * Where a player stands now. `period` is the game's period now; for a final
 * game, the last one played. Null when he was never in trouble.
 */
export function foulRead(byPeriod: readonly number[], period: number): FoulRead | null {
  let fouls = 0;
  let since = 0;
  const last = Math.max(period, byPeriod.length);
  for (let at = 1; at <= last; at += 1) {
    fouls += byPeriod[at - 1] ?? 0;
    if (!since && fouls >= troubleAt(at)) since = at;
  }
  if (fouls >= FOUL_OUT) return { state: 'fouled-out', fouls, since: since || last };
  if (!since) return null;
  return { state: fouls >= troubleAt(last) ? 'trouble' : 'cleared', fouls, since };
}

/** "1st", "2nd", "OT", "2OT". */
export function periodName(period: number): string {
  if (period > 4) return period === 5 ? 'OT' : `${period - 4}OT`;
  return ['1st', '2nd', '3rd', '4th'][period - 1] ?? `${period}th`;
}

/** The badge words and the longer line behind them. Live and final read differently. */
export function foulText(read: FoulRead, final: boolean): { label: string; title: string } {
  const pf = `${read.fouls} PF`;
  if (read.state === 'fouled-out') return { label: 'FOULED OUT', title: `Fouled out with ${read.fouls} fouls.` };
  const when = `In foul trouble in the ${periodName(read.since)}`;
  if (final) return { label: `HAD FOUL TROUBLE · ${pf}`, title: `${when}. Finished with ${read.fouls} fouls.` };
  if (read.state === 'trouble') return { label: `FOUL TROUBLE · ${pf}`, title: `${when}. ${read.fouls} fouls now.` };
  return { label: `OUT OF FOUL TROUBLE · ${pf}`, title: `${when}. Out of it now with ${read.fouls} fouls.` };
}

export interface CourtRead {
  onCourt: boolean;
  foul: FoulRead | null;
  final: boolean;
}

/** Each started game's players by ESPN athlete id: on the floor or not, and any foul trouble. */
export function courtReads(boxScores: readonly BoxScore[]): Map<string, CourtRead> {
  const out = new Map<string, CourtRead>();
  for (const box of boxScores) {
    if (box.state === 'pre') continue;
    const final = box.state === 'post';
    // ESPN drops the period once a game is final; the game went at least four.
    const period = box.period || Math.max(4, ...box.lines.map((line) => line.foulsByPeriod?.length ?? 0));
    for (const line of box.lines) {
      if (!line.athleteId) continue;
      out.set(line.athleteId, {
        onCourt: !final && line.onCourt === true,
        foul: foulRead(line.foulsByPeriod ?? [], period),
        final,
      });
    }
  }
  return out;
}

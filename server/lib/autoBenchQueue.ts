import { QueueClient } from '@vercel/queue';
import { autoBenchSchedule } from '../../src/lib/league/autoBench.js';
import { pacific, type DayGame } from '../../src/lib/league/lmWeekend.js';
import { espnLmConfig } from './espnLm.js';
import { getState } from './leagueStore.js';
import { gamesOn } from './nbaDay.js';
import { runAutoBench } from './autoBenchService.js';

export const AUTO_BENCH_TOPIC = 'daily-waiver-auto-bench';
export interface AutoBenchMessage { date: string; leagueId: string; seasonId: number; runAt: string }
export interface AutoBenchScheduler {
  eligible(): Promise<boolean>;
  games(date: string): Promise<DayGame[]>;
  publish(message: AutoBenchMessage, options: { delaySeconds: number; retentionSeconds: number; idempotencyKey: string }): Promise<unknown>;
}
export const autoBenchQueue = new QueueClient();
/** Called once daily at 07:00 UTC, before Pacific midnight or at midnight during DST.
 * Opting in also calls this so an owner joining after the daily planner is covered. */
export async function scheduleAutoBench(now = new Date(), deps?: AutoBenchScheduler) {
  const config = espnLmConfig();
  if (!config) return { scheduled: false, reason: 'ESPN is unavailable' };
  const source: AutoBenchScheduler = deps ?? {
    async eligible() {
      const preferences = (await getState()).state.autoBench?.preferences ?? {};
      return Object.values(preferences).some(pref => pref.enabled && pref.leagueId === config.leagueId && pref.season === config.seasonId);
    },
    games: gamesOn,
    publish: (message, options) => autoBenchQueue.send(AUTO_BENCH_TOPIC, message, options),
  };
  if (!await source.eligible()) return { scheduled: false, reason: 'No opted-in owners' };
  // At 07:00 UTC this is the upcoming Pacific date in winter and today's date in DST.
  let date = now.toISOString().slice(0, 10);
  let schedule = autoBenchSchedule(date, await source.games(date));
  if (Date.parse(schedule.runAt) <= now.getTime()) {
    date = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    schedule = autoBenchSchedule(date, await source.games(date));
  }
  const message: AutoBenchMessage = { date, leagueId: config.leagueId, seasonId: config.seasonId, runAt: schedule.runAt };
  await source.publish(message, { delaySeconds: Math.ceil((Date.parse(schedule.runAt) - now.getTime()) / 1000),
    retentionSeconds: 172800, idempotencyKey: `auto-bench:${config.leagueId}:${config.seasonId}:${date}` });
  return { scheduled: true, runAt: schedule.runAt };
}
/** Queue messages are private to Vercel. Validate binding and time anyway; never catch up late. */
export async function deliverAutoBench(message: AutoBenchMessage, now = new Date(), run = runAutoBench) {
  const config = espnLmConfig();
  if (!config || !message || message.leagueId !== config.leagueId || message.seasonId !== config.seasonId
    || message.date !== pacific(now).date || !Number.isFinite(Date.parse(message.runAt))) return [];
  const elapsed = now.getTime() - Date.parse(message.runAt);
  if (elapsed < 0 || elapsed >= 5 * 60_000) return [];
  return run(now, message.runAt);
}

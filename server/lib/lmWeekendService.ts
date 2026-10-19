/**
 * The weekend clock: keeps ESPN's waiver hour where the league wants it and
 * runs the LM adds members ask for.
 *
 * Runs from GET /api/notify/lm-clock every fifteen minutes (vercel.json) and
 * when a member sends a request. Every run is idempotent: it reads what ESPN
 * has, works out what it should be, and writes only the difference. No
 * claims, no state of its own beyond the requests table.
 *
 * The rules themselves live in src/lib/league/lmWeekend.ts.
 */
import { randomUUID } from 'node:crypto';
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../../src/lib/keeper/types.js';
import { EspnClient } from '../../src/lib/espn/client.js';
import {
  checkLmAdd,
  earlyDays,
  lmAddAllowed,
  lmAddWindow,
  pacific,
  waiverHourFor,
  waiverHourToHold,
  type DayGame,
  type EarlyDay,
  type LmAddCheck,
  type LmAddRequest,
  type LmAddWindow,
  type WaiverHour,
} from '../../src/lib/league/lmWeekend.js';
import { shortName } from '../../src/lib/league/transactions.js';
import {
  describeWrite,
  espnLmConfig,
  espnWriteTrouble,
  lmAdd,
  setWaiverHour,
  type EspnLmConfig,
} from './espnLm.js';
import { appendAudit, listLmAddRequests, listTransactions, saveLmAddRequest } from './leagueStore.js';
import { gamesForDays, gamesOn } from './nbaDay.js';

const dataset = rawDataset as unknown as LeagueDataset;

/** The clock does not touch the hour before this, Pacific. Nobody is up. */
const SET_HOUR_FROM_PT = 5;

/** How many days ahead the early-day list looks. */
const LOOKAHEAD_DAYS = 7;

export interface LmClockRun {
  at: string;
  date: string;
  skipped: string | null;
  waiver: { target: WaiverHour; current: number | null; changed: boolean; note: string } | null;
  adds: Array<{ id: string; status: LmAddRequest['status']; note: string }>;
}

function readClient(config: EspnLmConfig): EspnClient {
  return new EspnClient({ leagueId: config.leagueId, seasonId: config.seasonId, cookieOverride: config.cookie });
}

function tomorrowOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The hour ESPN should hold right now: today's until today's run has
 * passed, then tomorrow's, but never an hour still ahead today (ESPN would
 * run waivers a second time). `waiverHourToHold` holds the rule.
 */
export async function targetWaiverHour(now: Date): Promise<{ date: string; target: WaiverHour }> {
  const pt = pacific(now);
  const today = waiverHourFor(await gamesOn(pt.date));
  if (pt.hour <= today.hourPT) return { date: pt.date, target: today };
  const next = tomorrowOf(pt.date);
  const tomorrow = waiverHourFor(await gamesOn(next));
  const target = waiverHourToHold(pt, today, tomorrow);
  return { date: target === tomorrow ? next : pt.date, target };
}

async function keepWaiverHour(config: EspnLmConfig, now: Date): Promise<LmClockRun['waiver']> {
  const { date, target } = await targetWaiverHour(now);
  let current: number | null = null;
  try {
    current = await readClient(config).fetchWaiverHour();
  } catch (err) {
    return { target, current: null, changed: false, note: `could not read ESPN: ${err instanceof Error ? err.message : err}` };
  }
  if (current === target.hourET) return { target, current, changed: false, note: 'already right' };
  const result = await setWaiverHour(config, target.hourET);
  const note = describeWrite(result);
  await appendAudit(null, 'lm.waiverHour', {
    forDate: date,
    hourPT: target.hourPT,
    hourET: target.hourET,
    early: target.early,
    firstTip: target.firstTip,
    was: current,
    result: note,
  });
  return { target, current, changed: result.ok, note };
}

/** When a player was last dropped this season, by ESPN id. */
async function lastDrops(): Promise<Map<number, string>> {
  const drops = new Map<number, string>();
  for (const row of await listTransactions(dataset.season, 2000)) {
    if (row.kind !== 'drop') continue;
    const seen = drops.get(row.playerId);
    if (!seen || row.at > seen) drops.set(row.playerId, row.at);
  }
  return drops;
}

async function attemptAdd(config: EspnLmConfig, request: LmAddRequest, by: string | null): Promise<LmAddRequest> {
  const client = readClient(config);
  let scoringPeriodId: number;
  try {
    scoringPeriodId = await client.getCurrentScoringPeriod();
  } catch (err) {
    return { ...request, note: `could not read ESPN: ${err instanceof Error ? err.message : err}`, updatedAt: new Date().toISOString() };
  }
  const result = await lmAdd(config, { teamId: request.teamId, playerId: request.playerId, scoringPeriodId });
  const note = describeWrite(result);
  await appendAudit(by, 'lm.add', { id: request.id, owner: request.owner, playerId: request.playerId, playerName: request.playerName, result: note });
  const updatedAt = new Date().toISOString();
  if (result.ok && !result.dryRun) return { ...request, status: 'added', note, updatedAt, handledBy: by };
  if (result.dryRun) return { ...request, note: 'dry run: nothing sent to ESPN', updatedAt };
  if (result.authFailed) return { ...request, note, updatedAt };
  // ESPN refused the move itself. Almost always no roster spot yet.
  const status: LmAddRequest['status'] = request.status === 'failsafe' ? 'failsafe' : 'waiting-for-drop';
  return { ...request, status, note, updatedAt };
}

/** Try every open request whose day it is, and failsafe the ones whose day has passed. */
async function runAdds(config: EspnLmConfig, now: Date): Promise<LmClockRun['adds']> {
  const pt = pacific(now);
  const out: LmClockRun['adds'] = [];
  const games = await gamesOn(pt.date);
  const window = lmAddWindow(now, games);
  for (const request of await listLmAddRequests(dataset.season)) {
    if (request.status === 'added' || request.status === 'denied') continue;
    let next = request;
    if (request.forDate === pt.date && request.status !== 'failsafe') {
      if (window.open) next = await attemptAdd(config, request, null);
      else next = { ...request, status: 'failsafe', note: 'Not added before the first tip. His points count today; the add goes through for tomorrow.', updatedAt: now.toISOString() };
    } else if (request.forDate < pt.date) {
      // Yesterday's miss, or an earlier one: keep trying each run.
      next = await attemptAdd(config, { ...request, status: 'failsafe' }, null);
    }
    if (next !== request) {
      await saveLmAddRequest(next);
      out.push({ id: next.id, status: next.status, note: next.note });
    }
  }
  return out;
}

/** One tick of the clock. Safe to call as often as you like. */
export async function runLmClock(now = new Date()): Promise<LmClockRun> {
  const pt = pacific(now);
  const config = espnLmConfig();
  if (!config) return { at: now.toISOString(), date: pt.date, skipped: 'ESPN credentials are not configured', waiver: null, adds: [] };
  const waiver = pt.hour >= SET_HOUR_FROM_PT ? await keepWaiverHour(config, now) : null;
  const adds = await runAdds(config, now);
  return { at: now.toISOString(), date: pt.date, skipped: null, waiver, adds };
}

// ─── What the page shows ────────────────────────────────────────────────────

export interface LmWeekendView {
  season: number;
  today: { date: string; games: number; waiver: WaiverHour; window: LmAddWindow };
  earlyDays: EarlyDay[];
  requests: LmAddRequest[];
  /** Why writes to ESPN are down, or null. */
  espnWriteTrouble: string | null;
  dryRun: boolean;
}

export async function lmWeekendView(now = new Date()): Promise<LmWeekendView> {
  const pt = pacific(now);
  const byDate = await gamesForDays(pt.date, LOOKAHEAD_DAYS);
  const today: DayGame[] = byDate[pt.date] ?? [];
  const config = espnLmConfig();
  return {
    season: dataset.season,
    today: { date: pt.date, games: today.length, waiver: waiverHourFor(today), window: lmAddWindow(now, today) },
    earlyDays: earlyDays(byDate),
    requests: await listLmAddRequests(dataset.season),
    espnWriteTrouble: config ? espnWriteTrouble() : 'ESPN credentials are not configured',
    dryRun: config?.dryRun ?? false,
  };
}

// ─── A member's request ─────────────────────────────────────────────────────

export class LmAddRefused extends Error {
  checks: LmAddCheck[];

  constructor(message: string, checks: LmAddCheck[]) {
    super(message);
    this.checks = checks;
  }
}

/** Check the rules, save the request, and try the add at once. */
export async function requestLmAdd(owner: string, playerId: number, now = new Date()): Promise<{ request: LmAddRequest; checks: LmAddCheck[] }> {
  const team = dataset.teams.find((t) => t.owner === owner);
  if (!team) throw new LmAddRefused('That owner has no team.', []);
  const config = espnLmConfig();
  if (!config) throw new LmAddRefused('ESPN credentials are not configured.', []);

  const pt = pacific(now);
  const games = await gamesOn(pt.date);
  const facts = (await readClient(config).fetchPlayerFacts([playerId])).get(playerId);
  if (!facts) throw new LmAddRefused('ESPN does not know that player.', []);
  const drops = await lastDrops();
  const checks = checkLmAdd({
    now,
    todaysGames: games,
    proTeam: facts.proTeam,
    onTeamId: facts.onTeamId,
    lastDroppedAt: drops.get(playerId) ?? null,
  });
  if (!lmAddAllowed(checks)) throw new LmAddRefused('That add breaks a rule.', checks);

  const at = now.toISOString();
  const fresh: LmAddRequest = {
    id: randomUUID(),
    season: dataset.season,
    owner,
    teamId: team.espnTeamId,
    playerId,
    playerName: shortName(facts.name),
    proTeam: facts.proTeam,
    requestedAt: at,
    forDate: pt.date,
    status: 'requested',
    note: '',
    updatedAt: at,
    handledBy: null,
  };
  await appendAudit(owner, 'lm.add.requested', { id: fresh.id, playerId, playerName: fresh.playerName });
  const request = await attemptAdd(config, fresh, null);
  await saveLmAddRequest(request);
  return { request, checks };
}

/** The commissioner tries one again, whatever its day. */
export async function retryLmAdd(id: string, by: string): Promise<LmAddRequest | null> {
  const config = espnLmConfig();
  const request = (await listLmAddRequests(dataset.season)).find((row) => row.id === id);
  if (!request) return null;
  if (!config) return request;
  const next = await attemptAdd(config, request, by);
  await saveLmAddRequest(next);
  return next;
}

export async function denyLmAdd(id: string, by: string, note: string): Promise<LmAddRequest | null> {
  const request = (await listLmAddRequests(dataset.season)).find((row) => row.id === id);
  if (!request) return null;
  const next: LmAddRequest = { ...request, status: 'denied', note: note || 'Denied by the commissioner.', updatedAt: new Date().toISOString(), handledBy: by };
  await saveLmAddRequest(next);
  await appendAudit(by, 'lm.add.denied', { id, owner: request.owner, playerName: request.playerName, note: next.note });
  return next;
}

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
  firstTip,
  earlyDays,
  lmAddAllowed,
  lmAddText,
  lmAddWindow,
  pacific,
  waiverHourFor,
  waiverRunAt,
  waiverChangeText,
  waiverHourToHold,
  type DayGame,
  type EarlyDay,
  type LmAddCheck,
  type LmAddRequest,
  type LmAddWindow,
  type WaiverHour,
} from '../../src/lib/league/lmWeekend.js';
import { shortName } from '../../src/lib/league/format.js';
import {
  describeWrite,
  espnLmConfig,
  espnWriteTrouble,
  lmAdd,
  setWaiverHour,
  type EspnLmConfig,
} from './espnLm.js';
import { appendAudit, getState, listLmAddRequests, listTransactions, saveLmAddRequest, transitionLmClaim } from './leagueStore.js';
import { resolveCurrentPlayerPool } from './playerPoolService.js';
import { pullTransactions } from './transactionService.js';
import { claimPriority, claimReady } from '../../src/lib/league/lmClaims.js';
import { gamesForDays, gamesOn } from './nbaDay.js';
import { postToSlack } from './slack.js';

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
  await postToSlack(waiverChangeText(target, date, current, result.ok, note));
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
  if (result.ok && !result.dryRun) {
    const added: LmAddRequest = { ...request, status: 'added', note, updatedAt, handledBy: by };
    await postToSlack(lmAddText(added));
    return added;
  }
  if (result.dryRun) return { ...request, note: 'dry run: nothing sent to ESPN', updatedAt };
  if (request.status === 'processing' && result.status === null) return { ...request, note: `ESPN result is uncertain; ownership must be verified before retrying. ${note}`, updatedAt };
  if (result.authFailed) {
    await postToSlack(`LM add for ${request.owner} (${shortName(request.playerName)}) could not be sent: ${note}`);
    return { ...request, note, updatedAt };
  }
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
    if (['added', 'denied', 'queued', 'processing', 'cancelled'].includes(request.status)) continue;
    let next = request;
    if (request.forDate === pt.date && request.status !== 'failsafe') {
      if (window.open) next = await attemptAdd(config, request, null);
      else if (firstTip(games) && now.toISOString() >= firstTip(games)!) {
        next = { ...request, status: 'failsafe', note: 'Not added before the first tip. His points count today; the add goes through for tomorrow.', updatedAt: now.toISOString() };
        await postToSlack(lmAddText(next));
      }
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
  const adds = [...await runAdvanceLmClaims(config, now), ...await runAdds(config, now)];
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
  if ((await listLmAddRequests(dataset.season)).some(row => row.forDate === pt.date && row.playerId === playerId && ['queued', 'processing'].includes(row.status))) {
    throw new LmAddRefused('There is already an advance claim for this player. Join the advance queue so submission priority is preserved.', []);
  }
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
  if (['queued', 'processing', 'cancelled', 'denied', 'added'].includes(request.status)) return request;
  if (!config) return request;
  const next = await attemptAdd(config, request, by);
  await saveLmAddRequest(next);
  return next;
}

export async function denyLmAdd(id: string, by: string, note: string): Promise<LmAddRequest | null> {
  const request = (await listLmAddRequests(dataset.season)).find((row) => row.id === id);
  if (!request) return null;
  if (['queued', 'processing'].includes(request.status)) throw new LmAddRefused('Use claim cancellation before processing. A processing claim must finish verification first.', []);
  const next: LmAddRequest = { ...request, status: 'denied', note: note || 'Denied by the commissioner.', updatedAt: new Date().toISOString(), handledBy: by };
  await saveLmAddRequest(next);
  await appendAudit(by, 'lm.add.denied', { id, owner: request.owner, playerName: request.playerName, note: next.note });
  return next;
}


async function latestNormalWaiverAt(now: Date): Promise<string> {
  const date = pacific(now).date;
  const previous = new Date(`${date}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const yesterday = previous.toISOString().slice(0, 10);
  const [todayGames, yesterdayGames] = await Promise.all([gamesOn(date), gamesOn(yesterday)]);
  const todayRun = waiverRunAt(date, waiverHourFor(todayGames).hourPT);
  return todayRun <= now.toISOString() ? todayRun : waiverRunAt(yesterday, waiverHourFor(yesterdayGames).hourPT);
}

/** Save intent now; ownership and normal-waiver clearance are checked only when it can run. */
export async function queueLmClaim(owner: string, playerId: number, forDate: string, now = new Date()): Promise<LmAddRequest> {
  const team = dataset.teams.find(entry => entry.owner === owner);
  if (!team) throw new LmAddRefused('That owner has no team.', []);
  const today = pacific(now).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(forDate) || !Number.isFinite(Date.parse(`${forDate}T12:00:00Z`)) || new Date(`${forDate}T12:00:00Z`).toISOString().slice(0, 10) !== forDate) throw new LmAddRefused('Pick a valid LM Add date.', []);
  const distance = (Date.parse(`${forDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000;
  if (distance < 0 || distance > 35) throw new LmAddRefused('Choose a date from today through the next 35 days.', []);
  const weekday = new Date(`${forDate}T12:00:00Z`).getUTCDay();
  if (weekday !== 0 && weekday !== 6) throw new LmAddRefused('LM Adds are eligible on Saturdays and Sundays.', []);
  const games = await gamesOn(forDate);
  const tip = firstTip(games);
  const deadline = tip ? new Date(Date.parse(tip) - 10 * 60_000).toISOString() : null;
  if (!deadline) throw new LmAddRefused('No NBA games are scheduled on that date.', []);
  if (now.toISOString() >= deadline) throw new LmAddRefused('Claims closed 10 minutes before the earliest tip-off.', []);
  const existing = await listLmAddRequests(dataset.season);
  const duplicate = existing.find(row => row.owner === owner && row.playerId === playerId && row.forDate === forDate && ['queued', 'processing', 'added'].includes(row.status));
  if (duplicate) return duplicate;
  if (existing.filter(row => row.owner === owner && ['queued', 'processing'].includes(row.status)).length >= 30) throw new LmAddRefused('You already have 30 open claims. Cancel one before adding another.', []);
  const { state } = await getState();
  const pool = await resolveCurrentPlayerPool(state);
  const player = pool.players.find(entry => entry.espnId === playerId);
  if (!player) throw new LmAddRefused('Choose a player from the player list.', []);
  const request: LmAddRequest = { id: randomUUID(), season: dataset.season, owner, teamId: team.espnTeamId, playerId,
    playerName: player.fullName, proTeam: player.proTeam, requestedAt: now.toISOString(), forDate,
    status: 'queued', note: 'First submitted gets priority. Player must be free and have cleared normal waivers.', updatedAt: now.toISOString(), handledBy: null };
  await saveLmAddRequest(request);
  await appendAudit(owner, 'lm.claim.queued', { id: request.id, playerId, forDate });
  return request;
}

export async function cancelLmClaim(id: string, owner: string, commissioner: boolean, now = new Date()): Promise<LmAddRequest | null> {
  const request = (await listLmAddRequests(dataset.season)).find(row => row.id === id);
  if (!request) return null;
  if (request.owner !== owner && !commissioner) throw new LmAddRefused('You may cancel only your own claims.', []);
  if (request.status !== 'queued') throw new LmAddRefused('Only queued claims can be cancelled.', []);
  const cancelled: LmAddRequest = { ...request, status: 'cancelled', note: 'Cancelled before processing.', handledBy: owner, updatedAt: now.toISOString() };
  if (!await transitionLmClaim(cancelled, request)) throw new LmAddRefused('Claim changed while you were cancelling it. Refresh and try again.', []);
  await appendAudit(owner, 'lm.claim.cancelled', { id });
  return cancelled;
}

export interface ClaimRuntime {
  list: () => Promise<LmAddRequest[]>;
  save: (request: LmAddRequest) => Promise<void>;
  transition: (next: LmAddRequest, expected: LmAddRequest) => Promise<boolean>;
  games: (date: string) => Promise<DayGame[]>;
  facts: (id: number) => Promise<{ name: string; proTeam: string; onTeamId: number | null } | undefined>;
  drops: () => Promise<Map<number, string>>;
  lastRun: (now: Date) => Promise<string>;
  add: (request: LmAddRequest) => Promise<LmAddRequest>;
}

/** First-submitted queue. A CAS lease survives overlapping cron runs and uncertain ESPN replies. */
export async function runAdvanceLmClaims(config: EspnLmConfig, now = new Date(), runtime?: ClaimRuntime): Promise<LmClockRun['adds']> {
  const deps: ClaimRuntime = runtime ?? {
    list: () => listLmAddRequests(dataset.season), save: saveLmAddRequest, transition: transitionLmClaim,
    games: gamesOn, facts: async id => (await readClient(config).fetchPlayerFacts([id])).get(id),
    drops: async () => { const pull = await pullTransactions(); if (pull.error) throw new Error(pull.error); return lastDrops(); },
    lastRun: latestNormalWaiverAt, add: request => attemptAdd(config, request, null),
  };
  const today = pacific(now).date;
  const allRequests = await deps.list();
  const requests = allRequests.filter(row => ['queued', 'processing'].includes(row.status) && row.forDate <= today).sort(claimPriority);
  if (!requests.length) return [];
  const output: LmClockRun['adds'] = [];
  const weekday = pacific(now).weekday;
  const games = weekday === 0 || weekday === 6 ? await deps.games(today) : [];
  const beforeTip = firstTip(games) !== null && now.toISOString() < firstTip(games)!;
  let drops: Map<number, string> | null = null;
  let lastRun: string | null = null;
  if (beforeTip) [drops, lastRun] = await Promise.all([deps.drops(), deps.lastRun(now)]);
  const visited = new Set<number>();
  let attempts = 0;
  for (const request of requests) {
    if (attempts >= 3 || visited.has(request.playerId)) continue;
    if (request.status === 'queued' && allRequests.some(other => other.id !== request.id && other.forDate === request.forDate && other.playerId === request.playerId && other.status === 'added')) {
      const denied: LmAddRequest = { ...request, status: 'denied', note: 'This player was already awarded for this LM Add day.', updatedAt: now.toISOString() };
      if (await deps.transition(denied, request)) output.push({ id: denied.id, status: denied.status, note: denied.note });
      continue;
    }
    if (request.status === 'processing' && Date.parse(request.updatedAt) > now.getTime() - 2 * 60_000) continue;
    if (request.status === 'queued' && (request.forDate < today || !beforeTip)) {
      const expired: LmAddRequest = { ...request, status: 'denied', updatedAt: now.toISOString(), note: 'The eligible LM Add window ended before this claim could be awarded.' };
      if (await deps.transition(expired, request)) output.push({ id: expired.id, status: expired.status, note: expired.note });
      continue;
    }
    const lease: LmAddRequest = { ...request, status: 'processing', updatedAt: now.toISOString(), note: 'Checking ownership and normal-waiver clearance.' };
    if (!await deps.transition(lease, request)) continue;
    attempts++;
    visited.add(request.playerId);
    try {
      const facts = await deps.facts(request.playerId);
      if (!facts || facts.onTeamId === null) { await deps.save({ ...lease, note: 'Ownership is unknown. Waiting for verified ESPN data.' }); continue; }
      if (request.status === 'processing' && facts.onTeamId === request.teamId) {
        const recovered: LmAddRequest = { ...lease, status: 'added', note: 'ESPN confirms the player is on your team after the interrupted attempt.' };
        await deps.save(recovered); output.push({ id: recovered.id, status: recovered.status, note: recovered.note }); continue;
      }
      const decision = beforeTip && drops && lastRun ? claimReady({ request, now, games, onTeamId: facts.onTeamId, proTeam: facts.proTeam, lastDroppedAt: drops.get(request.playerId) ?? null, lastWaiverAt: lastRun }) : { action: 'deny', note: 'The eligible LM Add window has ended.' };
      if (decision.action !== 'ready') {
        const next: LmAddRequest = { ...lease, status: decision.action === 'deny' ? 'denied' : 'queued', note: decision.note };
        await deps.save(next); output.push({ id: next.id, status: next.status, note: next.note }); continue;
      }
      const result = await deps.add({ ...lease, proTeam: facts.proTeam });
      const next: LmAddRequest = result.status === 'added' || (result.status === 'processing' && !result.note.startsWith('dry run')) ? result : { ...result, status: 'queued' };
      await deps.save(next); output.push({ id: next.id, status: next.status, note: next.note });
    } catch (error) {
      // Leave the lease in processing: the write may have succeeded. The next
      // worker verifies actual ownership before it considers sending again.
      await deps.save({ ...lease, note: `Needs verification after an interrupted attempt: ${error instanceof Error ? error.message : 'unknown error'}` });
    }
  }
  return output;
}

/** The minute clock does only claim processing; waiver-hour maintenance stays on its existing clock. */
export async function runLmClaimClock(now = new Date()): Promise<LmClockRun['adds']> {
  const weekday = pacific(now).weekday;
  if (weekday !== 0 && weekday !== 6) return [];
  const config = espnLmConfig();
  return config ? runAdvanceLmClaims(config, now) : [];
}

import { shortName } from './format.js';
/**
 * The weekend league-manager rules, as the app runs them.
 *
 * Two jobs. First, the waiver hour: ESPN runs waivers at one fixed hour a
 * day, and the league wants it ahead of the first tip whenever games start
 * early. Brey's rule: if the first tip of the day is before 4 PM Pacific,
 * waivers run one hour before that tip; otherwise 3 PM Pacific. Weekends and
 * some holidays are the early days.
 *
 * Second, LM adds (rule `transactions.waivers.lmadd`): on Saturdays and
 * Sundays a member may ask for a player to be added by the league manager,
 * if the player cleared a night of bidding, plays that day, the request is
 * public, there is roster space, and it comes before the first tip. If the
 * add does not happen in time, the points count anyway (`lmadd.failsafe`).
 *
 * ESPN stores the waiver hour in Eastern time. Everything here speaks
 * Pacific, and converts at the edge.
 *
 * Pure. No server, no browser.
 */

/** One NBA game on one day. Team codes as the app uses them (GSW, NYK, UTA). */
export interface DayGame {
  home: string;
  away: string;
  /** Tip-off, ISO. */
  tipoff: string;
}

/** Waivers run at this hour, Pacific, on a normal day. ESPN stores 18 Eastern. */
export const NORMAL_WAIVER_HOUR_PT = 15;

/** A first tip before this hour, Pacific, makes an early day. */
export const EARLY_TIP_CUTOFF_PT = 16;

/** Pacific is three hours behind Eastern, in both halves of the year. */
export const EASTERN_OFFSET_HOURS = 3;

const PACIFIC = 'America/Los_Angeles';

export interface PacificMoment {
  /** YYYY-MM-DD in Pacific. */
  date: string;
  /** 0 to 23. */
  hour: number;
  minute: number;
  /** 0 = Sunday, 6 = Saturday. */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The date, clock and weekday of a moment, in Pacific time. */
export function pacific(iso: string | Date): PacificMoment {
  const at = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute: Number(get('minute')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

export function isWeekend(moment: PacificMoment): boolean {
  return moment.weekday === 0 || moment.weekday === 6;
}

/** The earliest tip-off among the day's games, ISO, or null with no games. */
export function firstTip(games: readonly DayGame[]): string | null {
  let first: string | null = null;
  for (const game of games) {
    if (!Number.isFinite(Date.parse(game.tipoff))) continue;
    if (first === null || game.tipoff < first) first = game.tipoff;
  }
  return first;
}

export interface WaiverHour {
  /** The hour waivers should run that day, Pacific, 0 to 23. */
  hourPT: number;
  /** What ESPN stores: the same hour in Eastern time. */
  hourET: number;
  /** True when the first tip moved it. */
  early: boolean;
  firstTip: string | null;
}

/** Pacific hour to the Eastern hour ESPN stores. */
export function easternHour(hourPT: number): number {
  return (hourPT + EASTERN_OFFSET_HOURS) % 24;
}

/**
 * Brey's rule for one day. A first tip before 4 PM Pacific means waivers run
 * one hour before it, on the hour (a 12:30 tip runs them at 11). Otherwise
 * 3 PM.
 */
export function waiverHourFor(games: readonly DayGame[]): WaiverHour {
  const tip = firstTip(games);
  if (tip !== null) {
    const at = pacific(tip);
    if (at.hour < EARLY_TIP_CUTOFF_PT) {
      const hourPT = Math.max(0, at.hour - 1);
      return { hourPT, hourET: easternHour(hourPT), early: true, firstTip: tip };
    }
  }
  return { hourPT: NORMAL_WAIVER_HOUR_PT, hourET: easternHour(NORMAL_WAIVER_HOUR_PT), early: false, firstTip: tip };
}

/**
 * The hour ESPN should hold right now, given today's and tomorrow's hours.
 *
 * ESPN runs waivers once a day at whatever hour it holds. Change it to an
 * hour still ahead today and it runs again today. So the switch to
 * tomorrow's hour waits until two things are true: today's run has passed,
 * and tomorrow's hour has passed too. A normal Monday before an 11 AM
 * Tuesday switches at 4 PM Monday. An 11 AM Tuesday before a normal
 * Wednesday switches at 4 PM Tuesday, not at noon.
 */
export function waiverHourToHold(now: PacificMoment, today: WaiverHour, tomorrow: WaiverHour): WaiverHour {
  if (now.hour <= today.hourPT) return today;
  if (now.hour <= tomorrow.hourPT) return today;
  return tomorrow;
}

export interface EarlyDay {
  /** YYYY-MM-DD Pacific. */
  date: string;
  hourPT: number;
  firstTip: string;
}

/** The early days in a set of dated game lists, in date order. */
export function earlyDays(gamesByDate: Readonly<Record<string, readonly DayGame[]>>): EarlyDay[] {
  const days: EarlyDay[] = [];
  for (const date of Object.keys(gamesByDate).sort()) {
    const hour = waiverHourFor(gamesByDate[date]);
    if (hour.early && hour.firstTip) days.push({ date, hourPT: hour.hourPT, firstTip: hour.firstTip });
  }
  return days;
}

// ─── LM adds ────────────────────────────────────────────────────────────────

export interface LmAddWindow {
  open: boolean;
  /** Why it is closed, in words, or null while open. */
  reason: string | null;
  /** Today's first tip, ISO, when there is one. The window closes then. */
  closesAt: string | null;
}

/** Saturdays and Sundays, Pacific, before the first tip. */
export function lmAddWindow(now: string | Date, todaysGames: readonly DayGame[]): LmAddWindow {
  const at = pacific(now);
  const tip = firstTip(todaysGames);
  if (!isWeekend(at)) return { open: false, reason: 'LM adds are for Saturdays and Sundays.', closesAt: tip };
  if (tip === null) return { open: false, reason: 'No NBA games today, so no LM adds.', closesAt: null };
  const nowIso = typeof now === 'string' ? new Date(now).toISOString() : now.toISOString();
  if (nowIso >= tip) return { open: false, reason: 'The first game has tipped off. LM adds closed for today.', closesAt: tip };
  return { open: true, reason: null, closesAt: tip };
}

export type LmAddStatus = 'requested' | 'waiting-for-drop' | 'added' | 'failsafe' | 'denied';

export interface LmAddRequest {
  id: string;
  season: number;
  owner: string;
  teamId: number;
  playerId: number;
  playerName: string;
  proTeam: string;
  /** ISO. */
  requestedAt: string;
  /** The Pacific date the add is for. */
  forDate: string;
  status: LmAddStatus;
  /** What ESPN said last, or what the app decided. */
  note: string;
  /** ISO, when the status last changed. */
  updatedAt: string;
  /** Who denied or retried it. */
  handledBy: string | null;
}

export interface LmAddCheck {
  /** The rule id, as the rulebook numbers it. */
  rule: string;
  text: string;
  ok: boolean;
  /** Why it failed, when it did. */
  detail: string | null;
}

export interface LmAddContext {
  now: string | Date;
  todaysGames: readonly DayGame[];
  /** The player's NBA team code. */
  proTeam: string;
  /** ESPN's current holder of the player: 0 for a free agent, null when unknown. */
  onTeamId: number | null;
  /** When he was last dropped, ISO, or null if never this season. */
  lastDroppedAt: string | null;
}

/**
 * The night of bidding a dropped player must clear: yesterday's waiver run,
 * at the normal hour, Pacific. A drop before it went through one run
 * unclaimed. A drop after it did not.
 */
export function lastWaiverRunBefore(now: string | Date): string {
  const at = typeof now === 'string' ? new Date(now) : now;
  const today = pacific(at);
  // Build yesterday 3 PM Pacific from today's Pacific date, then walk the
  // UTC offset: Pacific is UTC-7 or UTC-8, and the hour we want is far from
  // midnight, so either guess lands on the right calendar day.
  const yesterday = new Date(`${today.date}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const guess = new Date(`${yesterday.toISOString().slice(0, 10)}T${String(NORMAL_WAIVER_HOUR_PT).padStart(2, '0')}:00:00-08:00`);
  const check = pacific(guess);
  if (check.hour !== NORMAL_WAIVER_HOUR_PT) guess.setUTCHours(guess.getUTCHours() + (NORMAL_WAIVER_HOUR_PT - check.hour));
  return guess.toISOString();
}

/** Every condition of rule `transactions.waivers.lmadd`, pass or fail. */
export function checkLmAdd(ctx: LmAddContext): LmAddCheck[] {
  const window = lmAddWindow(ctx.now, ctx.todaysGames);
  const plays = ctx.todaysGames.some((game) => game.home === ctx.proTeam || game.away === ctx.proTeam);
  const cleared = ctx.lastDroppedAt === null || ctx.lastDroppedAt < lastWaiverRunBefore(ctx.now);
  const free = ctx.onTeamId === null || ctx.onTeamId === 0;
  return [
    {
      rule: 'transactions.waivers.lmadd.timing',
      text: 'Saturday or Sunday, before the first tip',
      ok: window.open,
      detail: window.reason,
    },
    {
      rule: 'transactions.waivers.lmadd.playing',
      text: 'His team plays today',
      ok: plays,
      detail: plays ? null : `${ctx.proTeam || 'His team'} does not play today.`,
    },
    {
      rule: 'transactions.waivers.lmadd.cleared',
      text: 'Cleared a night of bidding unclaimed',
      ok: cleared,
      detail: cleared ? null : 'He was dropped too recently. He has to sit through a waiver run first.',
    },
    {
      rule: 'transactions.waivers.lmadd.space',
      text: 'A free agent, and you have roster space',
      ok: free,
      detail: free ? null : 'He is on a team already.',
    },
  ];
}

export function lmAddAllowed(checks: readonly LmAddCheck[]): boolean {
  return checks.every((check) => check.ok);
}

/** "Mon, Oct 20" for a Pacific date, for a post. */
function dateWords(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Waivers now run at 11 AM Pacific for Tue, Oct 20 (first tip 12:00 PM). Was 3 PM." */
export function waiverChangeText(target: WaiverHour, forDate: string, wasET: number | null, ok: boolean, note: string): string {
  const tip = target.firstTip
    ? ` (first tip ${new Date(target.firstTip).toLocaleTimeString('en-US', { timeZone: PACIFIC, hour: 'numeric', minute: '2-digit' })})`
    : '';
  const was = wasET === null ? '' : ` Was ${hourLabel((wasET - EASTERN_OFFSET_HOURS + 24) % 24)}.`;
  if (!ok) return `Waiver hour change failed: wanted ${hourLabel(target.hourPT)} Pacific for ${dateWords(forDate)}. ${note}`;
  return `Waivers now run at ${hourLabel(target.hourPT)} Pacific for ${dateWords(forDate)}${tip}.${was}`;
}

/** The feed line for one request. */
export function lmAddText(request: Pick<LmAddRequest, 'owner' | 'playerName' | 'proTeam' | 'status'>): string {
  const who = request.proTeam ? `${shortName(request.playerName)} (${request.proTeam})` : shortName(request.playerName);
  switch (request.status) {
    case 'added': return `${request.owner}: LM add ${who}, added`;
    case 'waiting-for-drop': return `${request.owner}: LM add ${who}, waiting for a drop`;
    case 'failsafe': return `${request.owner}: LM add ${who}, failsafe: his points count today`;
    case 'denied': return `${request.owner}: LM add ${who}, denied`;
    default: return `${request.owner}: LM add ${who}, requested`;
  }
}

/** "11 AM" for a Pacific hour. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

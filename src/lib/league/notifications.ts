/**
 * Deciding which reminder emails are due.
 *
 * All of it is pure. The caller passes the time, the draft date, who has
 * saved keepers and what has already gone out, and gets back a list of
 * emails to send. Nothing here reads a clock, a database or a network, so
 * the awkward cases are cheap to test: the hour a window opens, the hour it
 * closes, and a server that wakes up late.
 *
 * The rule that matters most: a reminder goes out once. The caller records
 * each send and passes those keys back next time. A cron that fires twice,
 * or a deploy that replays an hour, must not mail ten people twice.
 */

/** Keepers must be in a day before the draft. See rule keepers.select.deadline. */
export const KEEPER_DEADLINE_HOURS_BEFORE_DRAFT = 24;

const HOUR = 60 * 60 * 1000;

export type ReminderKind =
  | 'draft-week'
  | 'draft-day'
  | 'keepers-5-days'
  | 'keepers-2-days'
  | 'keepers-1-day'
  | 'keepers-last-call';

export interface ReminderWindow {
  kind: ReminderKind;
  /** Hours before the moment this reminder counts down to. */
  hoursBefore: number;
}

/**
 * Two warnings for the draft, four for the keeper deadline.
 *
 * The keeper ones count down to the deadline, which is a day earlier than the
 * draft. With the deadline at Saturday 2pm Pacific they land Monday 2pm,
 * Thursday 2pm, Friday 2pm and Saturday 8am. Every owner gets them, saved or
 * not; the words change with whether they have saved.
 *
 * A window stays open until the next one for the same deadline opens. So a
 * server that slept, or an address added late, sends the newest warning once
 * instead of a pile of stale ones.
 */
export const REMINDERS: ReminderWindow[] = [
  { kind: 'draft-week', hoursBefore: 24 * 7 },
  { kind: 'keepers-5-days', hoursBefore: 24 * 5 },
  { kind: 'keepers-2-days', hoursBefore: 24 * 2 },
  { kind: 'keepers-1-day', hoursBefore: 24 },
  { kind: 'draft-day', hoursBefore: 24 },
  { kind: 'keepers-last-call', hoursBefore: 6 },
];

function isKeeperKind(kind: ReminderKind): boolean {
  return kind.startsWith('keepers-');
}

export function keeperDeadline(draftAt: Date): Date {
  return new Date(draftAt.getTime() - KEEPER_DEADLINE_HOURS_BEFORE_DRAFT * HOUR);
}

/** What each reminder counts down to. */
function targetFor(kind: ReminderKind, draftAt: Date): Date {
  return isKeeperKind(kind) ? keeperDeadline(draftAt) : draftAt;
}

/**
 * When a window shuts: when the next window for the same deadline opens, or
 * at the deadline itself.
 */
function closesAt(window: ReminderWindow, draftAt: Date): number {
  const target = targetFor(window.kind, draftAt).getTime();
  const later = REMINDERS.filter(
    (other) => isKeeperKind(other.kind) === isKeeperKind(window.kind) && other.hoursBefore < window.hoursBefore,
  );
  if (later.length === 0) return target;
  return target - Math.max(...later.map((other) => other.hoursBefore)) * HOUR;
}

/**
 * One reminder for one owner, already decided. The key is what the caller
 * stores so the same reminder never goes twice.
 */
export interface DueReminder {
  kind: ReminderKind;
  owner: string;
  key: string;
  /** Whole hours left until the thing being warned about. Never negative. */
  hoursLeft: number;
  deadlineAt: string;
  /** Whether this owner has at least one keeper saved. */
  keepersSaved: boolean;
}

export function reminderKey(kind: ReminderKind, owner: string, season: number): string {
  return `${season}:${kind}:${owner}`;
}

export interface ReminderInput {
  now: Date;
  draftAt: Date;
  season: number;
  /** Everyone who could be mailed. An owner with no address is left out here. */
  owners: string[];
  /** Owners with at least one keeper saved. */
  ownersWithKeepers: string[];
  /** Keys already sent, from the store. */
  alreadySent: string[];
}

/**
 * Which reminders should go out right now.
 *
 * A reminder becomes due once the clock is inside its window and stays due
 * until the next window for the same deadline opens. That means a server
 * which was asleep still sends a late warning rather than skipping it, which
 * is the right way round: a late "keepers close in a few hours" is useful, a
 * silent miss is not. Once the deadline passes, nothing more goes out about it.
 */
export function dueReminders(input: ReminderInput): DueReminder[] {
  const sent = new Set(input.alreadySent);
  const withKeepers = new Set(input.ownersWithKeepers);
  const due: DueReminder[] = [];

  for (const window of REMINDERS) {
    const target = targetFor(window.kind, input.draftAt);
    const opensAt = target.getTime() - window.hoursBefore * HOUR;
    const msLeft = target.getTime() - input.now.getTime();
    if (input.now.getTime() < opensAt) continue;
    if (input.now.getTime() >= closesAt(window, input.draftAt)) continue;

    for (const owner of input.owners) {
      const key = reminderKey(window.kind, owner, input.season);
      if (sent.has(key)) continue;
      due.push({
        kind: window.kind,
        owner,
        key,
        // Rounded, not floored: a cron that fires a minute late should still
        // say "1 day", not "23 hours".
        hoursLeft: Math.max(0, Math.round(msLeft / HOUR)),
        deadlineAt: target.toISOString(),
        keepersSaved: withKeepers.has(owner),
      });
    }
  }
  return due;
}

/**
 * Whether any reminder window is open right now, whoever it is for.
 *
 * The clock asks this before it opens the database. Outside the week before
 * the draft the answer is no, and the hourly run ends without waking it.
 */
export function anyReminderWindowOpen(now: Date, draftAt: Date): boolean {
  return REMINDERS.some((window) => {
    const target = targetFor(window.kind, draftAt).getTime();
    return now.getTime() >= target - window.hoursBefore * HOUR && now.getTime() < target;
  });
}

/** How long is left, for a person to read. "3 days", "6 hours", "under an hour". */
export function humanCountdown(hoursLeft: number): string {
  if (hoursLeft < 1) return 'under an hour';
  if (hoursLeft < 24) return hoursLeft === 1 ? '1 hour' : `${hoursLeft} hours`;
  const days = Math.round(hoursLeft / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

export interface ReminderCopy {
  subject: string;
  heading: string;
  body: string;
}

/** "Saturday, October 17 at 2:00 PM Pacific". The league says dates in Pacific. */
export function pacificLabel(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const time = at.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${day} at ${time} Pacific`;
}

/** The words for each reminder. Kept here so the tests can read them. */
export function reminderCopy(reminder: DueReminder): ReminderCopy {
  const left = humanCountdown(reminder.hoursLeft);
  if (isKeeperKind(reminder.kind)) {
    const lastCall = reminder.kind === 'keepers-last-call';
    const when = `Keepers lock ${pacificLabel(reminder.deadlineAt)}.`;
    return {
      subject: lastCall ? `Last call: keepers are due in ${left}` : `Keepers are due in ${left}`,
      heading: `Keepers due in ${left}`,
      body: reminder.keepersSaved
        ? `${when} Yours are saved. You can change them until then.`
        : `${when} You have none saved. Pick two, one, or none, but save it so the commish knows.`,
    };
  }
  if (reminder.kind === 'draft-week') {
    return {
      subject: `The draft is in ${left}`,
      heading: `Draft in ${left}`,
      body: 'Check your keepers and your picks before the room fills up.',
    };
  }
  return {
    subject: `The draft is in ${left}`,
    heading: `Draft in ${left}`,
    body: 'Last look at the board. Keepers are already closed.',
  };
}

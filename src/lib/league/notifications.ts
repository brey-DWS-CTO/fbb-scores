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

export type ReminderKind = 'draft-week' | 'draft-day' | 'keepers-soon' | 'keepers-last-call';

export interface ReminderWindow {
  kind: ReminderKind;
  /** Hours before the moment this reminder counts down to. */
  hoursBefore: number;
  /** Only owners with no keepers saved get it. */
  keeperlessOnly: boolean;
}

/**
 * Two warnings for the draft, two for the keeper deadline.
 *
 * The keeper ones count down to the deadline, which is a day earlier than the
 * draft, so "12 hours before keepers close" is 36 hours before the draft.
 */
export const REMINDERS: ReminderWindow[] = [
  { kind: 'draft-week', hoursBefore: 24 * 7, keeperlessOnly: false },
  { kind: 'keepers-soon', hoursBefore: 24 * 3, keeperlessOnly: true },
  { kind: 'draft-day', hoursBefore: 24, keeperlessOnly: false },
  { kind: 'keepers-last-call', hoursBefore: 12, keeperlessOnly: true },
];

export function keeperDeadline(draftAt: Date): Date {
  return new Date(draftAt.getTime() - KEEPER_DEADLINE_HOURS_BEFORE_DRAFT * HOUR);
}

/** What each reminder counts down to. */
function targetFor(kind: ReminderKind, draftAt: Date): Date {
  return kind === 'draft-week' || kind === 'draft-day' ? draftAt : keeperDeadline(draftAt);
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
 * until the moment it counts down to. That means a server which was asleep
 * still sends a late warning rather than skipping it, which is the right way
 * round: a late "keepers close in a few hours" is useful, a silent miss is
 * not. Once the deadline passes, nothing more goes out about it.
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
    if (msLeft <= 0) continue;

    for (const owner of input.owners) {
      if (window.keeperlessOnly && withKeepers.has(owner)) continue;
      const key = reminderKey(window.kind, owner, input.season);
      if (sent.has(key)) continue;
      due.push({
        kind: window.kind,
        owner,
        key,
        hoursLeft: Math.max(0, Math.floor(msLeft / HOUR)),
        deadlineAt: target.toISOString(),
      });
    }
  }
  return due;
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

/** The words for each reminder. Kept here so the tests can read them. */
export function reminderCopy(reminder: DueReminder): ReminderCopy {
  const left = humanCountdown(reminder.hoursLeft);
  switch (reminder.kind) {
    case 'draft-week':
      return {
        subject: `The draft is in ${left}`,
        heading: `Draft in ${left}`,
        body: 'Check your keepers and your picks before the room fills up.',
      };
    case 'draft-day':
      return {
        subject: `The draft is in ${left}`,
        heading: `Draft in ${left}`,
        body: 'Last look at the board. Keepers are already closed.',
      };
    case 'keepers-soon':
      return {
        subject: `Your keepers are due in ${left}`,
        heading: `Keepers close in ${left}`,
        body: 'You have not saved any keepers. Pick two, one, or none, but save it so the commish knows.',
      };
    case 'keepers-last-call':
      return {
        subject: `Last call: keepers close in ${left}`,
        heading: `Keepers close in ${left}`,
        body: 'Still nothing saved for your team. After this the roster you had is what you get.',
      };
  }
}

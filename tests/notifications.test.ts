import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anyReminderWindowOpen,
  dueReminders,
  humanCountdown,
  keeperDeadline,
  reminderCopy,
  reminderKey,
  type DueReminder,
} from '../src/lib/league/notifications.js';

const SEASON = 2027;
const OWNERS = ['Brey', 'Joel', 'Amy'];
/** The real draft: Sunday 18 October 2026, 2pm Pacific. */
const DRAFT_AT = new Date('2026-10-18T14:00:00-07:00');
const HOUR = 60 * 60 * 1000;

/** now, expressed as hours before the draft. */
const before = (hours: number) => new Date(DRAFT_AT.getTime() - hours * HOUR);

function run(options: {
  hoursBeforeDraft: number;
  withKeepers?: string[];
  alreadySent?: string[];
}): DueReminder[] {
  return dueReminders({
    now: before(options.hoursBeforeDraft),
    draftAt: DRAFT_AT,
    season: SEASON,
    owners: OWNERS,
    ownersWithKeepers: options.withKeepers ?? [],
    alreadySent: options.alreadySent ?? [],
  });
}

const kinds = (list: DueReminder[]) => [...new Set(list.map((r) => r.kind))].sort();
const owners = (list: DueReminder[], kind: string) =>
  list.filter((r) => r.kind === kind).map((r) => r.owner).sort();

// ─── The deadline itself ─────────────────────────────────────────────────────

test('keepers are due a day before the draft, not two hours', () => {
  const deadline = keeperDeadline(DRAFT_AT);
  assert.equal(deadline.toISOString(), new Date('2026-10-17T14:00:00-07:00').toISOString());
  assert.equal((DRAFT_AT.getTime() - deadline.getTime()) / HOUR, 24);
});

// ─── When each reminder opens ────────────────────────────────────────────────

test('nothing goes out a month ahead', () => {
  assert.deepEqual(run({ hoursBeforeDraft: 24 * 30 }), []);
});

test('the first warning is a week before the draft', () => {
  assert.deepEqual(run({ hoursBeforeDraft: 24 * 7 + 1 }), [], 'an hour too early');
  assert.deepEqual(kinds(run({ hoursBeforeDraft: 24 * 7 })), ['draft-week'], 'exactly a week out');
});

test('the keeper warning counts down to the deadline, not the draft', () => {
  // Five days before the deadline is six days before the draft.
  assert.ok(!kinds(run({ hoursBeforeDraft: 24 * 6 + 1 })).includes('keepers-5-days'));
  assert.ok(kinds(run({ hoursBeforeDraft: 24 * 6 })).includes('keepers-5-days'));
});

/** A Pacific wall-clock time in draft week. PDT is seven hours behind UTC. */
const pacific = (stamp: string) => new Date(`${stamp}-07:00`);
const keeperKindsAt = (now: Date): string[] =>
  dueReminders({
    now,
    draftAt: DRAFT_AT,
    season: SEASON,
    owners: OWNERS,
    ownersWithKeepers: [],
    alreadySent: [],
  })
    .map((r) => r.kind)
    .filter((kind) => kind.startsWith('keepers-'));

test('keeper mail lands Monday, Thursday and Friday at 2pm and Saturday at 8am', () => {
  const opens: [string, string][] = [
    ['2026-10-12T14:00:00', 'keepers-5-days'],
    ['2026-10-15T14:00:00', 'keepers-2-days'],
    ['2026-10-16T14:00:00', 'keepers-1-day'],
    ['2026-10-17T08:00:00', 'keepers-last-call'],
  ];
  for (const [stamp, kind] of opens) {
    const minuteBefore = new Date(pacific(stamp).getTime() - 60_000);
    assert.ok(!keeperKindsAt(minuteBefore).includes(kind), `${kind} not before ${stamp}`);
    assert.deepEqual(keeperKindsAt(pacific(stamp)), [kind, kind, kind], `${kind} at ${stamp}`);
  }
  assert.deepEqual(keeperKindsAt(pacific('2026-10-12T13:59:00')), [], 'nothing on Monday morning');
  assert.deepEqual(keeperKindsAt(pacific('2026-10-17T14:00:00')), [], 'nothing once they lock');
});

test('the day-before warning opens a day before the draft', () => {
  assert.ok(!kinds(run({ hoursBeforeDraft: 25 })).includes('draft-day'));
  assert.ok(kinds(run({ hoursBeforeDraft: 24 })).includes('draft-day'));
});

// ─── Who gets what ───────────────────────────────────────────────────────────

test('keeper warnings skip owners who have saved', () => {
  const list = run({ hoursBeforeDraft: 30, withKeepers: ['Brey'] });
  assert.deepEqual(owners(list, 'keepers-last-call'), ['Amy', 'Joel']);
});

test('draft warnings still go to owners who have saved', () => {
  const list = run({ hoursBeforeDraft: 24, withKeepers: ['Brey', 'Joel', 'Amy'] });
  assert.deepEqual(owners(list, 'draft-day'), ['Amy', 'Brey', 'Joel']);
  assert.ok(!list.some((r) => r.kind.startsWith('keepers-')));
});

test('the warning tells an unsaved owner when keepers are due', () => {
  const list = run({ hoursBeforeDraft: 30, withKeepers: ['Brey'] });
  const amy = list.find((r) => r.kind === 'keepers-last-call' && r.owner === 'Amy');
  assert.ok(amy);
  const amyCopy = reminderCopy(amy);
  assert.equal(amyCopy.subject, 'Last call: You have no keepers saved. Due in 6 hours.');
  assert.match(amyCopy.lines[0], /Saturday, October 17 at 2:00 PM Pacific/);
});

test('keeper mail never tells an owner to lock anything', () => {
  for (const reminder of run({ hoursBeforeDraft: 30, withKeepers: ['Brey'] })) {
    if (!reminder.kind.startsWith('keepers-')) continue;
    const copy = reminderCopy(reminder);
    assert.ok(!/lock (it|them|your)/i.test([copy.subject, ...copy.lines].join(' ')));
  }
});

// ─── Sending once ────────────────────────────────────────────────────────────

test('a reminder already sent is not sent again', () => {
  const first = run({ hoursBeforeDraft: 24 * 5 });
  assert.equal(first.length, 6, 'one draft-week and one keeper warning each');
  const second = run({ hoursBeforeDraft: 24 * 5, alreadySent: first.map((r) => r.key) });
  assert.deepEqual(second, [], 'the next tick sends nothing');
});

test('one owner having been mailed does not stop the others', () => {
  const list = run({
    hoursBeforeDraft: 24 * 5,
    alreadySent: [reminderKey('draft-week', 'Brey', SEASON)],
  });
  assert.deepEqual(owners(list, 'draft-week'), ['Amy', 'Joel']);
});

test('the key names the season, so next year starts clean', () => {
  const list = run({
    hoursBeforeDraft: 24 * 5,
    alreadySent: [`2026:draft-week:Brey`],
  });
  assert.equal(owners(list, 'draft-week').length, 3, 'last season is not this season');
});

// ─── After the fact ──────────────────────────────────────────────────────────

test('a late server sends the newest warning, not a pile of old ones', () => {
  // Nothing ran for days, and now there are six hours left before keepers close.
  const list = run({ hoursBeforeDraft: 30 });
  assert.deepEqual(kinds(list), ['draft-week', 'keepers-last-call']);
  assert.equal(owners(list, 'keepers-last-call').length, 3, 'one each');
});

test('a warning left unsent shuts when the next one opens', () => {
  // The Monday warning never went to anyone, and it is now Thursday 2pm.
  const list = run({ hoursBeforeDraft: 24 * 3 });
  assert.ok(!kinds(list).includes('keepers-5-days'));
  assert.ok(kinds(list).includes('keepers-2-days'));
});

test('once keepers close, no more keeper mail', () => {
  const list = run({ hoursBeforeDraft: 23 });
  assert.deepEqual(kinds(list), ['draft-day'], 'the draft is still ahead');
});

test('once the draft starts, nothing goes out at all', () => {
  assert.deepEqual(run({ hoursBeforeDraft: 0 }), []);
  assert.deepEqual(run({ hoursBeforeDraft: -5 }), []);
});

// ─── Words ───────────────────────────────────────────────────────────────────

test('a cron a minute late still says a whole day', () => {
  const list = run({ hoursBeforeDraft: 48 - 1 / 60 });
  const friday = list.find((r) => r.kind === 'keepers-1-day');
  assert.equal(friday?.hoursLeft, 24);
  assert.equal(friday && reminderCopy(friday).subject, 'You have no keepers saved. Due in 1 day.');
});

test('the countdown reads like a person wrote it', () => {
  assert.equal(humanCountdown(0), 'under an hour');
  assert.equal(humanCountdown(1), '1 hour');
  assert.equal(humanCountdown(6), '6 hours');
  assert.equal(humanCountdown(24), '1 day');
  assert.equal(humanCountdown(72), '3 days');
  assert.equal(humanCountdown(168), '7 days');
});

test('every reminder has a subject and no em dash', () => {
  const list = run({ hoursBeforeDraft: 36 });
  assert.ok(list.length > 0);
  for (const reminder of list) {
    const copy = reminderCopy(reminder);
    assert.ok(copy.subject.length > 0 && copy.heading.length > 0 && copy.lines.length > 0);
    for (const line of [copy.subject, copy.heading, ...copy.lines]) {
      assert.ok(!line.includes('—'), `em dash in: ${line}`);
    }
  }
});

test('hoursLeft counts to the right deadline for each kind', () => {
  const list = run({ hoursBeforeDraft: 36 });
  const keeperOne = list.find((r) => r.kind === 'keepers-1-day');
  const draftOne = list.find((r) => r.kind === 'draft-week');
  assert.equal(keeperOne?.hoursLeft, 12, 'keepers close in twelve hours');
  assert.equal(draftOne?.hoursLeft, 36, 'the draft is still a day and a half away');
});

/* ─── Whether the clock needs the database at all ─────────────────────── */

test('no window is open more than a week out, so the clock stays off the database', () => {
  assert.equal(anyReminderWindowOpen(before(24 * 7 + 1), DRAFT_AT), false);
  assert.equal(anyReminderWindowOpen(new Date('2026-09-28T12:00:00Z'), DRAFT_AT), false);
});

test('the week warning opens the first window, to the hour', () => {
  assert.equal(anyReminderWindowOpen(before(24 * 7), DRAFT_AT), true);
  assert.equal(anyReminderWindowOpen(before(30), DRAFT_AT), true);
  assert.equal(anyReminderWindowOpen(before(1), DRAFT_AT), true);
});

test('once the draft starts, every window is shut', () => {
  assert.equal(anyReminderWindowOpen(before(0), DRAFT_AT), false);
  assert.equal(anyReminderWindowOpen(before(-5), DRAFT_AT), false);
});

test('the window check agrees with the reminder list at every hour of draft week', () => {
  for (let hours = 24 * 8; hours >= -2; hours -= 1) {
    const due = run({ hoursBeforeDraft: hours }).length > 0;
    assert.equal(anyReminderWindowOpen(before(hours), DRAFT_AT), due, `${hours} hours out`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
  // Three days before the deadline is four days before the draft.
  assert.ok(!kinds(run({ hoursBeforeDraft: 24 * 4 + 1 })).includes('keepers-soon'));
  assert.ok(kinds(run({ hoursBeforeDraft: 24 * 4 })).includes('keepers-soon'));
});

test('last call opens twelve hours before keepers close', () => {
  assert.ok(!kinds(run({ hoursBeforeDraft: 37 })).includes('keepers-last-call'));
  assert.ok(kinds(run({ hoursBeforeDraft: 36 })).includes('keepers-last-call'));
});

test('the day-before warning opens a day before the draft', () => {
  assert.ok(!kinds(run({ hoursBeforeDraft: 25 })).includes('draft-day'));
  assert.ok(kinds(run({ hoursBeforeDraft: 24 })).includes('draft-day'));
});

// ─── Who gets what ───────────────────────────────────────────────────────────

test('keeper warnings skip anyone who has already saved', () => {
  const list = run({ hoursBeforeDraft: 30, withKeepers: ['Brey'] });
  assert.deepEqual(owners(list, 'keepers-soon'), ['Amy', 'Joel']);
  assert.deepEqual(owners(list, 'draft-week'), ['Amy', 'Brey', 'Joel'], 'draft news is for everyone');
});

test('with everyone saved, only the draft warnings go out', () => {
  const list = run({ hoursBeforeDraft: 30, withKeepers: OWNERS });
  assert.deepEqual(kinds(list), ['draft-week']);
});

// ─── Sending once ────────────────────────────────────────────────────────────

test('a reminder already sent is not sent again', () => {
  const first = run({ hoursBeforeDraft: 24 * 5 });
  assert.equal(first.length, 3, 'one draft-week each');
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

test('a late server still warns, rather than skipping', () => {
  // Nothing ran for days, and now there are six hours left before keepers close.
  const list = run({ hoursBeforeDraft: 30 });
  assert.ok(kinds(list).includes('keepers-soon'), 'the missed three-day warning still goes');
  assert.ok(kinds(list).includes('draft-week'), 'and so does the missed week warning');
});

test('once keepers close, no more keeper mail', () => {
  const list = run({ hoursBeforeDraft: 23 });
  assert.ok(!kinds(list).includes('keepers-soon'));
  assert.ok(!kinds(list).includes('keepers-last-call'));
  assert.ok(kinds(list).includes('draft-day'), 'the draft is still ahead');
});

test('once the draft starts, nothing goes out at all', () => {
  assert.deepEqual(run({ hoursBeforeDraft: 0 }), []);
  assert.deepEqual(run({ hoursBeforeDraft: -5 }), []);
});

// ─── Words ───────────────────────────────────────────────────────────────────

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
    assert.ok(copy.subject.length > 0 && copy.heading.length > 0 && copy.body.length > 0);
    for (const line of [copy.subject, copy.heading, copy.body]) {
      assert.ok(!line.includes('—'), `em dash in: ${line}`);
    }
  }
});

test('hoursLeft counts to the right deadline for each kind', () => {
  const list = run({ hoursBeforeDraft: 36 });
  const keeperOne = list.find((r) => r.kind === 'keepers-last-call');
  const draftOne = list.find((r) => r.kind === 'draft-week');
  assert.equal(keeperOne?.hoursLeft, 12, 'keepers close in twelve hours');
  assert.equal(draftOne?.hoursLeft, 36, 'the draft is still a day and a half away');
});

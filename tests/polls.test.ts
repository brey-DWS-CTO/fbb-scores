import assert from 'node:assert/strict';
import test from 'node:test';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';
import {
  canLaunchPoll,
  canVote,
  castVote,
  closePoll,
  describeTally,
  pollKindLabel,
  tallyPoll,
  thresholdFor,
  unknownClauses,
  voteOf,
  type Poll,
} from '../src/lib/league/polls.js';

const MEMBERS = ['Joel', 'Ryan', 'Patrick', 'Bryan', 'Kyle', 'Dustin', 'Aaron', 'Derek', 'Brey', 'Amy'];

function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: 'p1',
    season: 2027,
    kind: 'change',
    title: 'Expand IR to 2 slots',
    detail: 'Two IR slots instead of one.',
    proposedBy: 'Ryan',
    affects: [],
    threshold: 60,
    eligibleVoters: [...MEMBERS],
    openedAt: '2026-09-01T00:00:00.000Z',
    status: 'open',
    votes: [],
    ...overrides,
  };
}

const withVotes = (yes: number, no = 0) =>
  poll({
    votes: [
      ...MEMBERS.slice(0, yes).map((owner) => ({ owner, choice: 'yes' as const, castAt: 'x' })),
      ...MEMBERS.slice(yes, yes + no).map((owner) => ({ owner, choice: 'no' as const, castAt: 'x' })),
    ],
  });

// ─── Counting ──────────────────────────────────────────────────────────────

test('60% of all ten teams means six yes votes', () => {
  assert.equal(tallyPoll(poll()).needed, 6);
  assert.equal(tallyPoll(withVotes(5)).passed, false);
  assert.equal(tallyPoll(withVotes(6)).passed, true);
});

test('a team that never votes counts against the proposal', () => {
  // Six yes, four silent: passes. Five yes, nothing else: fails, even though
  // nobody voted no.
  assert.equal(tallyPoll(withVotes(6)).passed, true);
  const five = tallyPoll(withVotes(5));
  assert.equal(five.passed, false);
  assert.equal(five.no, 0);
  assert.equal(five.notVoted, 5);
});

test('the needed count rounds up, because votes are whole', () => {
  const nine = poll({ eligibleVoters: MEMBERS.slice(0, 9) });
  assert.equal(tallyPoll(nine).needed, 6, '60% of 9 is 5.4, so 6');
  const five = poll({ eligibleVoters: MEMBERS.slice(0, 5) });
  assert.equal(tallyPoll(five).needed, 3);
});

test('an 80% threshold needs eight of ten', () => {
  assert.equal(tallyPoll(poll({ threshold: 80 })).needed, 8);
  assert.equal(tallyPoll(withVotes(7)).passed, true, 'sanity: 7 clears 60%');
  const strict = poll({ threshold: 80, votes: withVotes(7).votes });
  assert.equal(tallyPoll(strict).passed, false);
});

test('a poll is decided as soon as the rest cannot change it', () => {
  assert.equal(tallyPoll(withVotes(6)).decided, true, 'already has enough');
  // Five no votes leave five teams; six are needed, so it cannot pass.
  assert.equal(tallyPoll(withVotes(0, 5)).decided, true);
  assert.equal(tallyPoll(withVotes(0, 4)).decided, false, 'six could still say yes');
  assert.equal(tallyPoll(withVotes(3)).decided, false);
});

test('votes from teams outside the frozen roll are ignored', () => {
  const p = poll({
    eligibleVoters: MEMBERS.slice(0, 3),
    votes: [
      { owner: 'Joel', choice: 'yes', castAt: 'x' },
      { owner: 'Stranger', choice: 'yes', castAt: 'x' },
    ],
  });
  const tally = tallyPoll(p);
  assert.equal(tally.yes, 1);
  assert.equal(tally.eligible, 3);
  assert.equal(tally.notVoted, 2);
});

// ─── Casting ───────────────────────────────────────────────────────────────

test('a member can change their mind while the poll is open', () => {
  let p = castVote(poll(), 'Ryan', 'yes', 't1');
  assert.equal(voteOf(p, 'Ryan'), 'yes');
  p = castVote(p, 'Ryan', 'no', 't2');
  assert.equal(voteOf(p, 'Ryan'), 'no');
  assert.equal(p.votes.length, 1, 'one vote per team, not two');
  assert.equal(tallyPoll(p).yes, 0);
});

test('casting never mutates the poll handed in', () => {
  const original = poll();
  const snapshot = JSON.stringify(original);
  castVote(original, 'Ryan', 'yes', 't1');
  assert.equal(JSON.stringify(original), snapshot);
});

test('voting is refused when closed, ineligible, or nonsense', () => {
  assert.equal(canVote(poll({ status: 'passed' }), 'Ryan', 'yes').reason, 'not-open');
  assert.equal(canVote(poll({ status: 'cancelled' }), 'Ryan', 'yes').reason, 'not-open');
  assert.equal(canVote(poll({ eligibleVoters: ['Amy'] }), 'Ryan', 'yes').reason, 'not-eligible');
  assert.equal(canVote(poll(), 'Ryan', 'maybe').reason, 'bad-choice');
  assert.equal(canVote(poll(), 'Ryan', 'yes').ok, true);
});

// ─── Launching ─────────────────────────────────────────────────────────────

const draftAt = new Date('2026-10-18T21:00:00.000Z');
const beforeDraft = new Date('2026-09-15T00:00:00.000Z');

const launch = (over: Partial<Parameters<typeof canLaunchPoll>[0]> = {}) =>
  canLaunchPoll({
    owner: 'Ryan',
    members: MEMBERS,
    seasonPolls: [],
    kind: 'change',
    affects: ['keepers.cap'],
    title: 'A proposal',
    now: beforeDraft,
    draftAt,
    draftStarted: false,
    ...over,
  });

test('a member may launch one poll a season', () => {
  assert.equal(launch().ok, true);
  const used = launch({ seasonPolls: [poll({ proposedBy: 'Ryan' })] });
  assert.equal(used.ok, false);
  assert.equal(used.reason, 'already-launched');
});

test('someone else launching does not use up your one', () => {
  assert.equal(launch({ seasonPolls: [poll({ proposedBy: 'Amy' })] }).ok, true);
});

test('a finished poll still uses up the launch, a cancelled one does not', () => {
  assert.equal(launch({ seasonPolls: [poll({ proposedBy: 'Ryan', status: 'failed' })] }).ok, false);
  assert.equal(launch({ seasonPolls: [poll({ proposedBy: 'Ryan', status: 'passed' })] }).ok, false);
  assert.equal(
    launch({ seasonPolls: [poll({ proposedBy: 'Ryan', status: 'cancelled' })] }).ok,
    true,
    'a cancelled poll should not cost a member their season',
  );
});

test('nothing can be launched once the draft is here', () => {
  assert.equal(launch({ draftStarted: true }).reason, 'draft-started');
  assert.equal(launch({ now: draftAt }).reason, 'past-deadline');
  assert.equal(launch({ now: new Date('2026-10-19T00:00:00.000Z') }).reason, 'past-deadline');
});

test('non-members and empty titles are refused', () => {
  assert.equal(launch({ owner: 'Stranger' }).reason, 'not-a-member');
  assert.equal(launch({ title: '   ' }).reason, 'empty-title');
});

test('every vote says whether it is a new rule or a change', () => {
  assert.equal(launch({ kind: '' }).reason, 'bad-kind');
  assert.equal(launch({ kind: 'something-else' }).reason, 'bad-kind');
  assert.equal(launch({ kind: 'new-rule', affects: [] }).ok, true);
});

test('a change must name the rule it changes', () => {
  const bare = launch({ kind: 'change', affects: [] });
  assert.equal(bare.ok, false);
  assert.equal(bare.reason, 'change-needs-clause');
  assert.equal(launch({ kind: 'change', affects: ['keepers.cap'] }).ok, true);
});

test('a new rule may name where it goes, or nothing at all', () => {
  assert.equal(launch({ kind: 'new-rule', affects: [] }).ok, true);
  assert.equal(launch({ kind: 'new-rule', affects: ['keepers.cap'] }).ok, true);
});

test('each kind reads plainly on screen', () => {
  assert.equal(pollKindLabel('change'), 'RULE CHANGE');
  assert.equal(pollKindLabel('new-rule'), 'NEW RULE');
});

// ─── Thresholds from the rule book ─────────────────────────────────────────

test('the threshold comes from the rules a poll would change', () => {
  assert.equal(thresholdFor(rulebook2027, []), 60);
  assert.equal(thresholdFor(rulebook2027, ['format.size.change']), 60);
  // Rule 2.1.1: changing the draft style needs 80%.
  assert.equal(thresholdFor(rulebook2027, ['draft.serpentine.change']), 80);
});

test('touching an 80% rule and a 60% rule needs 80%', () => {
  assert.equal(
    thresholdFor(rulebook2027, ['format.size.change', 'draft.serpentine.change']),
    80,
  );
});

test('an unknown clause cannot lower the bar, and is reported', () => {
  assert.equal(thresholdFor(rulebook2027, ['no.such.rule']), 60);
  assert.deepEqual(unknownClauses(rulebook2027, ['no.such.rule', 'keepers.cap']), ['no.such.rule']);
  assert.deepEqual(unknownClauses(rulebook2027, ['keepers.cap']), []);
});

// ─── Closing and describing ────────────────────────────────────────────────

test('closing records whether it carried', () => {
  const passed = closePoll(withVotes(6), 'Brey', 't');
  assert.equal(passed.status, 'passed');
  assert.equal(passed.closedBy, 'Brey');
  assert.equal(closePoll(withVotes(5), 'Brey', 't').status, 'failed');
});

test('the summary line reads in plain English', () => {
  assert.equal(describeTally(withVotes(3)), '3 of 6 needed, 7 yet to vote');
  assert.equal(describeTally(withVotes(6)), 'Passing, 6 of 6 needed');
  assert.equal(describeTally(withVotes(0, 5)), 'Cannot pass, 0 of 6 needed');
  assert.equal(describeTally(closePoll(withVotes(6), 'Brey', 't')), 'Passed, 6 of 6 needed');
  assert.equal(describeTally(poll({ status: 'cancelled' })), 'Cancelled');
});

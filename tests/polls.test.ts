import assert from 'node:assert/strict';
import test from 'node:test';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';
import {
  canEditPoll,
  canLaunchPoll,
  canVote,
  castVote,
  closePoll,
  describePollEdit,
  describeTally,
  editPoll,
  editResetsVotes,
  pollEditChanges,
  pollKindLabel,
  tallyPoll,
  thresholdFor,
  unknownClauses,
  voteOf,
  type Poll,
  type PollEditInput,
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

test('the commissioner is not held to one vote a season', () => {
  const spent = [poll({ proposedBy: 'Brey' })];
  assert.equal(
    launch({ owner: 'Brey', seasonPolls: spent }).reason,
    'already-launched',
    'a plain member is still capped, commissioner or not, until the flag says so',
  );
  assert.equal(launch({ owner: 'Brey', seasonPolls: spent, isCommissioner: true }).ok, true);
  // Three already open changes nothing.
  const many = [
    poll({ proposedBy: 'Brey', id: 'a' }),
    poll({ proposedBy: 'Brey', id: 'b', status: 'passed' }),
    poll({ proposedBy: 'Brey', id: 'c', status: 'failed' }),
  ];
  assert.equal(launch({ owner: 'Brey', seasonPolls: many, isCommissioner: true }).ok, true);
});

test('the exemption covers the launch count and nothing else', () => {
  const commish = { owner: 'Brey', isCommissioner: true };
  assert.equal(launch({ ...commish, draftStarted: true }).reason, 'draft-started');
  assert.equal(launch({ ...commish, now: draftAt }).reason, 'past-deadline');
  assert.equal(launch({ ...commish, title: '  ' }).reason, 'empty-title');
  assert.equal(launch({ ...commish, kind: 'change', affects: [] }).reason, 'change-needs-clause');
  assert.equal(launch({ ...commish, owner: 'Stranger' }).reason, 'not-a-member');
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

// ─── Editing an open vote ──────────────────────────────────────────────────

const asIs = (p: Poll): PollEditInput => ({
  title: p.title,
  detail: p.detail,
  affects: p.affects,
  threshold: p.threshold,
});

const edit = (p: Poll, over: Partial<PollEditInput> = {}): PollEditInput => ({
  ...asIs(p),
  ...over,
});

test('only the commissioner may edit, and only while it is open', () => {
  const p = poll({ affects: ['keepers.cap'] });
  const next = edit(p, { title: 'A new title' });
  assert.equal(canEditPoll({ poll: p, isCommissioner: true, next }).ok, true);
  assert.equal(
    canEditPoll({ poll: p, isCommissioner: false, next }).reason,
    'not-commissioner',
    'a member cannot edit a vote, not even their own',
  );
  const own = poll({ affects: ['keepers.cap'], proposedBy: 'Ryan' });
  assert.equal(
    canEditPoll({ poll: own, isCommissioner: false, next: edit(own, { title: 'Mine' }) }).reason,
    'not-commissioner',
  );
  for (const status of ['passed', 'failed', 'cancelled'] as const) {
    const closed = poll({ affects: ['keepers.cap'], status });
    assert.equal(
      canEditPoll({ poll: closed, isCommissioner: true, next: edit(closed, { title: 'Late' }) })
        .reason,
      'not-open',
    );
  }
});

test('an edit still has to leave a usable vote behind', () => {
  const p = poll({ affects: ['keepers.cap'] });
  assert.equal(canEditPoll({ poll: p, isCommissioner: true, next: edit(p, { title: ' ' }) }).reason, 'empty-title');
  assert.equal(
    canEditPoll({ poll: p, isCommissioner: true, next: edit(p, { affects: [] }) }).reason,
    'change-needs-clause',
  );
  // A new rule may name nowhere, so clearing the list is fine there.
  const fresh = poll({ kind: 'new-rule', affects: ['keepers.cap'] });
  assert.equal(
    canEditPoll({ poll: fresh, isCommissioner: true, next: edit(fresh, { affects: [] }) }).ok,
    true,
  );
});

test('an edit that changes nothing is refused', () => {
  const p = poll({ affects: ['keepers.cap'] });
  assert.equal(canEditPoll({ poll: p, isCommissioner: true, next: asIs(p) }).reason, 'no-change');
  // Trimming is not a change, and neither is reordering the same rules.
  const two = poll({ affects: ['keepers.cap', 'format.size.change'] });
  assert.equal(
    canEditPoll({
      poll: two,
      isCommissioner: true,
      next: edit(two, {
        title: `  ${two.title}  `,
        affects: ['format.size.change', 'keepers.cap'],
      }),
    }).reason,
    'no-change',
  );
});

test('the changed parts are named exactly', () => {
  const p = poll({ affects: ['keepers.cap'] });
  assert.deepEqual(pollEditChanges(p, edit(p, { title: 'Other' })), ['title']);
  assert.deepEqual(pollEditChanges(p, edit(p, { detail: 'Other why' })), ['detail']);
  assert.deepEqual(pollEditChanges(p, edit(p, { affects: ['format.size.change'] })), ['affects']);
  assert.deepEqual(
    pollEditChanges(p, edit(p, { title: 'Other', detail: 'Other why', affects: [] })),
    ['title', 'detail', 'affects'],
  );
});

test('changing the question clears the votes; changing the why does not', () => {
  assert.equal(editResetsVotes(['detail']), false);
  assert.equal(editResetsVotes(['title']), true);
  assert.equal(editResetsVotes(['affects']), true);
  assert.equal(editResetsVotes(['detail', 'affects']), true);

  const voted = withVotes(4, 1);
  const kept = editPoll(voted, edit(voted, { detail: 'A better case for it.' }), 'Brey', 't1');
  assert.equal(kept.votes.length, 5, 'the argument moved, not the question');
  assert.equal(kept.edits?.[0].votesCleared, 0);

  const wiped = editPoll(voted, edit(voted, { title: 'Something else entirely' }), 'Brey', 't1');
  assert.deepEqual(wiped.votes, [], 'those votes answered a different question');
  assert.equal(wiped.edits?.[0].votesCleared, 5);
  assert.equal(tallyPoll(wiped).yes, 0);
  assert.equal(tallyPoll(wiped).notVoted, 10);
});

test('an edit records who, when, and what moved', () => {
  const p = poll({ affects: ['keepers.cap'] });
  const once = editPoll(p, edit(p, { title: 'Round one' }), 'Brey', 't1');
  const twice = editPoll(once, edit(once, { detail: 'Round two' }), 'Brey', 't2');
  assert.equal(twice.edits?.length, 2, 'every edit is kept, oldest first');
  assert.deepEqual(twice.edits?.[0], { at: 't1', by: 'Brey', changed: ['title'], votesCleared: 0 });
  assert.deepEqual(twice.edits?.[1], { at: 't2', by: 'Brey', changed: ['detail'], votesCleared: 0 });
  assert.equal(twice.title, 'Round one');
  assert.equal(twice.detail, 'Round two');
});

test('editing never mutates the poll handed in', () => {
  const original = withVotes(3);
  const snapshot = JSON.stringify(original);
  editPoll(original, edit(original, { title: 'Moved' }), 'Brey', 't1');
  assert.equal(JSON.stringify(original), snapshot);
});

test('naming a stricter rule moves the bar with it', () => {
  const p = poll({ affects: ['format.size.change'] });
  const strict = editPoll(
    p,
    edit(p, {
      affects: ['draft.serpentine.change'],
      threshold: thresholdFor(rulebook2027, ['draft.serpentine.change']),
    }),
    'Brey',
    't1',
  );
  assert.equal(strict.threshold, 80);
  assert.equal(tallyPoll(strict).needed, 8);
});

test('an edit reads plainly on the card', () => {
  assert.equal(
    describePollEdit({ at: 't', by: 'Brey', changed: ['detail'], votesCleared: 0 }),
    'Brey changed the why.',
  );
  assert.equal(
    describePollEdit({ at: 't', by: 'Brey', changed: ['title'], votesCleared: 1 }),
    'Brey changed the title. 1 vote was cleared, so the league votes again.',
  );
  assert.equal(
    describePollEdit({ at: 't', by: 'Brey', changed: ['title', 'affects'], votesCleared: 6 }),
    'Brey changed the title and the rules. 6 votes were cleared, so the league votes again.',
  );
  assert.equal(
    describePollEdit({ at: 't', by: 'Brey', changed: ['title', 'detail', 'affects'], votesCleared: 0 }),
    'Brey changed the title, the why and the rules.',
  );
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

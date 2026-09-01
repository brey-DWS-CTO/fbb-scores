/**
 * League polls: launching one, counting it, deciding whether it passed.
 *
 * Pure and shared by client and server, so the tally the member sees is the
 * same arithmetic the server enforces.
 *
 * Two rules from the constitution drive everything here:
 *  - A change needs 60% of ALL teams, not 60% of votes cast. In a 10 team
 *    league that is 6 yes votes, and a team that never votes counts against
 *    the proposal (commissioner ruling, 2026-08-31, rule 1.3).
 *  - Votes must happen before the draft (rule 1.3.1).
 *
 * The launch quota is the commissioner's 2026-08-31 addition: each member may
 * launch one poll per season. The commissioner is exempt from that count, so
 * league business is never blocked by one vote already spent; the draft
 * deadline still binds them like everyone else.
 */

import { buildRulebookIndex, type Rulebook } from './rulebook.js';

export type PollStatus = 'open' | 'passed' | 'failed' | 'cancelled';
export type VoteChoice = 'yes' | 'no';

/**
 * Every vote is one of two things, and the kind decides what a passed vote
 * seeds in the commissioner's draft: an edit of a named rule, or a new rule.
 */
export type PollKind = 'new-rule' | 'change';

export const POLL_KINDS: PollKind[] = ['new-rule', 'change'];

export interface PollVote {
  owner: string;
  choice: VoteChoice;
  castAt: string;
}

/** The parts of a vote the commissioner may rewrite while it is open. */
export type PollEditField = 'title' | 'detail' | 'affects';

/**
 * One commissioner edit of an open vote.
 *
 * Kept on the poll forever. A member who voted before the wording moved has to
 * be able to see that it moved, and who moved it.
 */
export interface PollEdit {
  at: string;
  by: string;
  /** Which parts changed. Never empty; an edit that changes nothing is refused. */
  changed: PollEditField[];
  /** How many votes this edit threw out. Zero when the question did not move. */
  votesCleared: number;
}

export interface Poll {
  id: string;
  season: number;
  kind: PollKind;
  title: string;
  /** What is being proposed, in the proposer's words. */
  detail: string;
  proposedBy: string;
  /**
   * Clause ids this touches. A change names at least one rule. A new rule may
   * name one clause to say where it should sit, or none at all.
   */
  affects: string[];
  /** Percent of all teams needed, taken from the clauses it touches. */
  threshold: number;
  /** Owners eligible when the poll opened. Frozen, so a later roster change
   *  cannot move the goalposts mid-vote. */
  eligibleVoters: string[];
  openedAt: string;
  status: PollStatus;
  closedAt?: string;
  closedBy?: string;
  votes: PollVote[];
  /** Every commissioner edit, oldest first. Absent on votes never edited. */
  edits?: PollEdit[];
  /** Set when the commissioner seeded the rule book draft from this vote. */
  seededAt?: string;
  seededBy?: string;
  /** The published revision that carried the change, once it goes out. */
  appliedVersionId?: string;
  appliedRevision?: number;
  appliedAt?: string;
}

/** How a kind reads on screen. */
export function pollKindLabel(kind: PollKind): string {
  return kind === 'new-rule' ? 'NEW RULE' : 'RULE CHANGE';
}

/** Default threshold when a poll touches no clause that names its own. */
export const DEFAULT_THRESHOLD = 60;

/**
 * The strictest threshold among the clauses a poll would change.
 *
 * Changing the draft style needs 80% (rule 2.1.1) while most things need 60%,
 * so a poll touching both has to clear 80. An unknown clause id cannot lower
 * the bar; it simply contributes nothing.
 */
export function thresholdFor(book: Rulebook, affects: string[]): number {
  const wanted = new Set(affects);
  let highest = DEFAULT_THRESHOLD;

  const walk = (nodes: Array<{ id: string; voteThreshold?: number; children?: unknown[] }>) => {
    for (const node of nodes) {
      if (wanted.has(node.id) && typeof node.voteThreshold === 'number') {
        highest = Math.max(highest, node.voteThreshold);
      }
      if (node.children) walk(node.children as typeof nodes);
    }
  };

  for (const article of book.articles) {
    walk(article.clauses as never);
  }
  return highest;
}

/** Clause ids a poll names that are not in the book. */
export function unknownClauses(book: Rulebook, affects: string[]): string[] {
  const index = buildRulebookIndex(book);
  return affects.filter((id) => !index.byId.has(id));
}

export interface PollTally {
  yes: number;
  no: number;
  /** Eligible teams that have not voted. These count against the proposal. */
  notVoted: number;
  eligible: number;
  /** Yes votes needed to pass, given the threshold and the eligible count. */
  needed: number;
  passed: boolean;
  /** True once the outcome cannot change, whatever the remaining teams do. */
  decided: boolean;
}

/**
 * Count a poll. `needed` rounds up: 60% of 10 is 6, and 60% of 9 is 5.4, which
 * means 6, because you cannot cast part of a vote.
 */
export function tallyPoll(poll: Poll): PollTally {
  const eligible = poll.eligibleVoters.length;
  const counted = poll.votes.filter((v) => poll.eligibleVoters.includes(v.owner));
  const yes = counted.filter((v) => v.choice === 'yes').length;
  const no = counted.filter((v) => v.choice === 'no').length;
  const needed = Math.ceil((poll.threshold / 100) * eligible - 0.000001);
  const notVoted = eligible - counted.length;
  const passed = yes >= needed;
  // Once enough teams have said yes it passes; once too many are unable to,
  // it cannot. Either way there is nothing left to wait for.
  const decided = passed || yes + notVoted < needed;
  return { yes, no, notVoted, eligible, needed, passed, decided };
}

/** How a member's own vote reads back to them. */
export function voteOf(poll: Poll, owner: string): VoteChoice | null {
  return poll.votes.find((v) => v.owner === owner)?.choice ?? null;
}

export type LaunchRefusal =
  | 'already-launched'
  | 'draft-started'
  | 'past-deadline'
  | 'empty-title'
  | 'bad-kind'
  | 'change-needs-clause'
  | 'not-a-member';

export interface LaunchCheck {
  ok: boolean;
  reason?: LaunchRefusal;
  message?: string;
}

/**
 * Whether `owner` may launch a poll right now.
 *
 * One per member per season, and nothing after the draft, because a rule
 * change mid-draft would rewrite the board under everyone. The commissioner
 * runs the league's business, so the one-per-season count does not apply to
 * them; every other bar still does.
 */
export function canLaunchPoll(input: {
  owner: string;
  members: string[];
  seasonPolls: Poll[];
  kind: string;
  /** Clause ids the vote names. A change must name at least one. */
  affects: string[];
  title: string;
  now: Date;
  draftAt: Date;
  draftStarted: boolean;
  /** Exempt from the one-per-season count, and only that. */
  isCommissioner?: boolean;
}): LaunchCheck {
  if (!input.members.includes(input.owner)) {
    return { ok: false, reason: 'not-a-member', message: 'Only league members can start a vote.' };
  }
  if (!POLL_KINDS.includes(input.kind as PollKind)) {
    return {
      ok: false,
      reason: 'bad-kind',
      message: 'Say whether this is a new rule or a change to one.',
    };
  }
  if (!input.title.trim()) {
    return { ok: false, reason: 'empty-title', message: 'Give the vote a title.' };
  }
  // A change has to say what it changes, or nobody can tell what passed.
  if (input.kind === 'change' && input.affects.length === 0) {
    return {
      ok: false,
      reason: 'change-needs-clause',
      message: 'Pick the rule this would change.',
    };
  }
  if (input.draftStarted) {
    return { ok: false, reason: 'draft-started', message: 'The draft has started; rules are locked.' };
  }
  if (input.now.getTime() >= input.draftAt.getTime()) {
    return {
      ok: false,
      reason: 'past-deadline',
      message: 'Votes must happen before the draft. See rule 1.3.1.',
    };
  }
  // A cancelled poll does not burn the member's one launch.
  const launched = input.seasonPolls.filter(
    (p) => p.proposedBy === input.owner && p.status !== 'cancelled',
  );
  if (launched.length > 0 && input.isCommissioner !== true) {
    return {
      ok: false,
      reason: 'already-launched',
      message: 'You have already started your one vote for this season.',
    };
  }
  return { ok: true };
}

export type VoteRefusal = 'not-open' | 'not-eligible' | 'bad-choice';

export function canVote(
  poll: Poll,
  owner: string,
  choice: string,
): { ok: boolean; reason?: VoteRefusal; message?: string } {
  if (poll.status !== 'open') {
    return { ok: false, reason: 'not-open', message: 'That vote is closed.' };
  }
  if (!poll.eligibleVoters.includes(owner)) {
    return { ok: false, reason: 'not-eligible', message: 'You are not eligible to vote here.' };
  }
  if (choice !== 'yes' && choice !== 'no') {
    return { ok: false, reason: 'bad-choice', message: 'A vote is yes or no.' };
  }
  return { ok: true };
}

/** Record or change a vote. Returns a new poll; the input is untouched. */
export function castVote(poll: Poll, owner: string, choice: VoteChoice, at: string): Poll {
  const votes = poll.votes.filter((v) => v.owner !== owner);
  votes.push({ owner, choice, castAt: at });
  votes.sort((a, b) => a.owner.localeCompare(b.owner));
  return { ...poll, votes };
}

// ─── Editing an open vote ───────────────────────────────────────────────────
//
// Only the commissioner, and only while the vote is open. Members cannot edit
// their own, because the league is voting on the words as they stood.
//
// What happens to votes already cast turns on whether the question moved. The
// title and the rules a vote names ARE the question, so changing either makes
// every vote already in an answer to something else: those votes are cleared
// and the league votes again. The "why" is the argument for it, not the
// question, so fixing or sharpening it leaves the votes standing. Either way
// the edit is recorded on the poll and shown on the card.

export interface PollEditInput {
  title: string;
  detail: string;
  affects: string[];
  /** Read fresh from the book, since changing the rules can move the bar. */
  threshold: number;
}

export type EditRefusal =
  | 'not-commissioner'
  | 'not-open'
  | 'empty-title'
  | 'change-needs-clause'
  | 'no-change';

export interface EditCheck {
  ok: boolean;
  reason?: EditRefusal;
  message?: string;
}

const sameRules = (a: string[], b: string[]): boolean => {
  // Order is presentation. Two lists naming the same rules ask the same thing.
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
};

/** Which parts of a vote an edit would actually change. */
export function pollEditChanges(poll: Poll, next: PollEditInput): PollEditField[] {
  const changed: PollEditField[] = [];
  if (poll.title !== next.title.trim()) changed.push('title');
  if (poll.detail !== next.detail.trim()) changed.push('detail');
  if (!sameRules(poll.affects, next.affects)) changed.push('affects');
  return changed;
}

/** True when an edit changes what the vote asks, not just how it argues for it. */
export function editResetsVotes(changed: PollEditField[]): boolean {
  return changed.some((field) => field !== 'detail');
}

export function canEditPoll(input: {
  poll: Poll;
  isCommissioner: boolean;
  next: PollEditInput;
}): EditCheck {
  if (!input.isCommissioner) {
    return {
      ok: false,
      reason: 'not-commissioner',
      message: 'Only the commissioner can edit a vote.',
    };
  }
  if (input.poll.status !== 'open') {
    return { ok: false, reason: 'not-open', message: 'That vote is closed.' };
  }
  if (!input.next.title.trim()) {
    return { ok: false, reason: 'empty-title', message: 'Give the vote a title.' };
  }
  if (input.poll.kind === 'change' && input.next.affects.length === 0) {
    return {
      ok: false,
      reason: 'change-needs-clause',
      message: 'Pick the rule this would change.',
    };
  }
  if (pollEditChanges(input.poll, input.next).length === 0) {
    return { ok: false, reason: 'no-change', message: 'Nothing changed.' };
  }
  return { ok: true };
}

/**
 * Apply an edit. Returns a new poll; the input is untouched.
 *
 * Check with canEditPoll first. This trusts what it is given.
 */
export function editPoll(poll: Poll, next: PollEditInput, by: string, at: string): Poll {
  const changed = pollEditChanges(poll, next);
  const reset = editResetsVotes(changed);
  const edit: PollEdit = {
    at,
    by,
    changed,
    votesCleared: reset ? poll.votes.length : 0,
  };
  return {
    ...poll,
    title: next.title.trim(),
    detail: next.detail.trim(),
    affects: [...next.affects],
    threshold: next.threshold,
    votes: reset ? [] : poll.votes,
    edits: [...(poll.edits ?? []), edit],
  };
}

const FIELD_WORDS: Record<PollEditField, string> = {
  title: 'the title',
  detail: 'the why',
  affects: 'the rules',
};

/** One plain line for the card, so nobody has to guess that a vote moved. */
export function describePollEdit(edit: PollEdit): string {
  const words = edit.changed.map((field) => FIELD_WORDS[field]);
  const what =
    words.length <= 1
      ? (words[0] ?? 'the vote')
      : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  const head = `${edit.by} changed ${what}.`;
  if (edit.votesCleared === 0) return head;
  const votes = edit.votesCleared === 1 ? '1 vote was' : `${edit.votesCleared} votes were`;
  return `${head} ${votes} cleared, so the league votes again.`;
}

/** Close a poll, recording whether it carried. */
export function closePoll(poll: Poll, by: string, at: string): Poll {
  const tally = tallyPoll(poll);
  return {
    ...poll,
    status: tally.passed ? 'passed' : 'failed',
    closedAt: at,
    closedBy: by,
  };
}

/** A one-line result, for a list row or a notification. */
export function describeTally(poll: Poll): string {
  const tally = tallyPoll(poll);
  if (poll.status === 'cancelled') return 'Cancelled';
  const core = `${tally.yes} of ${tally.needed} needed`;
  if (poll.status === 'passed') return `Passed, ${core}`;
  if (poll.status === 'failed') return `Failed, ${core}`;
  if (tally.decided) {
    return tally.passed ? `Passing, ${core}` : `Cannot pass, ${core}`;
  }
  return `${core}, ${tally.notVoted} yet to vote`;
}

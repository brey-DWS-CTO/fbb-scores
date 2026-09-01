/**
 * Turning a passed vote into a pre-filled amendment draft.
 *
 * A vote is a mandate, not a rewrite. Nothing here touches a published book:
 * it takes the commissioner's draft and puts the proposal where the vote said
 * it belongs, marked so it cannot be mistaken for finished rule text. The
 * commissioner then writes the real wording and publishes, which is the only
 * way a published rule ever changes.
 *
 * Pure, so the seeding is tested without a server.
 */

import { buildRulebookIndex, type Rulebook } from './rulebook.js';
import { insertClause, locate } from './rulebookEdit.js';
import type { Poll } from './polls.js';

/** Marks text that came from a vote and still needs writing as a rule. */
export const AMENDMENT_TAG = '[FROM A PASSED VOTE]';

export type SeedRefusal = 'not-passed' | 'already-seeded' | 'unknown-clause' | 'no-target';

export interface SeedCheck {
  ok: boolean;
  reason?: SeedRefusal;
  message?: string;
}

export class AmendmentError extends Error {
  code: SeedRefusal;

  constructor(code: SeedRefusal, message: string) {
    super(message);
    this.code = code;
    this.name = 'AmendmentError';
  }
}

/** The date a vote closed, as a plain day. Deterministic, so tests can read it. */
function passedOn(poll: Poll, fallback: string): string {
  return (poll.closedAt ?? fallback).slice(0, 10);
}

/** The block of text a seeded rule carries until the commissioner rewrites it. */
export function amendmentText(poll: Poll, now: string): string {
  return [
    `${AMENDMENT_TAG} The league passed "${poll.title}" on ${passedOn(poll, now)}.`,
    poll.detail.trim(),
    'Write this into the rule, then take this note out.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Whether a passed vote can be seeded into this draft. */
export function canSeedAmendment(book: Rulebook, poll: Poll): SeedCheck {
  if (poll.status !== 'passed') {
    return { ok: false, reason: 'not-passed', message: 'Only a vote that passed becomes an amendment.' };
  }
  if (poll.seededAt) {
    return {
      ok: false,
      reason: 'already-seeded',
      message: 'This vote is already in the draft.',
    };
  }
  const index = buildRulebookIndex(book);
  const missing = poll.affects.filter((id) => !index.byId.has(id));
  if (missing.length) {
    return {
      ok: false,
      reason: 'unknown-clause',
      message: `These rules are no longer in the book: ${missing.join(', ')}`,
    };
  }
  if (poll.kind === 'change' && poll.affects.length === 0) {
    return { ok: false, reason: 'no-target', message: 'That vote names no rule to change.' };
  }
  return { ok: true };
}

export interface AmendmentSeed {
  book: Rulebook;
  /** Rules the commissioner now has to write: edited, or newly created. */
  focusIds: string[];
  /** One line for the audit log and the on-screen notice. */
  note: string;
}

/**
 * Put a passed vote into the draft.
 *
 * A change adds the proposal to the end of every rule the vote named, so the
 * old wording stays on screen next to what the league agreed. A new rule
 * becomes a clause after the rule the vote pointed at, or at the end of the
 * last article when it pointed nowhere.
 */
export function seedAmendment(book: Rulebook, poll: Poll, now: string): AmendmentSeed {
  const check = canSeedAmendment(book, poll);
  if (!check.ok) throw new AmendmentError(check.reason ?? 'not-passed', check.message ?? 'Cannot seed');

  const body = amendmentText(poll, now);

  if (poll.kind === 'change') {
    let next = book;
    const focusIds: string[] = [];
    for (const id of poll.affects) {
      const attached = attachAmendment(next, id, body, poll.title);
      next = attached.book;
      focusIds.push(attached.id);
    }
    return {
      book: next,
      focusIds,
      note: `Added the passed vote to ${focusIds.length === 1 ? 'rule' : 'rules'} ${numbersFor(next, focusIds)}.`,
    };
  }

  const anchor = poll.affects[0];
  if (anchor) {
    const { book: next, id } = insertClause(book, anchor, positionFor(book, anchor), {
      title: poll.title,
      text: body,
    });
    return {
      book: next,
      focusIds: [id],
      note: `Added a new rule at ${numbersFor(next, [id])}, where the vote asked for it.`,
    };
  }

  const lastArticle = book.articles[book.articles.length - 1];
  const { book: next, id } = insertClause(book, lastArticle.id, 'child', {
    title: poll.title,
    text: body,
  });
  return {
    book: next,
    focusIds: [id],
    note: `Added a new rule at ${numbersFor(next, [id])}. The vote did not say where, so it went at the end.`,
  };
}

/** A new rule goes inside an article, but beside a clause. */
function positionFor(book: Rulebook, anchor: string): 'child' | 'after' {
  const found = locate(book, anchor);
  return found?.isArticle ? 'child' : 'after';
}

/**
 * Put the proposal on the rule the vote named.
 *
 * A clause gets the text added to the end, so the old wording stays next to
 * what the league agreed. An article has no text of its own, so the proposal
 * becomes a new clause inside it instead.
 */
function attachAmendment(
  book: Rulebook,
  id: string,
  body: string,
  title: string,
): { book: Rulebook; id: string } {
  const found = locate(book, id);
  if (!found) throw new AmendmentError('unknown-clause', `No rule with id ${id}`);
  if (found.isArticle) return insertClause(book, id, 'child', { title, text: body });

  const next = JSON.parse(JSON.stringify(book)) as Rulebook;
  const copy = locate(next, id);
  if (!copy) throw new AmendmentError('unknown-clause', `No rule with id ${id}`);
  const clause = copy.node as { text?: string };
  clause.text = clause.text ? `${clause.text}\n\n${body}` : body;
  return { book: next, id };
}

/** "4.3.2 and 6.1", for a notice a person reads. */
function numbersFor(book: Rulebook, ids: string[]): string {
  const index = buildRulebookIndex(book);
  const numbers = ids.map((id) => index.byId.get(id)?.number ?? id);
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

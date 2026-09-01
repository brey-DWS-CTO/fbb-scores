import assert from 'node:assert/strict';
import test from 'node:test';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';
import { buildRulebookIndex, type Rulebook } from '../src/lib/league/rulebook.js';
import { rulebookFingerprint } from '../src/lib/league/rulebookDiff.js';
import { validateDraft } from '../src/lib/league/rulebookEdit.js';
import {
  AMENDMENT_TAG,
  AmendmentError,
  amendmentText,
  canSeedAmendment,
  seedAmendment,
} from '../src/lib/league/rulebookAmendment.js';
import type { Poll } from '../src/lib/league/polls.js';

const NOW = '2026-09-20T00:00:00.000Z';
const MEMBERS = ['Joel', 'Ryan', 'Patrick', 'Bryan', 'Kyle', 'Dustin', 'Aaron', 'Derek', 'Brey', 'Amy'];

function poll(over: Partial<Poll> = {}): Poll {
  return {
    id: 'poll-2027-ryan-1',
    season: 2027,
    kind: 'change',
    title: 'Expand IR to two slots',
    detail: 'Two IR slots instead of one.',
    proposedBy: 'Ryan',
    affects: ['rosters.ir'],
    threshold: 60,
    eligibleVoters: [...MEMBERS],
    openedAt: '2026-09-01T00:00:00.000Z',
    status: 'passed',
    closedAt: '2026-09-08T00:00:00.000Z',
    votes: [],
    ...over,
  };
}

const book = (): Rulebook => structuredClone(rulebook2027);

/** A clause id that really exists in the committed seed. */
function anyClauseId(source: Rulebook): string {
  const entry = buildRulebookIndex(source).entries.find((e) => !e.isArticle && e.text);
  if (!entry) throw new Error('the seed should have clauses with text');
  return entry.id;
}

// ─── What may be seeded ────────────────────────────────────────────────────

test('only a vote that passed becomes an amendment', () => {
  const base = book();
  const id = anyClauseId(base);
  for (const status of ['open', 'failed', 'cancelled'] as const) {
    const refused = canSeedAmendment(base, poll({ status, affects: [id] }));
    assert.equal(refused.reason, 'not-passed');
  }
  assert.equal(canSeedAmendment(base, poll({ affects: [id] })).ok, true);
});

test('a vote already in the draft is not seeded twice', () => {
  const base = book();
  const done = poll({ affects: [anyClauseId(base)], seededAt: NOW, seededBy: 'Brey' });
  assert.equal(canSeedAmendment(base, done).reason, 'already-seeded');
});

test('a vote naming a rule that has since gone is refused', () => {
  const refused = canSeedAmendment(book(), poll({ affects: ['no.such.rule'] }));
  assert.equal(refused.reason, 'unknown-clause');
  assert.match(String(refused.message), /no longer in the book/);
});

test('seeding a vote that cannot be seeded throws, it does not guess', () => {
  assert.throws(
    () => seedAmendment(book(), poll({ status: 'open' }), NOW),
    (error: unknown) => error instanceof AmendmentError && error.code === 'not-passed',
  );
});

// ─── A change ──────────────────────────────────────────────────────────────

test('a change adds the proposal to the rule it named, keeping the old wording', () => {
  const base = book();
  const id = anyClauseId(base);
  const before = buildRulebookIndex(base).byId.get(id)?.text ?? '';

  const seeded = seedAmendment(base, poll({ affects: [id] }), NOW);
  const after = buildRulebookIndex(seeded.book).byId.get(id)?.text ?? '';

  assert.ok(after.startsWith(before), 'the published wording is still there to edit');
  assert.match(after, /Expand IR to two slots/);
  assert.match(after, /2026-09-08/, 'the day the vote closed');
  assert.ok(after.includes(AMENDMENT_TAG), 'nobody can mistake it for finished rule text');
  assert.deepEqual(seeded.focusIds, [id]);
});

test('a change can name more than one rule', () => {
  const base = book();
  const ids = buildRulebookIndex(base)
    .entries.filter((e) => !e.isArticle && e.text)
    .slice(0, 2)
    .map((e) => e.id);
  const seeded = seedAmendment(base, poll({ affects: ids }), NOW);
  assert.deepEqual(seeded.focusIds, ids);
  for (const id of ids) {
    assert.match(buildRulebookIndex(seeded.book).byId.get(id)?.text ?? '', /Expand IR/);
  }
});

test('a change naming a whole article becomes a new clause inside it', () => {
  const base = book();
  const articleId = base.articles[0].id;
  const countBefore = base.articles[0].clauses.length;
  const seeded = seedAmendment(base, poll({ affects: [articleId] }), NOW);
  assert.equal(seeded.book.articles[0].clauses.length, countBefore + 1);
  assert.notEqual(seeded.focusIds[0], articleId, 'the article itself is untouched');
});

// ─── A new rule ────────────────────────────────────────────────────────────

test('a new rule goes right after the rule the vote pointed at', () => {
  const base = book();
  const id = anyClauseId(base);
  const seeded = seedAmendment(
    base,
    poll({ kind: 'new-rule', title: 'Add a trade deadline', affects: [id] }),
    NOW,
  );
  const index = buildRulebookIndex(seeded.book);
  const anchor = index.byId.get(id);
  const created = index.byId.get(seeded.focusIds[0]);
  assert.ok(anchor && created);
  assert.equal(created.title, 'Add a trade deadline');
  // The next number along at the same level: a sibling, not a child, and not
  // pushed past the rules nested under the anchor.
  const parts = anchor.number.split('.');
  const expected = [...parts.slice(0, -1), String(Number(parts[parts.length - 1]) + 1)].join('.');
  assert.equal(created.number, expected);
});

test('a new rule naming nowhere lands at the end of the last article', () => {
  const base = book();
  const last = base.articles[base.articles.length - 1];
  const seeded = seedAmendment(base, poll({ kind: 'new-rule', affects: [] }), NOW);
  const lastAfter = seeded.book.articles[seeded.book.articles.length - 1];
  assert.equal(lastAfter.clauses.length, last.clauses.length + 1);
  assert.equal(lastAfter.clauses[lastAfter.clauses.length - 1].id, seeded.focusIds[0]);
  assert.match(seeded.note, /did not say where/);
});

test('a change with no rule named is refused, a new rule with none is fine', () => {
  const base = book();
  assert.equal(canSeedAmendment(base, poll({ affects: [] })).reason, 'no-target');
  assert.equal(canSeedAmendment(base, poll({ kind: 'new-rule', affects: [] })).ok, true);
});

// ─── What it leaves behind ─────────────────────────────────────────────────

test('seeding never touches the book handed in', () => {
  const base = book();
  const id = anyClauseId(base);
  const snapshot = rulebookFingerprint(base);
  seedAmendment(base, poll({ affects: [id] }), NOW);
  assert.equal(rulebookFingerprint(base), snapshot, 'a published book is never edited in place');
});

test('a seeded draft is still publishable, with no broken references', () => {
  const base = book();
  const seeded = seedAmendment(base, poll({ affects: [anyClauseId(base)] }), NOW);
  assert.deepEqual(validateDraft(seeded.book), []);
});

test('the seeded text tells the commissioner to write it properly', () => {
  const text = amendmentText(poll(), NOW);
  assert.match(text, /take this note out/);
  assert.ok(text.startsWith(AMENDMENT_TAG));
});

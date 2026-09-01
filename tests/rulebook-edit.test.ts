import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRulebookIndex, type Rulebook } from '../src/lib/league/rulebook.js';
import {
  addArticle,
  allIds,
  canMove,
  deleteNode,
  idsRemovedBy,
  insertClause,
  locate,
  moveNode,
  newClauseId,
  RulebookEditError,
  updateNode,
  validateDraft,
} from '../src/lib/league/rulebookEdit.js';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';

function book(): Rulebook {
  return {
    schemaVersion: 1,
    season: 2027,
    revision: 14,
    status: 'draft',
    title: 'Toy',
    articles: [
      {
        id: 'alpha',
        title: 'Alpha',
        clauses: [
          {
            id: 'a.one',
            text: 'First.',
            children: [{ id: 'a.one.deep', text: 'Deeper.' }],
          },
          { id: 'a.two', text: 'Second.' },
          { id: 'a.three', text: 'Third, pointing at {{ref:b.one}}.' },
        ],
      },
      { id: 'beta', title: 'Beta', clauses: [{ id: 'b.one', title: 'Target', text: 'Here.' }] },
    ],
    appendices: [{ id: 'appx', label: 'Appendix A', title: 'Values' }],
    records: {
      highScores: { criteria: 'toy', complete: true, entries: [] },
      champions: { complete: true, entries: [] },
      formerMembers: [],
    },
  };
}

/** The numbers a book renders to, which is what the reader actually sees. */
const numbers = (b: Rulebook) =>
  buildRulebookIndex(b).entries.filter((e) => !e.isArticle).map((e) => `${e.number} ${e.id}`);

// ─── Locating ──────────────────────────────────────────────────────────────

test('locates articles and nested clauses with their ancestry', () => {
  const b = book();
  const article = locate(b, 'alpha')!;
  assert.equal(article.isArticle, true);
  assert.equal(article.index, 0);

  const deep = locate(b, 'a.one.deep')!;
  assert.equal(deep.isArticle, false);
  assert.deepEqual(deep.ancestors.map((n) => n.id), ['alpha', 'a.one']);
  assert.equal(deep.parent?.id, 'a.one');
  assert.equal(locate(b, 'nope'), undefined);
});

// ─── Editing text ──────────────────────────────────────────────────────────

test('updates text and title without touching the id', () => {
  const next = updateNode(book(), 'a.two', { text: 'Rewritten.', title: 'Second Rule' });
  const clause = locate(next, 'a.two')!.node as { text?: string; title?: string };
  assert.equal(clause.text, 'Rewritten.');
  assert.equal(clause.title, 'Second Rule');
});

test('clearing a title drops the field but keeps the clause', () => {
  const next = updateNode(book(), 'b.one', { title: '' });
  const clause = locate(next, 'b.one')!.node as { title?: string; text?: string };
  assert.equal(clause.title, undefined);
  assert.equal(clause.text, 'Here.');
});

test('refuses to leave a clause with nothing in it', () => {
  assert.throws(
    () => updateNode(book(), 'a.two', { text: '' }),
    (e: RulebookEditError) => e.code === 'empty-clause',
  );
});

test('edits never mutate the book handed in', () => {
  const original = book();
  const snapshot = JSON.stringify(original);
  updateNode(original, 'a.two', { text: 'Changed.' });
  insertClause(original, 'a.two', 'after', { text: 'New.' });
  deleteNode(original, 'a.two');
  moveNode(original, 'a.two', 'up');
  assert.equal(JSON.stringify(original), snapshot);
});

// ─── Inserting ─────────────────────────────────────────────────────────────

test('inserting after a clause renumbers what follows', () => {
  const { book: next, id } = insertClause(book(), 'a.one', 'after', { text: 'Wedged in.' });
  assert.deepEqual(numbers(next), [
    '1.1 a.one',
    '1.1.1 a.one.deep',
    `1.2 ${id}`,
    '1.3 a.two',
    '1.4 a.three',
    '2.1 b.one',
  ]);
});

test('inserting as a child nests under the target', () => {
  const { book: next, id } = insertClause(book(), 'a.two', 'child', { text: 'Underneath.' });
  assert.equal(buildRulebookIndex(next).byId.get(id)?.number, '1.2.1');
});

test('inserting into an article appends a top-level clause', () => {
  const { book: next, id } = insertClause(book(), 'beta', 'child', { text: 'Another.' });
  assert.equal(buildRulebookIndex(next).byId.get(id)?.number, '2.2');
});

test('new ids read like a path and never collide', () => {
  let b = book();
  const first = insertClause(b, 'a.two', 'child', { text: 'Keeper salary cap rules.' });
  b = first.book;
  assert.equal(first.id, 'a.two.keeperSalaryCap');
  const second = insertClause(b, 'a.two', 'child', { text: 'Keeper salary cap rules.' });
  assert.equal(second.id, 'a.two.keeperSalaryCap2');
  assert.equal(newClauseId(book(), 'a.one', '!!!'), 'a.one.clause');
});

test('an empty new clause is refused', () => {
  assert.throws(
    () => insertClause(book(), 'a.two', 'after', { text: '   ' }),
    (e: RulebookEditError) => e.code === 'empty-clause',
  );
});

test('articles are added at the end and can hold clauses', () => {
  const { book: withArticle, id } = addArticle(book(), 'Conduct');
  assert.equal(buildRulebookIndex(withArticle).byId.get(id)?.number, '3');
  const { book: next, id: clauseId } = insertClause(withArticle, id, 'child', { text: 'Be decent.' });
  assert.equal(buildRulebookIndex(next).byId.get(clauseId)?.number, '3.1');
});

// ─── Deleting ──────────────────────────────────────────────────────────────

test('deleting a clause takes its children and renumbers the rest', () => {
  assert.deepEqual(idsRemovedBy(book(), 'a.one'), ['a.one', 'a.one.deep']);
  const next = deleteNode(book(), 'a.one');
  assert.deepEqual(numbers(next), ['1.1 a.two', '1.2 a.three', '2.1 b.one']);
});

test('deleting the only child drops the empty children array', () => {
  const next = deleteNode(book(), 'a.one.deep');
  const parent = locate(next, 'a.one')!.node as { children?: unknown[] };
  assert.equal(parent.children, undefined);
});

test('the last article cannot be deleted', () => {
  let b = deleteNode(book(), 'beta');
  assert.throws(
    () => deleteNode(b, 'alpha'),
    (e: RulebookEditError) => e.code === 'last-article',
  );
  b = addArticle(b, 'Another').book;
  assert.doesNotThrow(() => deleteNode(b, 'alpha'));
});

test('deleting a referenced clause is reported before it happens', () => {
  const b = book();
  assert.deepEqual(idsRemovedBy(b, 'b.one'), ['b.one']);
  const after = deleteNode(b, 'b.one');
  const problems = validateDraft(after);
  assert.deepEqual(
    problems.map((p) => [p.kind, p.id]),
    [['broken-ref', 'a.three']],
    'the dangling reference is caught by validation',
  );
});

// ─── Moving ────────────────────────────────────────────────────────────────

test('up and down swap with the neighbouring sibling', () => {
  const next = moveNode(book(), 'a.two', 'up');
  assert.deepEqual(numbers(next), [
    '1.1 a.two',
    '1.2 a.one',
    '1.2.1 a.one.deep',
    '1.3 a.three',
    '2.1 b.one',
  ]);
  const back = moveNode(next, 'a.two', 'down');
  assert.deepEqual(numbers(back), numbers(book()));
});

test('demote makes a clause the last child of the one above it', () => {
  const next = moveNode(book(), 'a.two', 'demote');
  assert.deepEqual(numbers(next), [
    '1.1 a.one',
    '1.1.1 a.one.deep',
    '1.1.2 a.two',
    '1.2 a.three',
    '2.1 b.one',
  ]);
});

test('promote lifts a clause to sit after its old parent', () => {
  const next = moveNode(book(), 'a.one.deep', 'promote');
  assert.deepEqual(numbers(next), [
    '1.1 a.one',
    '1.2 a.one.deep',
    '1.3 a.two',
    '1.4 a.three',
    '2.1 b.one',
  ]);
  const parent = locate(next, 'a.one')!.node as { children?: unknown[] };
  assert.equal(parent.children, undefined, 'the emptied children array is dropped');
});

test('articles move up and down too', () => {
  const next = moveNode(book(), 'beta', 'up');
  assert.deepEqual(numbers(next), [
    '1.1 b.one',
    '2.1 a.one',
    '2.1.1 a.one.deep',
    '2.2 a.two',
    '2.3 a.three',
  ]);
});

test('illegal moves are blocked, and canMove agrees with moveNode', () => {
  const b = book();
  const cases: Array<[string, 'up' | 'down' | 'promote' | 'demote']> = [
    ['a.one', 'up'], // already first
    ['a.three', 'down'], // already last
    ['a.one', 'promote'], // already top level in its article
    ['a.one', 'demote'], // nothing above it to nest under
    ['alpha', 'promote'], // articles have no level to promote to
    ['alpha', 'demote'],
  ];
  for (const [id, direction] of cases) {
    assert.equal(canMove(b, id, direction), false, `${id} ${direction}`);
    assert.throws(
      () => moveNode(b, id, direction),
      (e: RulebookEditError) => e.code === 'illegal-move',
      `${id} ${direction}`,
    );
  }
  assert.equal(canMove(b, 'a.one.deep', 'promote'), true);
  assert.equal(canMove(b, 'a.two', 'demote'), true);
});

test('a moved clause keeps its id, so links to it still work', () => {
  const next = moveNode(book(), 'a.one.deep', 'promote');
  assert.ok(allIds(next).has('a.one.deep'));
  assert.equal(buildRulebookIndex(next).byId.get('a.one.deep')?.number, '1.2');
});

test('references follow a moved target instead of going stale', () => {
  const moved = moveNode(book(), 'beta', 'up');
  const index = buildRulebookIndex(moved);
  assert.equal(index.byId.get('b.one')?.number, '1.1');
  const clause = locate(moved, 'a.three')!.node as { text: string };
  assert.match(clause.text, /\{\{ref:b\.one\}\}/, 'the stored token is untouched');
});

// ─── Validation ────────────────────────────────────────────────────────────

test('a clean draft has no problems, and the real book is clean', () => {
  assert.deepEqual(validateDraft(book()), []);
  assert.deepEqual(validateDraft(rulebook2027), []);
});

test('validation catches duplicate ids', () => {
  const b = book();
  b.articles[1].clauses.push({ id: 'a.two', text: 'Copycat.' });
  const problems = validateDraft(b);
  assert.deepEqual(problems.map((p) => p.kind), ['duplicate-id']);
});

test('validation catches an empty clause', () => {
  const b = book();
  b.articles[0].clauses.push({ id: 'a.blank' });
  assert.deepEqual(validateDraft(b).map((p) => p.kind), ['empty-clause']);
});

// ─── Against the real book ─────────────────────────────────────────────────

test('editing the real book renumbers exactly the affected article', () => {
  const before = buildRulebookIndex(rulebook2027);
  assert.equal(before.byId.get('draft.order.p10')?.number, '2.2.6');

  const { book: next, id } = insertClause(rulebook2027, 'draft.order.p9', 'before', {
    text: 'A brand new rule about picks.',
  });
  const after = buildRulebookIndex(next);
  assert.equal(after.byId.get(id)?.number, '2.2.5');
  assert.equal(after.byId.get('draft.order.p9')?.number, '2.2.6');
  assert.equal(after.byId.get('draft.order.p10')?.number, '2.2.7');
  assert.equal(
    after.byId.get('keepers.cap')?.number,
    before.byId.get('keepers.cap')?.number,
    'other articles do not move',
  );
  assert.deepEqual(validateDraft(next), []);
});

test('deleting a referenced rule in the real book is caught', () => {
  // 5.1.1 points at the pick-up restrictions; removing them must be flagged.
  const next = deleteNode(rulebook2027, 'transactions.waivers.pickup');
  const problems = validateDraft(next);
  assert.ok(
    problems.some((p) => p.kind === 'broken-ref' && p.id === 'transactions.acq.limits'),
    'the clause that referenced it is named',
  );
});

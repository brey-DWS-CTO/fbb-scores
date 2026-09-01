import assert from 'node:assert/strict';
import test from 'node:test';
import type { Rulebook } from '../src/lib/league/rulebook.js';
import { diffRulebooks, rulebookFingerprint, summarizeDiff } from '../src/lib/league/rulebookDiff.js';
import { insertClause, deleteNode, moveNode, updateNode } from '../src/lib/league/rulebookEdit.js';
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
          { id: 'a.one', text: 'First.' },
          { id: 'a.two', title: 'Second', text: 'Second text.' },
          { id: 'a.three', text: 'Third.' },
        ],
      },
      { id: 'beta', title: 'Beta', clauses: [{ id: 'b.one', text: 'Beta text.' }] },
    ],
    appendices: [{ id: 'appx', label: 'Appendix A', title: 'Values' }],
    records: {
      highScores: { criteria: 'toy', complete: true, entries: [] },
      champions: { complete: true, entries: [] },
      formerMembers: [],
    },
  };
}

const kinds = (b: Rulebook, a: Rulebook) =>
  diffRulebooks(b, a).changes.map((c) => `${c.kind}:${c.id}`);

// ─── Diff ──────────────────────────────────────────────────────────────────

test('a book against itself has no changes', () => {
  const diff = diffRulebooks(book(), book());
  assert.equal(diff.identical, true);
  assert.deepEqual(diff.changes, []);
  assert.equal(summarizeDiff(diff), 'No changes');
});

test('an added rule is reported as added, and the ones after it as moved', () => {
  const before = book();
  const { book: after, id } = insertClause(before, 'a.one', 'after', { text: 'Wedged in.' });
  const diff = diffRulebooks(before, after);
  // Reading order: the new rule lands at 1.2, ahead of the two it pushed down.
  assert.deepEqual(kinds(before, after), [`added:${id}`, 'moved:a.two', 'moved:a.three']);
  const added = diff.changes.find((c) => c.id === id)!;
  assert.equal(added.toNumber, '1.2');
  assert.equal(added.fromNumber, undefined);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.moved, 2);
});

test('a removed rule is reported as removed with the number it used to have', () => {
  const before = book();
  const after = deleteNode(before, 'a.one');
  const diff = diffRulebooks(before, after);
  const removed = diff.changes.find((c) => c.kind === 'removed')!;
  assert.equal(removed.id, 'a.one');
  assert.equal(removed.fromNumber, '1.1');
  assert.equal(removed.toNumber, undefined);
  assert.equal(removed.before, 'First.');
});

test('rewording and retitling are told apart', () => {
  const before = book();
  assert.deepEqual(kinds(before, updateNode(before, 'a.one', { text: 'Rewritten.' })), [
    'reworded:a.one',
  ]);
  assert.deepEqual(kinds(before, updateNode(before, 'a.two', { title: 'Renamed' })), [
    'retitled:a.two',
  ]);

  const reworded = diffRulebooks(before, updateNode(before, 'a.one', { text: 'Rewritten.' }))
    .changes[0];
  assert.equal(reworded.before, 'First.');
  assert.equal(reworded.after, 'Rewritten.');
});

test('moving a rule reads as a move, not a delete plus an add', () => {
  const before = book();
  const after = moveNode(before, 'a.three', 'up');
  const diff = diffRulebooks(before, after);
  assert.equal(diff.counts.removed, 0);
  assert.equal(diff.counts.added, 0);
  assert.equal(diff.counts.moved, 2, 'the moved rule and the one it swapped with');
  const moved = diff.changes.find((c) => c.id === 'a.three')!;
  assert.equal(moved.fromNumber, '1.3');
  assert.equal(moved.toNumber, '1.2');
});

test('changes are listed in the order the new book reads', () => {
  const before = book();
  let after = updateNode(before, 'b.one', { text: 'Changed last.' });
  after = updateNode(after, 'a.one', { text: 'Changed first.' });
  assert.deepEqual(kinds(before, after), ['reworded:a.one', 'reworded:b.one']);
});

test('rewording wins over renumbering for the same rule', () => {
  const before = book();
  const inserted = insertClause(before, 'a.one', 'after', { text: 'Wedged.' }).book;
  const after = updateNode(inserted, 'a.three', { text: 'Also rewritten.' });
  const diff = diffRulebooks(before, after);
  const change = diff.changes.find((c) => c.id === 'a.three')!;
  assert.equal(change.kind, 'reworded', 'one change per rule, the most meaningful one');
  assert.equal(change.fromNumber, '1.3');
  assert.equal(change.toNumber, '1.4');
});

test('the summary reads in plain English', () => {
  const before = book();
  const after = insertClause(before, 'a.one', 'after', { text: 'Wedged.' }).book;
  assert.equal(summarizeDiff(diffRulebooks(before, after)), '1 rule added, 2 rules renumbered');

  const oneMove = diffRulebooks(before, moveNode(before, 'a.three', 'up'));
  assert.equal(summarizeDiff(oneMove), '2 rules renumbered');
});

// ─── Fingerprint ───────────────────────────────────────────────────────────

test('the same book always fingerprints the same', () => {
  assert.equal(rulebookFingerprint(book()), rulebookFingerprint(book()));
  assert.match(rulebookFingerprint(book()), /^rb_[0-9a-f]{8}_[0-9a-z]+$/);
});

test('any change a reader would notice changes the fingerprint', () => {
  const base = rulebookFingerprint(book());
  const cases: Array<[string, Rulebook]> = [
    ['reworded', updateNode(book(), 'a.one', { text: 'Different.' })],
    ['retitled', updateNode(book(), 'a.two', { title: 'Different' })],
    ['reordered', moveNode(book(), 'a.three', 'up')],
    ['added', insertClause(book(), 'a.one', 'after', { text: 'New.' }).book],
    ['removed', deleteNode(book(), 'a.one')],
  ];
  for (const [label, changed] of cases) {
    assert.notEqual(rulebookFingerprint(changed), base, label);
  }
});

test('reordering changes the fingerprint even though the set of rules is the same', () => {
  const before = book();
  const after = moveNode(before, 'a.three', 'up');
  // Same ids, same text; only the order differs, and order makes the numbers.
  assert.notEqual(rulebookFingerprint(after), rulebookFingerprint(before));
});

test('editing metadata alone does not change the fingerprint', () => {
  const b = book();
  const tagged = structuredClone(b);
  tagged.articles[0].clauses[0] = {
    ...tagged.articles[0].clauses[0],
    legacyNumber: '9.9',
    note: 'An editing note nobody reads in the book.',
  };
  assert.equal(rulebookFingerprint(tagged), rulebookFingerprint(b));
});

test('the revision number is part of the fingerprint', () => {
  const bumped = book();
  bumped.revision = 15;
  assert.notEqual(rulebookFingerprint(bumped), rulebookFingerprint(book()));
});

// ─── The real book ─────────────────────────────────────────────────────────

test('the committed book diffs cleanly against itself and fingerprints stably', () => {
  const diff = diffRulebooks(rulebook2027, rulebook2027);
  assert.equal(diff.identical, true);
  assert.equal(rulebookFingerprint(rulebook2027), rulebookFingerprint(rulebook2027));
});

test('one edit to the real book produces a readable diff', () => {
  const after = updateNode(rulebook2027, 'keepers.cap.value', {
    text: 'The commissioners set the cap each year and the app publishes it.',
  });
  const diff = diffRulebooks(rulebook2027, after);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].kind, 'reworded');
  assert.equal(diff.changes[0].fromNumber, '4.3.2');
  assert.equal(diff.changes[0].toNumber, '4.3.2');
  assert.equal(summarizeDiff(diff), '1 rule reworded');
});

test('deleting an article shows every rule under it as removed', () => {
  const after = deleteNode(rulebook2027, 'scoring');
  const diff = diffRulebooks(rulebook2027, after);
  assert.ok(diff.counts.removed > 20, 'the article and all its clauses');
  assert.equal(diff.counts.added, 0);
  assert.ok(
    diff.changes.some((c) => c.kind === 'removed' && c.id === 'scoring'),
    'the article itself is listed',
  );
});

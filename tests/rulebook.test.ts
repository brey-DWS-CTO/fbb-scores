import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anchorFor,
  breadcrumbFor,
  buildRulebookIndex,
  highlight,
  referrersOf,
  refsIn,
  resolveRefs,
  searchRulebook,
  type Rulebook,
} from '../src/lib/league/rulebook.js';
import { rulebook2027, rulebookIndex2027 } from '../src/lib/league/rulebookData.js';

/** A small book used where the real one would make the intent hard to read. */
function toyBook(): Rulebook {
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
          { id: 'a.one', text: 'First.', children: [{ id: 'a.one.deep', text: 'Deeper.' }] },
          { id: 'a.two', title: 'Second Thing', text: 'Points at {{ref:b.one}}.' },
        ],
      },
      { id: 'beta', title: 'Beta', clauses: [{ id: 'b.one', title: 'Target', text: 'Here.' }] },
    ],
    appendices: [{ id: 'appx', label: 'Appendix A', title: 'Values' }],
  };
}

test('derives numbers from tree position, storing none', () => {
  const index = buildRulebookIndex(toyBook());
  assert.equal(index.byId.get('alpha')?.number, '1');
  assert.equal(index.byId.get('a.one')?.number, '1.1');
  assert.equal(index.byId.get('a.one.deep')?.number, '1.1.1');
  assert.equal(index.byId.get('a.two')?.number, '1.2');
  assert.equal(index.byId.get('beta')?.number, '2');
  assert.equal(index.byId.get('b.one')?.number, '2.1');
  assert.equal(index.byId.get('appx')?.number, 'Appendix A');
});

test('renumbers everything after an insert, leaving ids alone', () => {
  const book = toyBook();
  book.articles[0].clauses.splice(1, 0, { id: 'a.inserted', text: 'Wedged in.' });
  const index = buildRulebookIndex(book);
  assert.equal(index.byId.get('a.inserted')?.number, '1.2');
  assert.equal(index.byId.get('a.two')?.number, '1.3', 'the clause after it shifts down');
  assert.equal(index.byId.get('a.one')?.number, '1.1', 'the clause before it does not move');
  assert.equal(index.byId.get('b.one')?.number, '2.1', 'other articles are untouched');
});

test('renumbers after a delete and after a whole article moves', () => {
  const book = toyBook();
  book.articles[0].clauses.shift();
  assert.equal(buildRulebookIndex(book).byId.get('a.two')?.number, '1.1');

  const reordered = toyBook();
  reordered.articles.reverse();
  const index = buildRulebookIndex(reordered);
  assert.equal(index.byId.get('beta')?.number, '1');
  assert.equal(index.byId.get('b.one')?.number, '1.1');
  assert.equal(index.byId.get('alpha')?.number, '2');
});

test('cross-references resolve to the current number, so they cannot go stale', () => {
  const book = toyBook();
  const before = buildRulebookIndex(book);
  assert.equal(resolveRefs(book.articles[0].clauses[1].text!, before), 'Points at 2.1 Target.');

  // Move the target's article to the front; the reference must follow it.
  book.articles.reverse();
  const after = buildRulebookIndex(book);
  assert.equal(resolveRefs(book.articles[1].clauses[1].text!, after), 'Points at 1.1 Target.');
});

test('a reference to a missing clause renders visibly instead of vanishing', () => {
  const index = buildRulebookIndex(toyBook());
  assert.equal(resolveRefs('See {{ref:gone}}.', index), 'See [missing rule: gone].');
});

test('finds which clauses reference a given clause before it is deleted', () => {
  const book = toyBook();
  assert.deepEqual(referrersOf(book, 'b.one'), ['a.two']);
  assert.deepEqual(referrersOf(book, 'a.one'), []);
  assert.deepEqual(refsIn('{{ref:x}} and {{ref:y}}'), ['x', 'y']);
});

test('search matches text, title, and rule number prefixes', () => {
  const index = buildRulebookIndex(toyBook());
  assert.deepEqual(
    searchRulebook(index, 'deeper').map((h) => h.entry.id),
    ['a.one.deep'],
  );
  assert.deepEqual(
    searchRulebook(index, 'second thing').map((h) => h.entry.id),
    ['a.two'],
  );
  // "1.1" pulls up that rule and everything nested under it.
  assert.deepEqual(
    searchRulebook(index, '1.1').map((h) => h.entry.id),
    ['a.one', 'a.one.deep'],
  );
  assert.deepEqual(searchRulebook(index, ''), []);
});

test('search reads through a resolved reference, not the raw token', () => {
  const index = buildRulebookIndex(toyBook());
  assert.deepEqual(
    searchRulebook(index, 'Target').map((h) => h.entry.id),
    ['b.one', 'a.two'].sort((a, b) =>
      (index.byId.get(a)!.number > index.byId.get(b)!.number ? 1 : -1),
    ),
    'the clause holding the reference matches on the resolved title',
  );
  assert.equal(searchRulebook(index, '{{ref').length, 0, 'raw tokens are never searchable');
});

test('breadcrumbs name the ancestors that have titles', () => {
  const index = buildRulebookIndex(toyBook());
  assert.equal(breadcrumbFor(index.byId.get('a.one.deep')!, index), '1 Alpha');
  assert.equal(breadcrumbFor(index.byId.get('alpha')!, index), '');
});

test('highlight splits on the match without losing any characters', () => {
  const segments = highlight('Keeper cap and keeper contracts', 'keeper');
  assert.deepEqual(segments.map((s) => s.hit), [true, false, true, false]);
  assert.equal(segments.map((s) => s.text).join(''), 'Keeper cap and keeper contracts');
  assert.deepEqual(highlight('no match here', 'zzz'), [{ text: 'no match here', hit: false }]);
});

test('anchors are stable ids, not numbers', () => {
  assert.equal(anchorFor('keepers.cap'), 'rule-keepers.cap');
});

// ─── The real 2027 book ────────────────────────────────────────────────────

test('the committed rulebook has unique ids and no broken references', () => {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of rulebookIndex2027.entries) {
    if (seen.has(entry.id)) duplicates.push(entry.id);
    seen.add(entry.id);
  }
  assert.deepEqual(duplicates, [], 'ids must be unique to be stable anchors');

  const broken: string[] = [];
  for (const entry of rulebookIndex2027.entries) {
    if (!entry.text) continue;
    for (const ref of refsIn(entry.text)) {
      if (!rulebookIndex2027.byId.has(ref)) broken.push(`${entry.id} -> ${ref}`);
    }
  }
  assert.deepEqual(broken, [], 'every cross-reference must resolve');
});

test('the numbering defects found in the docx are gone', () => {
  const byId = rulebookIndex2027.byId;
  // The Word file jumped 2.2.5 -> 2.2.10 because "10th pick" was literal text.
  assert.equal(byId.get('draft.order.p9')?.number, '2.2.5');
  assert.equal(byId.get('draft.order.p10')?.number, '2.2.6');
  // Article 5's trade rules were numbered 4.3.x in the source.
  assert.ok(byId.get('transactions.trades.noreview')?.number.startsWith('5.'));
  // The scoring history had two items both numbered 10.6.2.
  const historyNumbers = ['scoring.history.2019', 'scoring.history.2020', 'scoring.history.2021', 'scoring.history.2022']
    .map((id) => byId.get(id)?.number);
  assert.equal(new Set(historyNumbers).size, historyNumbers.length, 'no duplicate numbers');
});

test('the commissioner rulings are present in the committed book', () => {
  const byId = rulebookIndex2027.byId;
  assert.equal(byId.has('transactions.restrict'), false, '5.2.1 was deleted');
  assert.match(byId.get('season.length')!.text!, /18 weeks/);
  assert.doesNotMatch(byId.get('keepers.cap.value')!.text!, /78\.7|77\.8/, 'the cap number left the book');
  assert.match(byId.get('format.democracy')!.text!, /60% of all teams/);
  assert.ok(byId.has('keepers.contracts.follows'), 'contracts follow the player');
  assert.ok(byId.has('keepers.tiers.basis.twoFirsts'), 'two first-round keepers barred');
  // The 2027 amendment: picks 5-6 ranked on score, no consolation matchup.
  assert.match(byId.get('draft.order.p5to6')!.text!, /no consolation matchup/i);
  assert.match(byId.get('draft.order.p1to4.method')!.text!, /highest to lowest/);
  const consolation = rulebookIndex2027.entries.filter((e) => /consolation/i.test(e.text ?? ''));
  assert.equal(consolation.length, 1, 'the only mention left is the one saying it is abolished');
});

test('searching the real book finds rules by number and by wording', () => {
  const capByNumber = searchRulebook(rulebookIndex2027, '4.3');
  assert.ok(capByNumber.some((h) => h.entry.id === 'keepers.cap'), 'number search finds the cap');

  const kyle = searchRulebook(rulebookIndex2027, 'Kyle Rule');
  assert.ok(kyle.some((h) => h.entry.id === 'keepers.picktrade.kyle'));

  assert.equal(searchRulebook(rulebookIndex2027, 'qqqzzz').length, 0);
});

test('every article and appendix in the book is reachable', () => {
  assert.equal(rulebook2027.articles.length, 10);
  assert.equal(rulebook2027.appendices.length, 2);
  const articleNumbers = rulebookIndex2027.entries
    .filter((e) => e.isArticle && !e.number.startsWith('Appendix'))
    .map((e) => e.number);
  assert.deepEqual(articleNumbers, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
});

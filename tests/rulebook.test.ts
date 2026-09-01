import assert from 'node:assert/strict';
import test from 'node:test';
import {
  anchorFor,
  breadcrumbFor,
  buildRulebookIndex,
  formatHighScoreWhen,
  groupByArticle,
  highlight,
  rankedHighScores,
  referrersOf,
  refsIn,
  resolveRefs,
  searchRulebook,
  sectionIdFor,
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
    records: {
      highScores: { criteria: 'toy', complete: false, entries: [] },
      champions: { complete: false, entries: [] },
      formerMembers: [],
    },
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

// ─── Collapsible sections ──────────────────────────────────────────────────

test('groups every clause under its own article, appendices included', () => {
  const sections = groupByArticle(buildRulebookIndex(toyBook()));
  assert.deepEqual(
    sections.map((s) => [s.heading.id, s.clauses.map((c) => c.id)]),
    [
      ['alpha', ['a.one', 'a.one.deep', 'a.two']],
      ['beta', ['b.one']],
      ['appx', []],
    ],
  );
});

test('grouping keeps every clause, losing none to the section split', () => {
  const sections = groupByArticle(rulebookIndex2027);
  const grouped = sections.reduce((n, s) => n + s.clauses.length, 0);
  const total = rulebookIndex2027.entries.filter((e) => !e.isArticle).length;
  assert.equal(grouped, total);
  assert.equal(sections.length, 12, '10 articles plus 2 appendices');
  assert.deepEqual(
    sections.slice(-2).map((s) => s.heading.id),
    ['appendix-a', 'appendix-b'],
  );
});

test('a deep link resolves to the section that must be opened for it', () => {
  assert.equal(sectionIdFor('keepers.cap.value', rulebookIndex2027), 'keepers');
  assert.equal(sectionIdFor('draft.order.p5to6', rulebookIndex2027), 'draft');
  assert.equal(sectionIdFor('appendix-a', rulebookIndex2027), 'appendix-a');
  assert.equal(sectionIdFor('no.such.rule', rulebookIndex2027), undefined);
});

// ─── Appendix B records ────────────────────────────────────────────────────

test('high scores rank by total, fixing the docx ordering', () => {
  const ranked = rankedHighScores(rulebook2027.records.highScores.entries);
  const totals = ranked.map((r) => r.total);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a), 'sorted high to low');

  // The source listed Eric's 1241.6 at 13 and Aaron's 1243.0 at 14.
  const aaron = ranked.find((r) => r.total === 1243.0)!;
  const eric = ranked.find((r) => r.total === 1241.6)!;
  assert.ok(aaron.rank < eric.rank, 'the bigger score ranks higher');
  assert.equal(ranked[0].owner, 'Brey');
  assert.equal(ranked[0].rank, 1);
});

test('equal totals share a rank and the next rank skips', () => {
  const ranked = rankedHighScores([
    { owner: 'A', season: 1, week: 1, total: 1300, source: 'test' },
    { owner: 'B', season: 1, week: 2, total: 1200, source: 'test' },
    { owner: 'C', season: 1, week: 3, total: 1200, source: 'test' },
    { owner: 'D', season: 1, week: 4, total: 1100, source: 'test' },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, 2, 2, 4],
  );
});

test('an unknown week prints as a question mark, as the source had it', () => {
  assert.equal(
    formatHighScoreWhen({ owner: 'Aaron', season: 14, week: null, total: 1316.4, source: 'rulebook' }),
    'S14W?',
  );
  assert.equal(
    formatHighScoreWhen({ owner: 'Brey', season: 9, week: 10, total: 1421.6, source: 'rulebook' }),
    'S9W10',
  );
});

test('the champions record is complete through 2025-26', () => {
  const { entries, complete } = rulebook2027.records.champions;
  assert.equal(complete, true);
  assert.equal(entries.length, 16);
  const latest = entries.find((e) => e.season === 16)!;
  assert.equal(latest.champion, 'Amy Shaug');
  assert.equal(latest.runnerUp, 'Brey Funkhouser');
  assert.equal(entries.filter((e) => e.champion === null).length, 0, 'no season left blank');
});

test('appendix A still carries the scoring table the league page reads', () => {
  const appendixA = rulebook2027.appendices.find((a) => a.id === 'appendix-a')!;
  assert.ok(appendixA.table, 'the table drives both /rules and /league');
  assert.deepEqual(appendixA.table!.columns, ['Statistic', 'Value']);
  assert.equal(appendixA.table!.rows.length, 14);
  assert.deepEqual(appendixA.table!.rows.find((r) => r[0] === '5X5'), ['5X5', '55']);
});

test('every article and appendix in the book is reachable', () => {
  assert.equal(rulebook2027.articles.length, 10);
  assert.equal(rulebook2027.appendices.length, 2);
  const articleNumbers = rulebookIndex2027.entries
    .filter((e) => e.isArticle && !e.number.startsWith('Appendix'))
    .map((e) => e.number);
  assert.deepEqual(articleNumbers, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
});

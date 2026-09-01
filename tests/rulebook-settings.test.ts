import assert from 'node:assert/strict';
import test from 'node:test';
import rawDataset from '../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset } from '../src/lib/keeper/types.js';
import type { Rulebook } from '../src/lib/league/rulebook.js';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';
import { updateNode } from '../src/lib/league/rulebookEdit.js';
import {
  auditRulebookSettings,
  buildSettingsRegistry,
  quotedNumbers,
  settingsNeedingAttention,
} from '../src/lib/league/rulebookSettings.js';

const dataset = rawDataset as unknown as LeagueDataset;
const auditOf = (book: Rulebook) => auditRulebookSettings(book, dataset);
const find = (book: Rulebook, key: string) => auditOf(book).find((a) => a.key === key)!;

test('the registry reports what the app really enforces', () => {
  const registry = buildSettingsRegistry(dataset);
  assert.equal(registry.get('keeper.salaryCap')?.value, 77.8);
  assert.equal(registry.get('keeper.maxPerTeam')?.value, 2);
  assert.equal(registry.get('league.teamCount')?.value, 10);
});

test('quoted numbers are pulled out of prose, decimals included', () => {
  assert.deepEqual(quotedNumbers('The cap is 78.7 pts, up from 77.'), [78.7, 77]);
  assert.deepEqual(quotedNumbers('No numbers here.'), []);
});

test('the committed book has no settings needing attention', () => {
  // The cap number was deliberately taken out of 4.3.2, so nothing conflicts.
  assert.deepEqual(
    settingsNeedingAttention(auditOf(rulebook2027)).map((a) => a.key),
    [],
  );
});

test('putting the old cap number back is flagged', () => {
  // This is exactly the drift the commissioner removed: prose said 78.7 while
  // the app computes 77.8.
  const drifted = updateNode(rulebook2027, 'keepers.cap.value', {
    text: 'Each year the commissioners set the cap. The salary cap this season is 78.7 pts.',
  });
  const audit = find(drifted, 'keeper.salaryCap');
  assert.equal(audit.status, 'check');
  assert.deepEqual(audit.quoted, [78.7]);
  assert.match(audit.detail ?? '', /77\.8/);
  assert.equal(settingsNeedingAttention(auditOf(drifted)).length, 1);
});

test('prose that quotes the enforced number is fine', () => {
  const agreeing = updateNode(rulebook2027, 'keepers.cap.value', {
    text: 'The Keeper Salary Cap is 77.8 points this season.',
  });
  assert.equal(find(agreeing, 'keeper.salaryCap').status, 'ok');
});

test('prose with no numbers at all is never flagged', () => {
  const wordy = updateNode(rulebook2027, 'keepers.cap.value', {
    text: 'The commissioners set the cap each year and the app publishes it.',
  });
  assert.equal(find(wordy, 'keeper.salaryCap').status, 'ok');
});

test('a wrong keepers-per-team number is caught', () => {
  const drifted = updateNode(rulebook2027, 'keepers.select.count', {
    text: 'Each team can keep up to 3 players from their roster from the previous season.',
  });
  const audit = find(drifted, 'keeper.maxPerTeam');
  assert.equal(audit.status, 'check');
  assert.match(audit.detail ?? '', /the app uses 2/);
});

test('the contract table is checked row by row against the engine', () => {
  const clean = find(rulebook2027, 'keeper.contractYears');
  assert.equal(clean.status, 'ok');

  const broken = structuredClone(rulebook2027);
  const contracts = broken.articles
    .find((a) => a.id === 'keepers')!
    .clauses.find((c) => c.id === 'keepers.tiers')!
    .children!.find((c) => c.id === 'keepers.contracts')!
    .children!.find((c) => c.id === 'keepers.contracts.table')!;
  contracts.table!.rows[0] = ['1', '4'];
  const audit = find(broken, 'keeper.contractYears');
  assert.equal(audit.status, 'check');
  assert.match(audit.detail ?? '', /round 1 says 4, the app uses 1/);
});

test('a missing contract round is reported', () => {
  const broken = structuredClone(rulebook2027);
  const contracts = broken.articles
    .find((a) => a.id === 'keepers')!
    .clauses.find((c) => c.id === 'keepers.tiers')!
    .children!.find((c) => c.id === 'keepers.contracts')!
    .children!.find((c) => c.id === 'keepers.contracts.table')!;
  contracts.table!.rows = contracts.table!.rows.slice(0, 9);
  assert.match(find(broken, 'keeper.contractYears').detail ?? '', /round 10 is missing/);
});

test('each audit names the rules that cite it', () => {
  const cap = find(rulebook2027, 'keeper.salaryCap');
  assert.deepEqual(cap.citedBy.map((c) => c.number), ['4.3.2']);
  const contracts = find(rulebook2027, 'keeper.contractYears');
  assert.equal(contracts.citedBy.length, 1);
});

test('a setting key nothing in the app reads is reported, not guessed at', () => {
  const audit = find(rulebook2027, 'season.weeklyGameLimit');
  assert.equal(audit.status, 'unknown-key');
  assert.equal(audit.value, null);
  assert.match(audit.source, /Nothing in the app reads this/);
  assert.ok(audit.citedBy.length > 0, 'it is still shown with the rule that cites it');
});

test('problems sort to the top', () => {
  const drifted = updateNode(rulebook2027, 'keepers.cap.value', {
    text: 'The salary cap this season is 78.7 pts.',
  });
  assert.equal(auditOf(drifted)[0].status, 'check');
});

test('the audit covers every settings key the book uses', () => {
  const audits = auditOf(rulebook2027);
  const cited = new Set<string>();
  const walk = (nodes: Array<{ settings?: string[]; children?: unknown[] }>) => {
    for (const node of nodes) {
      node.settings?.forEach((s) => cited.add(s));
      if (node.children) walk(node.children as typeof nodes);
    }
  };
  rulebook2027.articles.forEach((a) => walk(a.clauses));
  const audited = new Set(audits.map((a) => a.key));
  for (const key of cited) assert.ok(audited.has(key), `${key} is missing from the audit`);
});

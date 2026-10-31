import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRulebookIndex } from '../src/lib/league/rulebook.js';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';
import { lmAddRuleDisplay, lmAddRequestText } from '../src/lib/league/rulebookHotfix.js';

const id = 'transactions.waivers.lmadd.public';
test('live LM request clarification preserves the stored publication and clause number', () => {
  const index = buildRulebookIndex(rulebook2027);
  const clause = index.byId.get(id)!;
  clause.text = 'The LM add must be announced publicly in the league group chat. No exceptions for phone calls, personal conversations, or similar.';
  const before = JSON.stringify(index.entries);
  const display = lmAddRuleDisplay(index);
  assert.equal(display.byId.get(id)?.text, lmAddRequestText);
  assert.equal(display.entries.find((entry) => entry.id === id)?.text, lmAddRequestText);
  assert.equal(display.byId.get(id)?.number, clause.number);
  assert.equal(JSON.stringify(index.entries), before);
  assert.equal(lmAddRuleDisplay(display), display);
});

test('seed allows app requests and future wording is not overwritten', () => {
  const index = buildRulebookIndex(rulebook2027);
  assert.equal(index.byId.get(id)?.text, lmAddRequestText);
  index.byId.get(id)!.text = 'Future commissioner wording.';
  assert.equal(lmAddRuleDisplay(index), index);
});

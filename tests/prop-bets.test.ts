import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRemoveProp,
  canSettleProp,
  normalizeProp,
  parsePropInput,
  parseResult,
  propLabel,
  propResult,
  propSentence,
  propsBySubject,
  propsLocked,
  sameProp,
  sideOf,
  takeSide,
  visibleProps,
  type PropBet,
} from '../src/lib/league/propBets.ts';

const OWNERS = ['Joel', 'Ryan', 'Kyle', 'Brey'];

function prop(overrides: Partial<PropBet> = {}): PropBet {
  return {
    id: 'pb1',
    subject: 'Kyle',
    text: 'times he asks about the rules',
    line: 3.5,
    createdBy: 'Ryan',
    createdAt: '2026-10-14T00:00:00.000Z',
    takes: [],
    ...overrides,
  };
}

test('a prop reads the way you would say it', () => {
  assert.equal(propLabel(prop()), 'Over/under 3.5 times he asks about the rules');
  assert.equal(propSentence(prop()), 'Kyle: Over/under 3.5 times he asks about the rules');
});

test('the form input is checked and tidied', () => {
  const ok = parsePropInput({ subject: 'Kyle', text: '  mid draft   trades ', line: '2.5' }, OWNERS, ['Ryan']);
  assert.deepEqual(ok, { ok: true, input: { subject: 'Kyle', text: 'mid draft trades', line: 2.5 } });
});

test('bad input says which field is wrong', () => {
  const field = (raw: Record<string, unknown>) => {
    const r = parsePropInput(raw, OWNERS, ['Ryan']);
    return r.ok ? null : r.field;
  };
  const good = { subject: 'Kyle', text: 'trades', line: 1.5 };
  assert.equal(field(good), null);
  assert.equal(field({ ...good, subject: 'Nobody' }), 'subject');
  assert.equal(field({ ...good, subject: 'Ryan' }), 'subject', 'never on yourself');
  assert.equal(field({ ...good, text: '   ' }), 'text');
  assert.equal(field({ ...good, text: 'x'.repeat(101) }), 'text');
  assert.equal(field({ ...good, line: '' }), 'line', 'no default line');
  assert.equal(field({ ...good, line: 2 }), 'line');
  assert.equal(field({ ...good, line: 1.25 }), 'line');
  assert.equal(field({ ...good, line: 0 }), 'line');
});

test('the commissioner acting as someone cannot set a prop on himself either', () => {
  const r = parsePropInput({ subject: 'Brey', text: 'trades offered', line: 1.5 }, OWNERS, ['Joel', 'Brey']);
  assert.equal(r.ok, false);
});

test('nobody sees props about themselves, or about whoever acts through them', () => {
  const props = [prop({ id: 'k', subject: 'Kyle' }), prop({ id: 'b', subject: 'Brey' }), prop({ id: 'j', subject: 'Joel' })];
  assert.deepEqual(visibleProps(props, ['Brey']).map((p) => p.id), ['k', 'j']);
  assert.deepEqual(visibleProps(props, ['Joel', 'Brey']).map((p) => p.id), ['k']);
});

test('the same prop twice is caught, whatever the case', () => {
  const a = { subject: 'Kyle', text: 'Trades', line: 1.5 };
  assert.ok(sameProp(a, { ...a, text: 'trades' }));
  assert.ok(!sameProp(a, { ...a, line: 2.5 }));
});

test('first-cut rows read as plain words', () => {
  const old = { ...prop(), text: undefined as unknown as string, kind: 'team', target: 'GS' };
  assert.equal(normalizeProp(old).text, 'GS');
  assert.equal(normalizeProp(prop()).text, 'times he asks about the rules');
});

test('taking a side, switching, and stepping off', () => {
  let p = takeSide(prop(), 'Joel', 'over', 't1');
  assert.equal(sideOf(p, 'Joel'), 'over');
  p = takeSide(p, 'Joel', 'under', 't2');
  assert.equal(p.takes.length, 1);
  assert.equal(sideOf(p, 'Joel'), 'under');
  p = takeSide(p, 'Joel', null, 't3');
  assert.equal(sideOf(p, 'Joel'), null);
});

test('props lock when the draft starts', () => {
  assert.equal(propsLocked(null), false);
  assert.equal(propsLocked('2026-10-18T21:00:00.000Z'), true);
});

test('who may take one down, and who may settle it', () => {
  assert.ok(canRemoveProp(prop(), 'Ryan', false));
  assert.ok(!canRemoveProp(prop(), 'Joel', false));
  assert.ok(canRemoveProp(prop(), 'Joel', true));

  assert.ok(canSettleProp(prop(), 'Ryan', false), 'the setter');
  assert.ok(canSettleProp(prop(), 'Brey', true), 'the commissioner');
  assert.ok(!canSettleProp(prop(), 'Joel', false));
  assert.ok(!canSettleProp(prop({ subject: 'Brey' }), 'Brey', true), 'never your own');
});

test('final counts are whole numbers; the line settles itself', () => {
  assert.deepEqual(parseResult(4), { ok: true, value: 4 });
  assert.deepEqual(parseResult('0'), { ok: true, value: 0 });
  assert.deepEqual(parseResult(null), { ok: true, value: null });
  assert.equal(parseResult(2.5).ok, false);
  assert.equal(parseResult(-1).ok, false);
  assert.equal(parseResult('').ok, false);

  assert.equal(propResult(prop({ result: 4 })), 'over');
  assert.equal(propResult(prop({ result: 3 })), 'under');
  assert.equal(propResult(prop({ result: null })), null);
  assert.equal(propResult(prop()), null);
});

test('grouping keeps league order and drops people with no props', () => {
  const groups = propsBySubject(
    [prop({ id: 'b', subject: 'Joel', createdAt: '2' }), prop({ id: 'a', subject: 'Joel', createdAt: '1' }), prop({ id: 'c' })],
    OWNERS,
  );
  assert.deepEqual(groups.map((g) => [g.owner, g.props.map((p) => p.id)]), [
    ['Joel', ['a', 'b']],
    ['Kyle', ['c']],
  ]);
});

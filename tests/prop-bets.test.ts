import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRemoveProp,
  parsePropInput,
  propCount,
  propLabel,
  propResult,
  propsBySubject,
  propsLocked,
  sameProp,
  sideOf,
  takeSide,
  type PropBet,
} from '../src/lib/league/propBets.ts';

const OWNERS = ['Joel', 'Ryan', 'Amy'];

function prop(overrides: Partial<PropBet> = {}): PropBet {
  return {
    id: 'pb1',
    subject: 'Amy',
    kind: 'team',
    target: 'GS',
    line: 1.5,
    createdBy: 'Ryan',
    createdAt: '2026-10-14T00:00:00.000Z',
    takes: [],
    ...overrides,
  };
}

test('a team prop reads the way you would say it', () => {
  assert.equal(propLabel(prop()), 'Amy drafts over/under 1.5 Warriors');
  assert.equal(propLabel(prop({ kind: 'position', target: 'C', line: 2.5 })), 'Amy drafts over/under 2.5 centers');
  assert.equal(propLabel(prop({ kind: 'custom', target: 'rookies' })), 'Amy drafts over/under 1.5 rookies');
});

test('the form input is checked and tidied', () => {
  const ok = parsePropInput({ subject: 'Amy', kind: 'team', target: 'gsw', line: '2.5' }, OWNERS);
  assert.deepEqual(ok, { ok: true, input: { subject: 'Amy', kind: 'team', target: 'GS', line: 2.5 } });

  const pos = parsePropInput({ subject: 'Joel', kind: 'position', target: 'pg', line: 0.5 }, OWNERS);
  assert.ok(pos.ok && pos.input.target === 'PG');

  const custom = parsePropInput({ subject: 'Joel', kind: 'custom', target: '  guys   over 30 ', line: 1.5 }, OWNERS);
  assert.ok(custom.ok && custom.input.target === 'guys over 30');
});

test('bad input says which field is wrong', () => {
  const field = (raw: Record<string, unknown>) => {
    const r = parsePropInput(raw, OWNERS);
    return r.ok ? null : r.field;
  };
  const good = { subject: 'Amy', kind: 'team', target: 'GS', line: 1.5 };
  assert.equal(field({ ...good, subject: 'Nobody' }), 'subject');
  assert.equal(field({ ...good, kind: 'vibes' }), 'kind');
  assert.equal(field({ ...good, target: 'Seattle' }), 'target');
  assert.equal(field({ ...good, kind: 'position', target: 'G' }), 'target');
  assert.equal(field({ ...good, kind: 'custom', target: '   ' }), 'target');
  assert.equal(field({ ...good, kind: 'custom', target: 'x'.repeat(81) }), 'target');
});

test('a line must end in .5 so nothing pushes', () => {
  const line = (n: unknown) => parsePropInput({ subject: 'Amy', kind: 'team', target: 'GS', line: n }, OWNERS).ok;
  assert.equal(line(1.5), true);
  assert.equal(line(0.5), true);
  assert.equal(line(15.5), true);
  assert.equal(line(2), false);
  assert.equal(line(1.25), false);
  assert.equal(line(0), false);
  assert.equal(line(16.5), false);
  assert.equal(line('abc'), false);
});

test('the same prop twice is caught, whatever the case', () => {
  const a = { subject: 'Amy', kind: 'custom' as const, target: 'Rookies', line: 1.5 };
  assert.ok(sameProp(a, { ...a, target: 'rookies' }));
  assert.ok(!sameProp(a, { ...a, line: 2.5 }));
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
  assert.equal(propsLocked(undefined), false);
  assert.equal(propsLocked('2026-10-18T21:00:00.000Z'), true);
});

test('only the setter or the commissioner can take one down', () => {
  assert.ok(canRemoveProp(prop(), 'Ryan', false));
  assert.ok(!canRemoveProp(prop(), 'Amy', false));
  assert.ok(canRemoveProp(prop(), 'Amy', true));
});

test('counting the board: team and position, only the subject team', () => {
  const drafted = [
    { owner: 'Amy', proTeam: 'GS', positions: ['PG', 'SG'] },
    { owner: 'Amy', proTeam: 'GSW', positions: ['C'] },
    { owner: 'Amy', proTeam: 'LAL', positions: ['C', 'PF'] },
    { owner: 'Joel', proTeam: 'GS', positions: ['C'] },
  ];
  assert.equal(propCount(prop(), drafted), 2, 'alias GSW counts as GS');
  assert.equal(propCount(prop({ kind: 'position', target: 'C' }), drafted), 2);
  assert.equal(propCount(prop({ kind: 'custom', target: 'rookies' }), drafted), null);
});

test('over wins as soon as it passes; under waits for the end', () => {
  assert.equal(propResult(1.5, 2, false), 'over');
  assert.equal(propResult(1.5, 1, false), null);
  assert.equal(propResult(1.5, 1, true), 'under');
  assert.equal(propResult(1.5, null, true), null, 'custom props are settled by people');
});

test('grouping keeps league order and drops teams with no props', () => {
  const groups = propsBySubject(
    [prop({ id: 'b', subject: 'Joel', createdAt: '2' }), prop({ id: 'a', subject: 'Joel', createdAt: '1' }), prop({ id: 'c' })],
    OWNERS,
  );
  assert.deepEqual(groups.map((g) => [g.owner, g.props.map((p) => p.id)]), [
    ['Joel', ['a', 'b']],
    ['Amy', ['c']],
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { onPath, sectionFor, sectionHome, visibleSections } from '../src/lib/league/navSections.ts';

const member = visibleSections(false);
const commish = visibleSections(true);

test('members see five sections, the commish six', () => {
  assert.deepEqual(member.map((section) => section.label), ['KEEPERS', 'DRAFT', 'TRADES', 'LEAGUE', 'RULES']);
  assert.deepEqual(commish.map((section) => section.label), ['KEEPERS', 'DRAFT', 'TRADES', 'LEAGUE', 'RULES', 'COMMISH']);
});

test('everyone sees the mock draft and projections', () => {
  const draft = (sections: typeof member) => sections.find((section) => section.id === 'draft')!.tabs.map((tab) => tab.to);
  assert.deepEqual(draft(member), ['/draft', '/mock', '/projections']);
  assert.deepEqual(draft(commish), ['/draft', '/mock', '/projections']);
});

test('the phone bar holds four sections', () => {
  assert.deepEqual(member.filter((section) => section.primary).map((section) => section.id), ['keepers', 'draft', 'trades', 'league']);
});

test('every old page address finds its section', () => {
  const cases: Array<[string, string | null]> = [
    ['/keepers/Brey', 'keepers'],
    ['/draft', 'draft'],
    ['/mock', 'draft'],
    ['/projections', 'draft'],
    ['/trades', 'trades'],
    ['/teams', 'league'],
    ['/history', 'league'],
    ['/league', 'league'],
    ['/votes', 'rules'],
    ['/rules', 'rules'],
    ['/schedule', 'commish'],
    ['/admin', 'commish'],
    ['/', null],
  ];
  for (const [path, id] of cases) assert.equal(sectionFor(path, commish)?.id ?? null, id, path);
  // A member who follows a commish link lands nowhere, not on a tab they cannot see.
  assert.equal(sectionFor('/admin', member), null);
  assert.equal(sectionFor('/mock', member)?.id, 'draft');
});

test('a path matches its own page and pages under it, not a neighbour', () => {
  assert.ok(onPath('/keepers/Brey', '/keepers'));
  assert.ok(!onPath('/draftees', '/draft'));
  assert.equal(sectionHome(commish.find((section) => section.id === 'league')!), '/league');
});

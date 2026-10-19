import assert from 'node:assert/strict';
import test from 'node:test';
import { onLanding, onPath, sectionFor, sectionHome, visibleSections } from '../src/lib/league/navSections.ts';

const member = visibleSections(false);
const commish = visibleSections(true);

test('members see six sections, the commish seven', () => {
  assert.deepEqual(member.map((section) => section.label), ['KEEPERS', 'DRAFT', 'TRADES', 'LEAGUE', 'VAULT', 'RULES']);
  assert.deepEqual(commish.map((section) => section.label), ['KEEPERS', 'DRAFT', 'TRADES', 'LEAGUE', 'VAULT', 'RULES', 'COMMISH']);
});

test('everyone sees the mock draft, projections and tiers', () => {
  const draft = (sections: typeof member) => sections.find((section) => section.id === 'draft')!.tabs.map((tab) => tab.to);
  assert.deepEqual(draft(member), ['/draft', '/my-rankings', '/mock', '/projections', '/tiers']);
  assert.deepEqual(draft(commish), ['/draft', '/my-rankings', '/mock', '/projections', '/tiers']);
});

test('the phone bar holds five sections until keepers go public, then four', () => {
  assert.deepEqual(member.filter((section) => section.primary).map((section) => section.id), ['keepers', 'draft', 'trades', 'league', 'vault']);
  const draftDay = visibleSections(false, true);
  assert.deepEqual(draftDay.filter((section) => section.primary).map((section) => section.id), ['keepers', 'draft', 'trades', 'league']);
  assert.ok(draftDay.some((section) => section.id === 'vault'), 'VAULT moves behind MORE, it does not vanish');
});

test('every old page address finds its section', () => {
  const cases: Array<[string, string | null]> = [
    ['/keepers/Brey', 'keepers'],
    ['/draft', 'draft'],
    ['/mock', 'draft'],
    ['/my-rankings', 'draft'],
    ['/projections', 'draft'],
    ['/tiers', 'draft'],
    ['/trades', 'trades'],
    ['/teams', 'league'],
    ['/history', 'league'],
    ['/league', 'league'],
    ['/activity', 'league'],
    ['/dues', 'league'],
    ['/achievements', 'vault'],
    ['/revealed', 'vault'],
    ['/achievements/reveal', 'vault'],
    ['/props', 'vault'],
    ['/votes', 'rules'],
    ['/rules', 'rules'],
    ['/schedule', 'commish'],
    ['/awards', 'commish'],
    ['/depth', 'commish'],
    ['/admin', 'commish'],
    ['/', null],
  ];
  for (const [path, id] of cases) assert.equal(sectionFor(path, commish)?.id ?? null, id, path);
  // A member who follows a commish link lands nowhere, not on a tab they cannot see.
  assert.equal(sectionFor('/admin', member), null);
  assert.equal(sectionFor('/awards', member), null);
  assert.equal(sectionFor('/depth', member), null);
  assert.equal(sectionFor('/mock', member)?.id, 'draft');
});

test('a path matches its own page and pages under it, not a neighbour', () => {
  assert.ok(onPath('/keepers/Brey', '/keepers'));
  assert.ok(!onPath('/draftees', '/draft'));
  assert.equal(sectionHome(commish.find((section) => section.id === 'league')!), '/league');
});

test('DRAFT opens on its landing page, where the tabs stay hidden', () => {
  const draft = member.find((section) => section.id === 'draft')!;
  assert.equal(sectionHome(draft), '/draft/start');
  assert.equal(sectionFor('/draft/start', member)?.id, 'draft');
  assert.ok(onLanding('/draft/start', draft));
  assert.ok(!onLanding('/draft', draft));
  assert.ok(!onLanding('/mock', draft));
  // Sections without a home are never a landing page.
  assert.ok(!onLanding('/league', member.find((section) => section.id === 'league')!));
});

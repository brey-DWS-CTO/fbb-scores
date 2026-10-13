import assert from 'node:assert/strict';
import test from 'node:test';
import { SEASON_START, onLanding, onPath, seasonUnderway, sectionFor, sectionHome, todayIso, visibleSections } from '../src/lib/league/navSections.ts';

/** The week before the draft: keepers and the draft are the whole app. */
const PRESEASON = '2026-10-12';
/** Opening day of league week 1. */
const OPENING_DAY = '2026-10-19';

const member = visibleSections(false, PRESEASON);
const commish = visibleSections(true, PRESEASON);

test('members see six sections, the commish seven', () => {
  assert.deepEqual(member.map((section) => section.label), ['KEEPERS', 'DRAFT', 'SCORES', 'TRADES', 'LEAGUE', 'RULES']);
  assert.deepEqual(commish.map((section) => section.label), ['KEEPERS', 'DRAFT', 'SCORES', 'TRADES', 'LEAGUE', 'RULES', 'COMMISH']);
});

test('everyone sees the mock draft, projections and tiers', () => {
  const draft = (sections: typeof member) => sections.find((section) => section.id === 'draft')!.tabs.map((tab) => tab.to);
  assert.deepEqual(draft(member), ['/draft', '/mock', '/projections', '/tiers']);
  assert.deepEqual(draft(commish), ['/draft', '/mock', '/projections', '/tiers']);
});

test('the phone bar holds four sections before the season', () => {
  assert.deepEqual(member.filter((section) => section.primary).map((section) => section.id), ['keepers', 'draft', 'trades', 'league']);
});

test('SCORES sits after DRAFT before the season, and first once it starts', () => {
  assert.equal(SEASON_START, '2026-10-19');
  assert.ok(!seasonUnderway('2026-10-18'));
  assert.ok(seasonUnderway(OPENING_DAY));
  assert.ok(seasonUnderway('2027-03-01'));

  assert.deepEqual(member.map((section) => section.id), ['keepers', 'draft', 'scores', 'trades', 'league', 'rules']);
  assert.ok(!member.find((section) => section.id === 'scores')!.primary, 'behind MORE until there is something to score');

  const inSeason = visibleSections(false, OPENING_DAY);
  assert.deepEqual(inSeason.map((section) => section.id), ['scores', 'keepers', 'draft', 'trades', 'league', 'rules']);
  // Still four on the phone bar: SCORES takes the slot KEEPERS no longer needs.
  assert.deepEqual(inSeason.filter((section) => section.primary).map((section) => section.id), ['scores', 'draft', 'trades', 'league']);
  assert.equal(sectionFor('/keepers/Brey', inSeason)?.id, 'keepers', 'the keepers page still has its section');
  const commishInSeason = visibleSections(true, '2027-01-05');
  assert.equal(commishInSeason[0].id, 'scores');
  assert.equal(commishInSeason[commishInSeason.length - 1].id, 'commish');
});

test('today reads as a local date', () => {
  assert.equal(todayIso(new Date(2026, 9, 19, 23, 30)), '2026-10-19');
  assert.equal(todayIso(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
});

test('every old page address finds its section', () => {
  const cases: Array<[string, string | null]> = [
    ['/keepers/Brey', 'keepers'],
    ['/draft', 'draft'],
    ['/mock', 'draft'],
    ['/projections', 'draft'],
    ['/tiers', 'draft'],
    ['/scores', 'scores'],
    ['/scores/301', 'scores'],
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
  assert.equal(sectionHome(commish.find((section) => section.id === 'scores')!), '/scores');
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

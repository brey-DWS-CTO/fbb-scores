import assert from 'node:assert/strict';
import test from 'node:test';
import { SEASON_START, activeTab, onLanding, onPath, sectionFor, sectionHome, todayIso, visibleSections } from '../src/lib/league/navSections.ts';

/** The week before the draft: keepers and the draft are the whole app. */
const PRESEASON = 'off-season';
/** Opening day of league week 1. */
const OPENING_DAY = 'in-season';

const member = visibleSections(false, false, PRESEASON);
const commish = visibleSections(true, false, PRESEASON);

test('members see seven sections, the commish eight', () => {
  assert.deepEqual(member.map((section) => section.label), ['KEEPERS', 'DRAFT', 'SCORES', 'TRADES', 'LEAGUE', 'VAULT', 'RULES']);
  assert.deepEqual(commish.map((section) => section.label), ['KEEPERS', 'DRAFT', 'SCORES', 'TRADES', 'LEAGUE', 'VAULT', 'RULES', 'COMMISH']);
});

test('everyone sees the mock draft, projections and tiers', () => {
  const draft = (sections: typeof member) => sections.find((section) => section.id === 'draft')!.tabs.map((tab) => tab.to);
  assert.deepEqual(draft(member), ['/draft', '/draft/recap', '/my-rankings', '/mock', '/projections', '/tiers']);
  assert.deepEqual(draft(commish), ['/draft', '/draft/recap', '/my-rankings', '/mock', '/projections', '/tiers']);
});

test('the phone bar holds five sections until keepers go public, then four', () => {
  assert.deepEqual(member.filter((section) => section.primary).map((section) => section.id), ['keepers', 'draft', 'trades', 'league', 'vault']);
  const draftDay = visibleSections(false, true, PRESEASON);
  assert.deepEqual(draftDay.filter((section) => section.primary).map((section) => section.id), ['keepers', 'draft', 'trades', 'league']);
  assert.ok(draftDay.some((section) => section.id === 'vault'), 'VAULT moves behind MORE, it does not vanish');
});

test('SCORES sits after DRAFT before the season, and first once it starts', () => {
  assert.equal(SEASON_START, '2026-10-19');

  assert.deepEqual(member.map((section) => section.id), ['keepers', 'draft', 'scores', 'trades', 'league', 'vault', 'rules']);
  assert.ok(!member.find((section) => section.id === 'scores')!.primary, 'behind MORE until there is something to score');

  // In season the keepers are public, so VAULT is already behind MORE.
  const inSeason = visibleSections(false, true, OPENING_DAY);
  assert.deepEqual(inSeason.map((section) => section.id), ['scores', 'league', 'trades', 'rules', 'draft', 'keepers', 'vault']);
  // Four live sections, whether keepers are public or still hidden.
  assert.deepEqual(visibleSections(false, false, 'in-season').filter((section) => section.primary).map((section) => section.id), ['scores', 'league', 'trades', 'rules']);
  assert.deepEqual(inSeason.filter((section) => section.primary).map((section) => section.id), ['scores', 'league', 'trades', 'rules']);
  assert.equal(sectionFor('/keepers/Brey', inSeason)?.id, 'keepers', 'the keepers page still has its section');
  const commishInSeason = visibleSections(true, true, 'in-season');
  assert.equal(commishInSeason[0].id, 'scores');
  assert.equal(commishInSeason[4].id, 'commish');
  assert.deepEqual(inSeason.filter((section) => section.offSeason).map((section) => section.id), ['draft', 'keepers', 'vault']);
  assert.deepEqual(inSeason.find((section) => section.id === 'league')!.tabs, member.find((section) => section.id === 'league')!.tabs);
  for (const section of inSeason) for (const tab of section.tabs) assert.equal(sectionFor(tab.to, inSeason)?.id, section.id);
});

test('today reads as a local date', () => {
  assert.equal(todayIso(new Date(2026, 9, 19, 23, 30)), '2026-10-19');
  assert.equal(todayIso(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
});

test('every old page address finds its section', () => {
  const cases: Array<[string, string | null]> = [
    ['/keepers/Brey', 'keepers'],
    ['/draft', 'draft'],
    ['/draft/recap', 'draft'],
    ['/mock', 'draft'],
    ['/my-rankings', 'draft'],
    ['/projections', 'draft'],
    ['/tiers', 'draft'],
    ['/scores', 'scores'],
    ['/scores/301', 'scores'],
    ['/trades', 'trades'],
    ['/teams', 'league'],
    ['/history', 'league'],
    ['/league', 'league'],
    ['/activity', 'league'],
    ['/watch', 'league'],
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

test('a page lights one tab, the closest one', () => {
  const tabs = [{ to: '/draft', label: 'BOARD' }, { to: '/draft/recap', label: 'RECAP' }, { to: '/keepers', label: 'KEEPERS' }];
  assert.equal(activeTab('/draft/recap', tabs), '/draft/recap');
  assert.equal(activeTab('/draft', tabs), '/draft');
  assert.equal(activeTab('/keepers/Brey', tabs), '/keepers');
  assert.equal(activeTab('/trades', tabs), null);
});


test('the in-season OFF SEASON draft link opens the saved board directly', () => {
  const draft = visibleSections(false, true, 'in-season').find((section) => section.id === 'draft')!;
  assert.equal(sectionHome(draft), '/draft');
  assert.ok(!onLanding('/draft', draft));
});

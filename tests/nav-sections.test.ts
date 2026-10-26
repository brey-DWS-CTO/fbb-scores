import assert from 'node:assert/strict';
import test from 'node:test';
import { NAV_SECTIONS, activeTab, onLanding, onPath, sectionFor, sectionHome, visibleSections } from '../src/lib/league/navSections.ts';

for (const mode of ['off-season', 'in-season'] as const) {
  for (const commissioner of [false, true]) {
    for (const revealed of [false, true]) {
      test(`${mode}: menus for commissioner=${commissioner}, revealed=${revealed}`, () => {
        const sections = visibleSections(commissioner, revealed, mode);
        assert.equal(sections.some(s => s.id === 'commish'), commissioner);
        assert.ok(sections.every(s => s.tabs.length > 0));
        assert.ok(sections.filter(s => s.primary).length <= (commissioner && mode === 'in-season' ? 5 : 4), 'leave room for MORE on phones');
        for (const section of sections) {
          for (const tab of section.tabs) {
            assert.equal(sectionFor(tab.to, sections)?.id, section.id);
            assert.ok(!tab.mode || tab.mode === mode);
            assert.ok(!tab.beforeReveal || !revealed);
          }
        }
        const paths = sections.flatMap(s => s.tabs.flatMap(t => [t.to, ...(t.pages ?? []).map(page => page.to)]));
        if (mode === 'in-season') {
          assert.equal(sections[0].id, 'scores');
          for (const path of ['/mock', '/my-rankings', '/projections', '/tiers', '/keepers', '/revealed', '/props', '/league/offseason']) assert.ok(!paths.includes(path), path);
          for (const path of ['/scores', '/lm-adds', '/waivers', '/watch', '/draft', '/draft/recap']) assert.ok(paths.includes(path), path);
          assert.equal(sections.find(s => s.id === 'draft')?.label, 'DRAFT RESULTS');
        } else {
          assert.equal(sections[0].id, 'keepers');
          for (const path of ['/scores', '/lm-adds', '/waivers', '/watch']) assert.ok(!paths.includes(path), path);
          for (const path of ['/keepers', '/mock', '/my-rankings']) assert.ok(paths.includes(path), path);
        }
      });
    }
  }
}

test('draft opens its lobby off season and saved results in season', () => {
  const before = visibleSections(false, false, 'off-season').find(s => s.id === 'draft')!;
  const during = visibleSections(false, true, 'in-season').find(s => s.id === 'draft')!;
  assert.equal(sectionHome(before), '/draft/start');
  assert.ok(onLanding('/draft/start', before));
  assert.equal(sectionHome(during), '/draft');
  assert.ok(!onLanding('/draft', during));
});

test('old addresses retain their canonical section even when absent from menus', () => {
  for (const section of NAV_SECTIONS) for (const tab of section.tabs) assert.equal(sectionFor(tab.to, NAV_SECTIONS)?.id, section.id);
  assert.equal(sectionFor('/keepers/Brey', NAV_SECTIONS)?.id, 'keepers');
  assert.ok(!onPath('/draftees', '/draft'));
  assert.equal(activeTab('/draft/recap', [{ to: '/draft', label: 'BOARD' }, { to: '/draft/recap', label: 'RECAP' }]), '/draft/recap');
});

test('Fantasy Cast has its own main button and active state in both season modes', () => {
  for (const mode of ['off-season', 'in-season'] as const) {
    const sections = visibleSections(false, false, mode);
    const cast = sections.find(section => section.id === 'cast')!;
    assert.equal(cast.primary, true);
    assert.equal(cast.shortLabel, 'CAST');
    assert.equal(sectionHome(cast), '/scores/cast');
    assert.equal(sectionFor('/scores/cast', sections)?.id, 'cast');
    assert.equal(sections.filter(section => section.primary).length, 4);
  }
});

test('Waivers opens Activity and keeps its own mobile button and subpages', () => {
  const sections = visibleSections(false, true, 'in-season');
  const league = sections.find(section => section.id === 'league')!;
  assert.ok(!league.tabs.some(tab => ['/activity', '/waivers', '/lm-adds'].includes(tab.to)));
  assert.equal(sectionFor('/activity', sections)?.id, 'waivers');
  const waivers = sections.find(section => section.id === 'waivers')!;
  assert.equal(waivers.primary, true);
  assert.equal(sectionHome(waivers), '/activity');
  assert.deepEqual(waivers.tabs.map(tab => tab.to), ['/activity', '/lm-adds', '/waivers']);
  for (const path of ['/waivers', '/lm-adds']) assert.equal(sectionFor(path, sections)?.id, 'waivers');
  assert.deepEqual(sections.filter(section => section.primary).map(section => section.id), ['scores', 'cast', 'waivers', 'league']);
  assert.equal(sections.find(section => section.id === 'trades')?.primary, false);
});
test('Missed Games belongs to League for everyone and My Team has its own commissioner button', () => {
  for (const commissioner of [false, true]) {
    const sections = visibleSections(commissioner, true, 'in-season');
    assert.equal(sectionFor('/league/missed-games', sections)?.id, 'league');
    assert.equal(sectionFor('/scores/missed-games', sections)?.id, 'league');
    assert.equal(sectionFor('/my-team', sections)?.id, commissioner ? 'my-team' : undefined);
    assert.equal(sections.find(s => s.id === 'my-team')?.primary, commissioner ? true : undefined);
    assert.deepEqual(sections.find(s => s.id === 'scores')?.tabs.map(t => t.to), ['/scores']);
  }
});

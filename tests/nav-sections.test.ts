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
        assert.ok(sections.filter(s => s.primary).length <= 4, 'leave room for MORE on phones');
        for (const section of sections) {
          for (const tab of section.tabs) {
            assert.equal(sectionFor(tab.to, sections)?.id, section.id);
            assert.ok(!tab.mode || tab.mode === mode);
            assert.ok(!tab.beforeReveal || !revealed);
          }
        }
        const paths = sections.flatMap(s => s.tabs.map(t => t.to));
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

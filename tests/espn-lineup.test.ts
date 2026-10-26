import assert from 'node:assert/strict';
import test from 'node:test';
import { espnLineupRevisionContent, parseEspnLineup } from '../src/lib/league/espnLineup.js';
import { validateMove } from '../src/lib/league/lineup.js';

const binding = { leagueId: '123', teamId: 7, seasonId: 2027 };
const now = new Date('2026-10-25T04:00:00Z');
function settings() {
  return { id: 123, seasonId: 2027, scoringPeriodId: 6, settings: {
    name: 'Synthetic league', rosterSettings: { lineupLocktimeType: 'INDIVIDUAL_GAME',
      rosterLocktimeType: 'FIRSTGAME_SCORINGPERIOD', isBenchUnlimited: true,
      lineupSlotCounts: { '0': 1, '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '11': 3, '12': 4, '13': 1 },
    },
  } };
}
function entry(id: number, lineupSlotId: number) {
  return { playerId: id, lineupSlotId, playerPoolEntry: { id, onTeamId: 7, lineupLocked: false,
    player: { id, fullName: `Synthetic player ${id}`, eligibleSlots: [0, 1, 5, 11, 12, 13] } } };
}
function roster() {
  return { id: 123, seasonId: 2027, scoringPeriodId: 6, teams: [{ id: 7, roster: {
    entries: [entry(1, 0), entry(2, 1), entry(3, 2), entry(4, 3), entry(5, 4), entry(6, 6),
      entry(7, 11), entry(8, 11), entry(9, 11), entry(10, 12), entry(11, 12), entry(12, 12), entry(13, 12), entry(14, 12)],
  } }] };
}
const parse = () => parseEspnLineup(settings(), roster(), binding, now);

test('observed shape yields occupied slots, empty G and IR, and unlimited fifth bench slot', () => {
  const result = parse();
  assert.equal(result.players.length, 14);
  assert.equal(result.slots.length, 16);
  assert.deepEqual(result.slots.filter(slot => slot.playerId === null).map(slot => slot.id), ['5:0', '13:0']);
  assert.equal(result.slots.filter(slot => slot.eligibilityId === 12).length, 5);
  assert.equal(result.slots.find(slot => slot.id === '13:0')?.label, 'IR');
  assert.equal((result.slots.find(slot => slot.id === '13:0') as { kind?: string }).kind, 'reserve');
  assert.equal(result.lockMode, 'individual');
  assert.equal(result.periodLockAt, null);
  assert.ok(result.players.every(player => player.lockAt === null));
  assert.ok(result.revision.startsWith('espn-readonly-') && result.revision.length < 200);
  const rules = (result as typeof result & { slotRules: Record<string, { count: number; unlimited: boolean }> }).slotRules;
  assert.deepEqual(rules['12'], { count: 4, unlimited: true });
  assert.deepEqual(rules['11'], { count: 3, unlimited: false });
  assert.deepEqual(rules['13'], { count: 1, unlimited: false });
});
test('timestamps are never inferred from unlocked flags or eligible IR markers', () => {
  const result = parse();
  assert.ok(result.players[0].eligibleSlotIds.includes(13));
  for (const destinationSlotId of ['5:0', '13:0', '12:4']) {
    assert.throws(() => validateMove(result, { playerId: 1, destinationSlotId, revision: result.revision }, now), /lock information/);
  }
});
test('reordering roster entries and equivalent object keys leaves slot IDs and revision stable', () => {
  const first = parse();
  const changed = roster();
  changed.teams[0].roster.entries.reverse();
  changed.teams[0].roster.entries.forEach(item => item.playerPoolEntry.player.eligibleSlots.reverse());
  const config = settings();
  config.settings.rosterSettings.lineupSlotCounts = Object.fromEntries(Object.entries(config.settings.rosterSettings.lineupSlotCounts).reverse()) as typeof config.settings.rosterSettings.lineupSlotCounts;
  const second = parseEspnLineup(config, changed, binding, new Date(now.getTime() + 2000));
  assert.deepEqual(second.slots, first.slots);
  assert.equal(second.revision, first.revision);
  assert.equal(espnLineupRevisionContent(first, settings()), espnLineupRevisionContent(second, config));
});
test('revision includes all settings, eligibility, lineup locks and slot assignments', () => {
  const baseline = settings();
  baseline.settings.rosterSettings.lineupSlotCounts['12'] = 5;
  const first = parseEspnLineup(baseline, roster(), binding, now).revision;
  const changes: Array<(config: ReturnType<typeof settings>, data: ReturnType<typeof roster>) => void> = [
    config => { config.settings.name = 'Changed league'; },
    config => { config.settings.rosterSettings.isBenchUnlimited = false; },
    (config, data) => { config.settings.rosterSettings.lineupSlotCounts['12'] = 5; data.teams[0].roster.entries[0].playerPoolEntry.lineupLocked = true; },
    (_config, data) => { data.teams[0].roster.entries[0].playerPoolEntry.player.eligibleSlots.push(4); },
    (_config, data) => { data.teams[0].roster.entries[0].lineupSlotId = 5; },
  ];
  for (const change of changes) {
    const config = settings();
    const data = roster();
    // Turn off the unlimited flag only after bringing the roster within count.
    config.settings.rosterSettings.lineupSlotCounts['12'] = 5;
    change(config, data);
    assert.notEqual(parseEspnLineup(config, data, binding, now).revision, first);
  }
});
test('canonical revision includes slot capacity rules but excludes fetch time and existing revision', () => {
  const result = parse() as ReturnType<typeof parse> & { slotRules: Record<string, { count: number; unlimited: boolean }> };
  const original = espnLineupRevisionContent(result, settings());
  result.revision = 'other revision';
  result.fetchedAt = '2027-01-01T00:00:00Z';
  assert.equal(espnLineupRevisionContent(result, settings()), original);
  result.slotRules['12'].unlimited = false;
  assert.notEqual(espnLineupRevisionContent(result, settings()), original);
});
test('oversubscribed starter or reserve slots fail even when bench is unlimited', () => {
  for (const slot of [0, 11, 13]) {
    const data = roster();
    data.teams[0].roster.entries.push(entry(100, slot), entry(101, slot), entry(102, slot), entry(103, slot));
    assert.throws(() => parseEspnLineup(settings(), data, binding, now), /exceeds/);
  }
  const config = settings();
  config.settings.rosterSettings.isBenchUnlimited = false;
  assert.throws(() => parseEspnLineup(config, roster(), binding, now), /exceeds/);
});
test('unknown configured slots are displayed faithfully and never generated from eligibility alone', () => {
  const config = settings();
  Object.assign(config.settings.rosterSettings.lineupSlotCounts, { '99': 1 });
  const result = parseEspnLineup(config, roster(), binding, now);
  assert.equal(result.slots.find(slot => slot.id === '99:0')?.label, 'ESPN slot 99');
  assert.equal(result.slots.some(slot => slot.eligibilityId === 10), false);
});
test('wrong identity, season, period and absent team fail closed', () => {
  const changes: Array<(config: ReturnType<typeof settings>, data: ReturnType<typeof roster>) => void> = [
    config => { config.id = 999; },
    config => { config.seasonId = 2026; },
    (_config, data) => { data.id = 999; },
    (_config, data) => { data.seasonId = 2026; },
    (_config, data) => { data.scoringPeriodId = 7; },
    (_config, data) => { data.teams[0].id = 8; },
  ];
  for (const change of changes) {
    const config = settings(); const data = roster(); change(config, data);
    assert.throws(() => parseEspnLineup(config, data, binding, now));
  }
});
test('unknown lineup lock enums and missing settings fail closed', () => {
  for (const value of ['DAILY', 'WEEKLY', '', 'FIRSTGAME_SCORINGPERIOD']) {
    const config = settings(); config.settings.rosterSettings.lineupLocktimeType = value;
    assert.throws(() => parseEspnLineup(config, roster(), binding, now), /Unsupported/);
  }
  const unknownRosterLock = settings();
  unknownRosterLock.settings.rosterSettings.rosterLocktimeType = 'UNKNOWN';
  assert.throws(() => parseEspnLineup(unknownRosterLock, roster(), binding, now), /Unsupported/);
  for (const config of [null, {}, { ...settings(), settings: {} }, { ...settings(), settings: { rosterSettings: {} } }]) {
    assert.throws(() => parseEspnLineup(config, roster(), binding, now));
  }
});
test('duplicate and malformed player, team, lock and eligibility fields fail closed', () => {
  const changes: Array<(data: ReturnType<typeof roster>) => void> = [
    data => { data.teams.push(data.teams[0]); },
    data => { data.teams[0].roster.entries.push(data.teams[0].roster.entries[0]); },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.id = 999; },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.player.id = 999; },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.onTeamId = 8; },
    data => { data.teams[0].roster.entries[0].lineupSlotId = 999; },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.player.fullName = ''; },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.player.eligibleSlots = []; },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.player.eligibleSlots.push(0); },
    data => { data.teams[0].roster.entries[0].playerPoolEntry.player.eligibleSlots.push(-1); },
    data => { Reflect.deleteProperty(data.teams[0].roster.entries[0].playerPoolEntry, 'lineupLocked'); },
  ];
  for (const change of changes) {
    const data = roster(); change(data);
    assert.throws(() => parseEspnLineup(settings(), data, binding, now));
  }
});
test('missing, invalid and excessive configured slot counts fail closed', () => {
  for (const counts of [{}, { '0': -1 }, { '0': 1.5 }, { '01': 1 }, { '0': 201 }, { '0': 0 }]) {
    const config = settings();
    config.settings.rosterSettings.lineupSlotCounts = counts as typeof config.settings.rosterSettings.lineupSlotCounts;
    assert.throws(() => parseEspnLineup(config, roster(), binding, now));
  }
  const config = settings();
  Reflect.deleteProperty(config.settings.rosterSettings.lineupSlotCounts, '12');
  assert.throws(() => parseEspnLineup(config, roster(), binding, now), /unconfigured/);
});
test('invalid bindings and dates fail before parsing', () => {
  for (const invalid of [{ ...binding, leagueId: 'other' }, { ...binding, teamId: 0 }, { ...binding, seasonId: NaN }]) {
    assert.throws(() => parseEspnLineup(settings(), roster(), invalid, now));
  }
  assert.throws(() => parseEspnLineup(settings(), roster(), binding, new Date(NaN)));
});

test('roster read carries optional NBA affiliation for display without inventing unknown teams', () => {
  const data = roster();
  Object.assign(data.teams[0].roster.entries[0].playerPoolEntry.player, { proTeamId: 7 });
  Object.assign(data.teams[0].roster.entries[1].playerPoolEntry.player, { proTeamId: 'unknown' });
  const result = parseEspnLineup(settings(), data, binding, now);
  assert.equal(result.players.find(p => p.id === 1)?.proTeamId, 7);
  assert.equal(result.players.find(p => p.id === 2)?.proTeamId, undefined);
});

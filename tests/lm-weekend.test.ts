import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkLmAdd,
  earlyDays,
  easternHour,
  firstTip,
  hourLabel,
  lastWaiverRunBefore,
  lmAddAllowed,
  lmAddText,
  lmAddWindow,
  pacific,
  waiverHourFor,
  type DayGame,
} from '../src/lib/league/lmWeekend.ts';

// Saturday 24 October 2026. Pacific is UTC-7 until 1 November.
const SAT = '2026-10-24';
const game = (home: string, away: string, tipoff: string): DayGame => ({ home, away, tipoff });
const noon = game('LAL', 'GSW', `${SAT}T19:00:00.000Z`); // 12:00 PM PT
const halfPastTwelve = game('BOS', 'NYK', `${SAT}T19:30:00.000Z`); // 12:30 PM PT
const evening = game('DEN', 'PHX', `${SAT}T02:00:00.000Z`); // Fri 7 PM PT, the night before
const seven = game('MIA', 'ORL', `${SAT}T02:00:00.000Z`);
const fourThirty = game('DAL', 'SAS', `${SAT}T23:30:00.000Z`); // 4:30 PM PT
const fivePm = game('CHI', 'MIL', `${SAT}T00:00:00.000Z`);

test('pacific reads the clock and the weekday in Los Angeles', () => {
  const at = pacific(`${SAT}T19:30:00.000Z`);
  assert.deepEqual(at, { date: SAT, hour: 12, minute: 30, weekday: 6 });
  // Just past midnight UTC is still the evening before in Pacific.
  assert.equal(pacific('2026-10-25T05:00:00.000Z').date, SAT);
  // Standard time after 1 November: UTC-8.
  assert.equal(pacific('2026-11-07T23:00:00.000Z').hour, 15);
});

test('the first tip is the earliest game, or nothing', () => {
  assert.equal(firstTip([halfPastTwelve, noon]), noon.tipoff);
  assert.equal(firstTip([]), null);
  assert.equal(firstTip([game('A', 'B', 'nonsense')]), null);
});

test('a normal day runs waivers at 3 PM Pacific, 6 PM Eastern', () => {
  assert.deepEqual(waiverHourFor([fourThirty]), { hourPT: 15, hourET: 18, early: false, firstTip: fourThirty.tipoff });
  assert.deepEqual(waiverHourFor([]), { hourPT: 15, hourET: 18, early: false, firstTip: null });
});

test('a first tip before 4 PM moves waivers to the hour before it', () => {
  assert.deepEqual(waiverHourFor([noon, fourThirty]), { hourPT: 11, hourET: 14, early: true, firstTip: noon.tipoff });
  // 12:30 rounds down to 11, not 11:30: ESPN only knows whole hours.
  assert.equal(waiverHourFor([halfPastTwelve]).hourPT, 11);
  // 3:59 is early; 4:00 is not.
  assert.equal(waiverHourFor([game('A', 'B', `${SAT}T22:59:00.000Z`)]).early, true);
  assert.equal(waiverHourFor([game('A', 'B', `${SAT}T23:00:00.000Z`)]).early, false);
});

test('Eastern is three hours on, wrapping at midnight', () => {
  assert.equal(easternHour(15), 18);
  assert.equal(easternHour(22), 1);
});

test('early days come out in date order with their hour', () => {
  const days = earlyDays({
    '2026-10-25': [game('A', 'B', '2026-10-25T20:00:00.000Z')], // 1 PM PT Sunday
    [SAT]: [noon],
    '2026-10-26': [fivePm],
  });
  assert.deepEqual(days.map((day) => [day.date, day.hourPT]), [[SAT, 11], ['2026-10-25', 12]]);
});

test('the LM add window is Saturday or Sunday, before the first tip', () => {
  assert.equal(lmAddWindow(`${SAT}T15:00:00.000Z`, [noon]).open, true); // 8 AM PT Saturday
  assert.equal(lmAddWindow(`${SAT}T19:00:00.000Z`, [noon]).open, false); // tip-off
  assert.match(lmAddWindow(`${SAT}T19:00:00.000Z`, [noon]).reason ?? '', /tipped off/);
  assert.match(lmAddWindow('2026-10-23T15:00:00.000Z', [noon]).reason ?? '', /Saturdays and Sundays/);
  assert.match(lmAddWindow(`${SAT}T15:00:00.000Z`, []).reason ?? '', /No NBA games/);
  assert.equal(lmAddWindow(`${SAT}T15:00:00.000Z`, [noon]).closesAt, '2026-10-24T18:50:00.000Z');
});

test('the last waiver run before now is yesterday at 3 PM Pacific', () => {
  assert.equal(lastWaiverRunBefore(`${SAT}T15:00:00.000Z`), '2026-10-23T22:00:00.000Z');
  // After the clocks go back, 3 PM Pacific is 23:00 UTC.
  assert.equal(lastWaiverRunBefore('2026-11-08T15:00:00.000Z'), '2026-11-07T23:00:00.000Z');
});

test('every lmadd condition is checked, with the rule it comes from', () => {
  const ok = checkLmAdd({
    now: `${SAT}T15:00:00.000Z`,
    todaysGames: [noon],
    proTeam: 'LAL',
    onTeamId: 0,
    lastDroppedAt: '2026-10-22T05:00:00.000Z',
  });
  assert.deepEqual(ok.map((check) => [check.rule, check.ok]), [
    ['transactions.waivers.lmadd.timing', true],
    ['transactions.waivers.lmadd.playing', true],
    ['transactions.waivers.lmadd.cleared', true],
    ['transactions.waivers.lmadd.space', true],
  ]);
  assert.equal(lmAddAllowed(ok), true);

  const bad = checkLmAdd({
    now: `${SAT}T15:00:00.000Z`,
    todaysGames: [noon],
    proTeam: 'DEN',
    onTeamId: 4,
    lastDroppedAt: '2026-10-24T03:00:00.000Z', // dropped last night
  });
  assert.deepEqual(bad.filter((check) => !check.ok).map((check) => check.rule), [
    'transactions.waivers.lmadd.playing',
    'transactions.waivers.lmadd.cleared',
    'transactions.waivers.lmadd.space',
  ]);
  assert.equal(lmAddAllowed(bad), false);
});

test('a player never dropped this season has cleared waivers', () => {
  const checks = checkLmAdd({ now: `${SAT}T15:00:00.000Z`, todaysGames: [noon], proTeam: 'GSW', onTeamId: null, lastDroppedAt: null });
  assert.equal(lmAddAllowed(checks), true);
});

test('feed lines say what happened', () => {
  const base = { owner: 'Kyle', playerName: 'J. Green', proTeam: 'PHX' };
  assert.equal(lmAddText({ ...base, status: 'added' }), 'Kyle: LM add J. Green (PHX), added');
  assert.equal(lmAddText({ ...base, status: 'failsafe' }), 'Kyle: LM add J. Green (PHX), failsafe: his points count today');
  assert.equal(lmAddText({ ...base, status: 'waiting-for-drop' }), 'Kyle: LM add J. Green (PHX), waiting for a drop');
});

test('hours read like a clock', () => {
  assert.equal(hourLabel(11), '11 AM');
  assert.equal(hourLabel(15), '3 PM');
  assert.equal(hourLabel(0), '12 AM');
  assert.equal(hourLabel(12), '12 PM');
});

void evening;
void seven;

test('the public scoreboard reads into games with normalized team codes', async () => {
  const { readScoreboard } = await import('../server/lib/nbaDay.ts');
  const games = readScoreboard([
    { date: '2026-10-24T19:00Z', competitions: [{ date: '2026-10-24T19:00Z', competitors: [{ homeAway: 'home', team: { abbreviation: 'GS' } }, { homeAway: 'away', team: { abbreviation: 'NY' } }] }] },
    { competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: 'LAL' } }] }] },
    { date: '2026-10-24T02:00Z', competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: 'UTAH' } }, { homeAway: 'away', team: { abbreviation: 'WSH' } }] }] },
    { date: '2026-10-24T01:00Z', competitions: [{ timeValid: false, competitors: [{ homeAway: 'home', team: { abbreviation: 'MIA' } }, { homeAway: 'away', team: { abbreviation: 'ORL' } }] }] },
  ]);
  assert.deepEqual(games, [
    { home: 'UTA', away: 'WAS', tipoff: '2026-10-24T02:00:00.000Z' },
    { home: 'GSW', away: 'NYK', tipoff: '2026-10-24T19:00:00.000Z' },
  ]);
});

test('the hour to hold never jumps to a time still ahead today', async () => {
  const { waiverHourToHold } = await import('../src/lib/league/lmWeekend.ts');
  const normal = { hourPT: 15, hourET: 18, early: false, firstTip: null };
  const eleven = { hourPT: 11, hourET: 14, early: true, firstTip: `${SAT}T19:00:00.000Z` };
  const at = (hour: number) => ({ date: SAT, hour, minute: 10, weekday: 1 });
  // Normal day, early tomorrow: hold 3 PM until the run passes, then 11.
  assert.equal(waiverHourToHold(at(9), normal, eleven), normal);
  assert.equal(waiverHourToHold(at(15), normal, eleven), normal);
  assert.equal(waiverHourToHold(at(16), normal, eleven), eleven);
  // Early day, normal tomorrow: after the 11 AM run, 3 PM is still ahead, so hold 11 until 4 PM.
  assert.equal(waiverHourToHold(at(12), eleven, normal), eleven);
  assert.equal(waiverHourToHold(at(15), eleven, normal), eleven);
  assert.equal(waiverHourToHold(at(16), eleven, normal), normal);
  // Two early days in a row: nothing to do.
  assert.equal(waiverHourToHold(at(13), eleven, eleven), eleven);
});

test('the Slack line for a waiver change says the hour, the day and what it was', async () => {
  const { waiverChangeText } = await import('../src/lib/league/lmWeekend.ts');
  const eleven = { hourPT: 11, hourET: 14, early: true, firstTip: '2026-10-20T19:00:00.000Z' };
  assert.equal(
    waiverChangeText(eleven, '2026-10-20', 18, true, 'ESPN accepted (200)'),
    'Waivers now run at 11 AM Pacific for Tue, Oct 20 (first tip 12:00 PM). Was 3 PM.',
  );
  assert.match(waiverChangeText(eleven, '2026-10-20', 18, false, 'ESPN refused the sign-in (401)'), /^Waiver hour change failed: wanted 11 AM Pacific for Tue, Oct 20\. ESPN refused/);
});

test('the LM button explains weekdays, closed weekends, no games and signed-out access', async () => {
  const { lmAddButtonReason } = await import('../src/lib/league/lmWeekend.ts');
  const games = [{ home: 'DEN', away: 'LAL', tipoff: '2026-10-24T20:00:00.000Z' }];
  assert.equal(lmAddButtonReason(lmAddWindow('2026-10-23T18:00:00Z', games), '2026-10-23', true), 'LM adds open Saturday and Sunday, until 10 minutes before the first tip.');
  assert.equal(lmAddButtonReason(lmAddWindow('2026-10-24T18:00:00Z', games), '2026-10-24', true), 'Open until 10 minutes before the first tip.');
  assert.equal(lmAddButtonReason(lmAddWindow('2026-10-24T20:00:00Z', games), '2026-10-24', true), 'Closed for today. Opens again tomorrow; closes 10 minutes before the first tip.');
  const sunday = [{ ...games[0], tipoff: '2026-10-25T20:00:00.000Z' }];
  assert.equal(lmAddButtonReason(lmAddWindow('2026-10-25T20:00:00Z', sunday), '2026-10-25', true), 'Closed for today. Opens again next Saturday; closes 10 minutes before the first tip.');
  assert.equal(lmAddButtonReason(lmAddWindow('2026-10-24T18:00:00Z', []), '2026-10-24', true), 'No NBA games today, so no LM adds.');
  assert.equal(lmAddButtonReason(null, null, false), 'Sign in to request an LM add.');
  assert.equal(lmAddButtonReason(null, null, true), "Checking today's LM add window.");
});

test('the HQ list holds only the signed-in member open requests', async () => {
  const { ownOpenLmRequests } = await import('../src/lib/league/lmWeekend.ts');
  const requests = ['requested', 'waiting-for-drop', 'failsafe', 'added', 'denied'].map((status) => ({ id: status, owner: 'Brey', status } as import('../src/lib/league/lmWeekend.ts').LmAddRequest));
  requests.push({ ...requests[0], id: 'other', owner: 'Joel' });
  assert.deepEqual(ownOpenLmRequests(requests, 'Brey').map((row) => row.id), ['requested', 'waiting-for-drop', 'failsafe']);
  assert.deepEqual(ownOpenLmRequests(requests, null), []);
});

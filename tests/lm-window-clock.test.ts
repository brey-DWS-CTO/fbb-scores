import test from 'node:test';
import assert from 'node:assert/strict';
import { lmWindowCards } from '../src/lib/league/lmWindowClock.js';
import { waiverCalendarDay } from '../src/lib/league/waiverCalendar.js';
import { lmAddWindow, type DayGame } from '../src/lib/league/lmWeekend.js';

const game = (date: string, tipoff: string): DayGame => ({ home: 'MEM', away: 'LAL', tipoff });
// Sun Oct 25 2026: first tip 2 PM PT (21:00Z), so waivers 1 PM, window 1:05 to 1:50.
const sunday = waiverCalendarDay('2026-10-25', [game('2026-10-25', '2026-10-25T21:00:00Z')]);
const monday = waiverCalendarDay('2026-10-26', [game('2026-10-26', '2026-10-27T02:00:00Z')]);
// Sat Oct 31: first tip 4 PM PT, so waivers 3 PM, window 3:05 to 3:50.
const saturday = waiverCalendarDay('2026-10-31', [game('2026-10-31', '2026-10-31T23:00:00Z')]);
const days = [sunday, monday, saturday];

test('before waivers, the clock counts to the window opening', () => {
  const [today, next] = lmWindowCards(Date.parse('2026-10-25T17:00:00Z'), days);
  assert.equal(today.label, 'LM adds open in');
  assert.equal(today.countdownTo, '2026-10-25T20:05:00.000Z');
  assert.equal(today.detail, 'Today, 1:05 PM to 1:50 PM PT');
  assert.equal(next.label, 'Next LM day');
  assert.equal(next.headline, 'Sat, Oct 31');
});

test('while open, the clock counts to the close', () => {
  const [today] = lmWindowCards(Date.parse('2026-10-25T20:30:00Z'), days);
  assert.equal(today.label, 'LM adds close in');
  assert.equal(today.countdownTo, '2026-10-25T20:50:00.000Z');
});

test('after the close, today says closed and Monday never shows', () => {
  const cards = lmWindowCards(Date.parse('2026-10-25T21:30:00Z'), days);
  assert.deepEqual(cards.map(card => card.headline), ['LM adds closed', 'Sat, Oct 31']);
});

test('on a weekday, the clock counts to the next LM window', () => {
  const [first] = lmWindowCards(Date.parse('2026-10-27T17:00:00Z'), days);
  assert.equal(first.label, 'Next LM window opens in');
  assert.equal(first.countdownTo, '2026-10-31T22:05:00.000Z');
  assert.equal(first.detail, 'Sat, Oct 31, 3:05 PM to 3:50 PM PT');
});

test('the LM window waits for waivers', () => {
  const games = [game('2026-10-25', '2026-10-25T21:00:00Z')];
  const early = lmAddWindow('2026-10-25T19:00:00Z', games);
  assert.equal(early.open, false);
  assert.equal(early.waiting, true);
  assert.equal(early.reason, 'LM adds open at 1:05 PM PT, after waivers run.');
  assert.equal(lmAddWindow('2026-10-25T20:05:00Z', games).open, true);
});

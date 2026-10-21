import assert from 'node:assert/strict';
import test from 'node:test';
import type { HouseParty } from '../src/lib/league/houseParty.js';
import {
  duePartyReminders,
  pacificHour,
  pacificInstant,
  partiesDueNow,
  partyCheckDue,
  partyReminderCopy,
  partyReminderKey,
  partyReminderWindow,
  partyWorthReminding,
} from '../src/lib/league/partyReminders.js';

/** A Pacific wall-clock time in October. PDT is seven hours behind UTC. */
const pdt = (stamp: string) => new Date(`${stamp}-07:00`);
/** The same in January, on standard time, eight hours behind. */
const pst = (stamp: string) => new Date(`${stamp}-08:00`);

function party(overrides: Partial<HouseParty> = {}): HouseParty {
  return {
    id: 'abc12345',
    season: 2027,
    host: 'Kyle',
    games: [{ id: 'g1', tipoff: pdt('2026-10-20T19:30:00').toISOString(), home: 'GSW', away: 'LAL', tv: 'TNT' }],
    note: '12 Elm St. Bring a six-pack.',
    createdBy: 'Kyle',
    createdAt: pdt('2026-10-15T12:00:00').toISOString(),
    rsvps: [
      { owner: 'Kyle', answer: 'in', at: '' },
      { owner: 'Amy', answer: 'in', at: '' },
      { owner: 'Joel', answer: 'out', at: '' },
    ],
    cancelledAt: null,
    ...overrides,
  };
}

// ─── Pacific time ────────────────────────────────────────────────────────────

test('nine in the morning Pacific is 16:00 UTC in summer and 17:00 UTC in winter', () => {
  assert.equal(pacificInstant('2026-10-20', 9).toISOString(), '2026-10-20T16:00:00.000Z');
  assert.equal(pacificInstant('2027-01-12', 9).toISOString(), '2027-01-12T17:00:00.000Z');
  // The Sunday the clocks fall back, 1 November 2026: nine is still nine.
  assert.equal(pacificInstant('2026-11-01', 9).toISOString(), '2026-11-01T17:00:00.000Z');
});

test('the Pacific hour reads off the clock in either half of the year', () => {
  assert.equal(pacificHour(pdt('2026-10-20T09:15:00')), 9);
  assert.equal(pacificHour(pst('2027-01-12T23:59:00')), 23);
  assert.equal(pacificHour(pst('2027-01-12T00:05:00')), 0);
});

test('the clock may read the parties only in the nine and ten o\'clock hours', () => {
  assert.equal(partyCheckDue(pdt('2026-10-20T08:59:00')), false);
  assert.equal(partyCheckDue(pdt('2026-10-20T09:00:00')), true);
  assert.equal(partyCheckDue(pdt('2026-10-20T10:59:00')), true);
  assert.equal(partyCheckDue(pdt('2026-10-20T11:00:00')), false);
  assert.equal(partyCheckDue(pst('2027-01-12T09:02:00')), true);
});

// ─── The window ──────────────────────────────────────────────────────────────

test('the window opens at nine on the game day and shuts at tip-off', () => {
  const window = partyReminderWindow(party());
  assert.ok(window);
  assert.equal(window.opensAt.toISOString(), pdt('2026-10-20T09:00:00').toISOString());
  assert.equal(window.closesAt.toISOString(), pdt('2026-10-20T19:30:00').toISOString());
});

test('a game day is a Pacific day, even when the tip-off is past midnight UTC', () => {
  // 7:30 PM Pacific on the 20th is 02:30 UTC on the 21st. The morning is still the 20th.
  const late = party({ games: [{ id: 'g1', tipoff: '2026-10-21T02:30:00.000Z', home: 'GSW', away: 'LAL', tv: null }] });
  assert.equal(partyReminderWindow(late)?.opensAt.toISOString(), '2026-10-20T16:00:00.000Z');
});

test('no window for a called-off party, one with no games, or a game before nine', () => {
  assert.equal(partyReminderWindow(party({ cancelledAt: '2026-10-19T00:00:00.000Z' })), null);
  assert.equal(partyReminderWindow(party({ games: [] })), null);
  const early = party({ games: [{ id: 'g1', tipoff: pdt('2026-10-20T08:00:00').toISOString(), home: 'GSW', away: 'LAL', tv: null }] });
  assert.equal(partyReminderWindow(early), null);
});

test('a party is due from nine until tip-off, and on its own day only', () => {
  const parties = [party()];
  assert.deepEqual(partiesDueNow(pdt('2026-10-20T08:59:00'), parties), []);
  assert.equal(partiesDueNow(pdt('2026-10-20T09:00:00'), parties).length, 1);
  assert.equal(partiesDueNow(pdt('2026-10-20T14:00:00'), parties).length, 1, 'a server that slept still sends it');
  assert.deepEqual(partiesDueNow(pdt('2026-10-20T19:30:00'), parties), [], 'nothing once the game is on');
  assert.deepEqual(partiesDueNow(pdt('2026-10-19T09:00:00'), parties), [], 'not the day before');
  assert.deepEqual(partiesDueNow(pdt('2026-10-21T09:00:00'), parties), [], 'not the day after');
});

test('a hosted party is worth a reminder; an unhosted one needs two people', () => {
  assert.equal(partyWorthReminding(party()), true);
  assert.equal(partyWorthReminding(party({ host: null, rsvps: [{ owner: 'Amy', answer: 'in', at: '' }] })), false);
  assert.equal(partyWorthReminding(party({ host: null })), true, 'Kyle and Amy are both in');
  assert.deepEqual(partiesDueNow(pdt('2026-10-20T09:00:00'), [party({ host: null, rsvps: [{ owner: 'Amy', answer: 'in', at: '' }] })]), []);
});

// ─── Who gets what ───────────────────────────────────────────────────────────

test('everyone who is in and has an address gets one, once', () => {
  const now = pdt('2026-10-20T09:00:00');
  const first = duePartyReminders({ now, parties: [party()], owners: ['Kyle', 'Amy', 'Joel', 'Brey'], alreadySent: [] });
  assert.deepEqual(first.map((r) => r.owner).sort(), ['Amy', 'Kyle'], 'Joel is out, Brey never answered');
  assert.deepEqual(first.map((r) => r.key).sort(), [partyReminderKey('abc12345', 'Amy'), partyReminderKey('abc12345', 'Kyle')]);

  const noAddress = duePartyReminders({ now, parties: [party()], owners: ['Kyle'], alreadySent: [] });
  assert.deepEqual(noAddress.map((r) => r.owner), ['Kyle']);

  const again = duePartyReminders({ now, parties: [party()], owners: ['Kyle', 'Amy'], alreadySent: first.map((r) => r.key) });
  assert.deepEqual(again, []);
});

test('two parties on one night each get their own reminders', () => {
  const second = party({ id: 'zzz99999', host: 'Dustin', rsvps: [{ owner: 'Dustin', answer: 'in', at: '' }, { owner: 'Amy', answer: 'in', at: '' }] });
  const due = duePartyReminders({ now: pdt('2026-10-20T09:30:00'), parties: [party(), second], owners: ['Kyle', 'Amy', 'Dustin'], alreadySent: [] });
  assert.equal(due.length, 4);
  assert.equal(due.filter((r) => r.owner === 'Amy').length, 2, 'Amy is in both');
});

// ─── The words ───────────────────────────────────────────────────────────────

test('the reminder says the game, the host, the note, who is in', () => {
  const copy = partyReminderCopy(party(), 'Amy');
  assert.equal(copy.subject, "Tonight: Lakers at Warriors, 7:30 PM at Kyle's");
  assert.equal(copy.heading, 'Lakers at Warriors tonight');
  assert.equal(copy.lines[0], 'Lakers at Warriors, Tue Oct 20, 7:30 PM. Kyle is hosting.');
  assert.equal(copy.lines[1], 'Kyle is hosting.');
  assert.equal(copy.lines[2], 'Kyle says: "12 Elm St. Bring a six-pack."');
  assert.equal(copy.lines[3], 'In: Kyle and you.');
  assert.equal(copy.preheader, '12 Elm St. Bring a six-pack.');
});

test('the host hears it is theirs; an unhosted party asks somebody to take it', () => {
  assert.equal(partyReminderCopy(party(), 'Kyle').lines[1], 'You are hosting.');
  assert.equal(partyReminderCopy(party(), 'Kyle').lines[3], 'In: Amy and you.');
  const open = partyReminderCopy(party({ host: null, note: '' }), 'Amy');
  assert.equal(open.subject, 'Tonight: Lakers at Warriors, 7:30 PM, and nobody has the house yet');
  assert.equal(open.lines[1], 'Nobody has the house yet. Somebody take it.');
  assert.equal(open.lines.length, 3, 'no note line when there is no note');
});

test('undercard games are listed', () => {
  const two = party({ games: [...party().games, { id: 'g2', tipoff: pdt('2026-10-20T20:00:00').toISOString(), home: 'DEN', away: 'MIN', tv: null }] });
  const copy = partyReminderCopy(two, 'Amy');
  assert.equal(copy.lines[copy.lines.length - 1], 'Also on: Timberwolves at Nuggets, 8:00 PM.');
});

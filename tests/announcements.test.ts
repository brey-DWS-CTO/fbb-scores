import assert from 'node:assert/strict';
import test from 'node:test';
import { ANNOUNCEMENTS, announcementKey, dueAnnouncements, type Announcement } from '../src/lib/league/announcements.ts';

const one: Announcement = {
  id: 'x',
  from: '2026-10-15T23:00:00.000Z',
  until: '2026-10-18T21:00:00.000Z',
  subject: 's',
  preheader: 'p',
  heading: 'h',
  lines: ['l'],
  actionLabel: 'GO',
  actionPath: '/',
};

const due = (now: string, alreadySent: string[] = []) =>
  dueAnnouncements({ now: new Date(now), owners: ['Joel', 'Amy'], alreadySent, list: [one] }).map((d) => d.key);

test('nothing before the window opens', () => {
  assert.deepEqual(due('2026-10-15T22:59:00.000Z'), []);
});

test('everyone once inside the window', () => {
  assert.deepEqual(due('2026-10-16T00:00:00.000Z'), ['announce-x-Joel', 'announce-x-Amy']);
});

test('a member already mailed is skipped', () => {
  assert.deepEqual(due('2026-10-16T00:00:00.000Z', [announcementKey('x', 'Joel')]), ['announce-x-Amy']);
});

test('nothing after the window closes', () => {
  assert.deepEqual(due('2026-10-18T21:00:01.000Z'), []);
});

test('the VAULT note opens at 4 PM Pacific on launch day and closes at the draft', () => {
  const vault = ANNOUNCEMENTS.find((a) => a.id === 'vault-2027')!;
  assert.equal(new Date(vault.from).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }), '10/15/2026, 4:00:00 PM');
  assert.equal(new Date(vault.until).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }), '10/18/2026, 2:00:00 PM');
  for (const line of [vault.subject, vault.heading, ...vault.lines]) assert.ok(!line.includes('—'), 'no em dashes');
});

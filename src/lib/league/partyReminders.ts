/**
 * The morning-of reminder for a house party.
 *
 * At nine in the morning Pacific on the day of a party, everyone who said
 * I'M IN gets one email: the headline, the host's note, who is in, and the
 * link. The window stays open until the main game tips off, so a server
 * that slept through nine still sends it at ten, and never sends it after
 * the game is on.
 *
 * Parties live in the database, and the hourly clock must not wake the
 * database to ask whether one is today. So the clock only asks during the
 * nine and ten o'clock hours Pacific: one small read a day, two when the
 * first was missed. `partyCheckDue` is that gate. Everything else here is
 * decided from the parties already in hand.
 *
 * A reminder goes out once. The caller claims each key before it sends and
 * passes the claimed keys back next time, the same as the keeper reminders.
 *
 * Pure. No server, no browser.
 */
import {
  gameDay,
  matchupLabel,
  partyHeadline,
  partyTipoff,
  teamNickname,
  tipLabel,
  whoIsIn,
  type HouseParty,
} from './houseParty.js';
import { nameList } from './notifications.js';

/** The hour the reminder goes out, Pacific. */
export const PARTY_REMINDER_HOUR = 9;

/** The hours, Pacific, in which the clock may read the parties at all. */
export const PARTY_CHECK_HOURS: readonly number[] = [PARTY_REMINDER_HOUR, PARTY_REMINDER_HOUR + 1];

const PACIFIC = 'America/Los_Angeles';

/** Minutes Pacific is ahead of UTC at `at`. Negative: -420 in summer, -480 in winter. */
function pacificOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant of `hour` o'clock Pacific on a Pacific calendar day, YYYY-MM-DD. */
export function pacificInstant(day: string, hour: number): Date {
  const [year, month, date] = day.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour);
  // The offset at the first guess is right except across a clock change,
  // and a second look settles that.
  let guess = wall - pacificOffsetMinutes(new Date(wall)) * 60_000;
  guess = wall - pacificOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess);
}

/** The hour of the day in Pacific time, 0 to 23. */
export function pacificHour(at: Date): number {
  const text = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hourCycle: 'h23', hour: '2-digit' }).format(at);
  return Number(text) % 24;
}

/** Whether this tick of the clock may read the parties. */
export function partyCheckDue(now: Date): boolean {
  return PARTY_CHECK_HOURS.includes(pacificHour(now));
}

export function partyReminderKey(partyId: string, owner: string): string {
  return `party-day-${partyId}-${owner}`;
}

/**
 * When a party's reminder may go out: from nine that morning until the main
 * game tips off. Null for a party with no games, one called off, or one
 * whose game tips before nine, which nobody needs waking for.
 */
export function partyReminderWindow(party: Pick<HouseParty, 'games' | 'cancelledAt'>): { opensAt: Date; closesAt: Date } | null {
  if (party.cancelledAt) return null;
  const tipoff = partyTipoff(party);
  if (!tipoff) return null;
  const opensAt = pacificInstant(gameDay(tipoff), PARTY_REMINDER_HOUR);
  const closesAt = new Date(tipoff);
  if (closesAt.getTime() <= opensAt.getTime()) return null;
  return { opensAt, closesAt };
}

/**
 * A party worth a reminder has a host, or at least two people up for it.
 * One person who said they were up for a game nobody is hosting does not
 * need an email about it.
 */
export function partyWorthReminding(party: Pick<HouseParty, 'host' | 'rsvps'>): boolean {
  return party.host !== null || whoIsIn(party).length >= 2;
}

/** The parties whose reminder window is open right now. */
export function partiesDueNow(now: Date, parties: readonly HouseParty[]): HouseParty[] {
  return parties.filter((party) => {
    if (!partyWorthReminding(party)) return false;
    const window = partyReminderWindow(party);
    return window !== null && now.getTime() >= window.opensAt.getTime() && now.getTime() < window.closesAt.getTime();
  });
}

export interface DuePartyReminder {
  party: HouseParty;
  owner: string;
  key: string;
}

export interface PartyReminderInput {
  now: Date;
  parties: readonly HouseParty[];
  /** Everyone who could be mailed. An owner with no address is left out here. */
  owners: readonly string[];
  /** Keys already sent, from the store. */
  alreadySent: readonly string[];
}

/** Which party reminders should go out right now, one per guest per party. */
export function duePartyReminders(input: PartyReminderInput): DuePartyReminder[] {
  const sent = new Set(input.alreadySent);
  const canMail = new Set(input.owners);
  const due: DuePartyReminder[] = [];
  for (const party of partiesDueNow(input.now, input.parties)) {
    for (const owner of whoIsIn(party)) {
      if (!canMail.has(owner)) continue;
      const key = partyReminderKey(party.id, owner);
      if (sent.has(key)) continue;
      due.push({ party, owner, key });
    }
  }
  return due;
}

export interface PartyReminderCopy {
  subject: string;
  preheader: string;
  heading: string;
  lines: string[];
}

/** The words of the reminder, for one guest. Kept here so the tests can read them. */
export function partyReminderCopy(party: HouseParty, owner: string): PartyReminderCopy {
  const main = party.games[0];
  const where = main ? `${matchupLabel(main)}, ${tipLabel(main.tipoff)}` : 'House party';
  const hostLine = party.host
    ? party.host === owner ? 'You are hosting.' : `${party.host} is hosting.`
    : 'Nobody has the house yet. Somebody take it.';
  const guests = whoIsIn(party);
  const others = guests.filter((name) => name !== owner);
  const inLine = others.length === 0
    ? 'So far it is just you.'
    : `In: ${nameList(others)}${guests.includes(owner) ? ' and you' : ''}.`;
  const undercard = party.games.slice(1).map((game) => `Also on: ${matchupLabel(game)}, ${tipLabel(game.tipoff)}.`);
  const lines = [
    `${partyHeadline(party)}`,
    hostLine,
    ...(party.note ? [`${party.host ?? 'The note'} says: "${party.note}"`] : []),
    inLine,
    ...undercard,
  ];
  const subject = party.host
    ? `Tonight: ${where} at ${party.host}'s`
    : `Tonight: ${where}, and nobody has the house yet`;
  return {
    subject,
    preheader: party.note || inLine,
    heading: main ? `${teamNickname(main.away)} at ${teamNickname(main.home)} tonight` : 'House party tonight',
    lines,
  };
}

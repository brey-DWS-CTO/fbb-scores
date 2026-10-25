import { lmOpensAt, pacific } from './lmWeekend.js';
import type { WaiverCalendarDay } from './waiverCalendar.js';

/** One card on the LM Adds clock. A card counts down to `countdownTo`, or shows `headline`. */
export interface LmClockCard {
  label: string;
  countdownTo: string | null;
  headline: string | null;
  detail: string;
}

interface LmDay { date: string; opensAt: string; closesAt: string }

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const dayWords = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const span = (day: LmDay) => `${time(day.opensAt)} to ${time(day.closesAt)} PT`;

/**
 * Two cards about LM add windows only: today's, if today has one, then the
 * next. A weekday's waiver run never shows here; it does not change an LM add.
 */
export function lmWindowCards(now: number, days: readonly WaiverCalendarDay[]): LmClockCard[] {
  const today = pacific(new Date(now)).date;
  const lmDays: LmDay[] = days
    .filter(day => day.lmEligible && day.waiver && day.lmClosesAt && day.date >= today)
    .map(day => ({ date: day.date, opensAt: lmOpensAt(day.date, day.waiver!.hourPT), closesAt: day.lmClosesAt! }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const cards: LmClockCard[] = [];
  const first = lmDays[0];
  if (first?.date === today) {
    if (now < Date.parse(first.opensAt)) cards.push({ label: 'LM adds open in', countdownTo: first.opensAt, headline: null, detail: `Today, ${span(first)}` });
    else if (now < Date.parse(first.closesAt)) cards.push({ label: 'LM adds close in', countdownTo: first.closesAt, headline: null, detail: `Open now. Claims run every minute until ${time(first.closesAt)} PT.` });
    else cards.push({ label: 'Today', countdownTo: null, headline: 'LM adds closed', detail: `Closed at ${time(first.closesAt)} PT` });
  }
  const upcoming = lmDays.filter(day => day.date > today);
  const todayHasOne = cards.length > 0;
  if (!todayHasOne && upcoming[0]) cards.push({ label: 'Next LM window opens in', countdownTo: upcoming[0].opensAt, headline: null, detail: `${dayWords(upcoming[0].date)}, ${span(upcoming[0])}` });
  const later = upcoming[todayHasOne ? 0 : 1];
  if (later) cards.push({ label: todayHasOne ? 'Next LM day' : 'After that', countdownTo: null, headline: dayWords(later.date), detail: span(later) });
  return cards;
}

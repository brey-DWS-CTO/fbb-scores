import { LM_ADD_BUFFER_MS, firstTip, isWeekend, pacific, waiverHourFor, type DayGame, type WaiverHour } from './lmWeekend.js';


export interface WaiverCalendarDay {
  date: string;
  games: number | null;
  waiver: WaiverHour | null;
  lmEligible: boolean;
  lmClosesAt: string | null;
}

export function monthDates(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid calendar month');
  const start = new Date(`${month}-01T12:00:00Z`);
  if (!Number.isFinite(start.getTime())) throw new Error('Invalid calendar month');
  const dates: string[] = [];
  for (let date = start; date.toISOString().startsWith(month); date = new Date(date.getTime() + 86_400_000)) dates.push(date.toISOString().slice(0, 10));
  return dates;
}

/** Null means the schedule could not be read; it must not look like an empty NBA day. */
export function waiverCalendarDay(date: string, games: readonly DayGame[] | null): WaiverCalendarDay {
  if (games === null) return { date, games: null, waiver: null, lmEligible: false, lmClosesAt: null };
  const tip = firstTip(games);
  const lmEligible = isWeekend(pacific(`${date}T12:00:00-08:00`)) && tip !== null;
  return { date, games: games.length, waiver: waiverHourFor(games), lmEligible,
    lmClosesAt: lmEligible && tip ? new Date(Date.parse(tip) - LM_ADD_BUFFER_MS).toISOString() : null };
}

export interface WaiverCalendar {
  month: string;
  fetchedAt: string;
  days: WaiverCalendarDay[];
}

import { monthDates, waiverCalendarDay, type WaiverCalendar } from '../../src/lib/league/waiverCalendar.js';
import { gamesOn } from './nbaDay.js';

const cache = new Map<string, { at: number; data: Promise<WaiverCalendar> }>();
export function getWaiverCalendar(month: string): Promise<WaiverCalendar> {
  const dates = monthDates(month);
  const hit = cache.get(month);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  if (cache.size >= 12) cache.delete(cache.keys().next().value!);
  const data = Promise.allSettled(dates.map(date => gamesOn(date))).then(results => ({
    month, fetchedAt: new Date().toISOString(),
    days: results.map((result, index) => waiverCalendarDay(dates[index], result.status === 'fulfilled' ? result.value : null)),
  }));
  cache.set(month, { at: Date.now(), data });
  return data;
}

/** Fixed experiment budgets, independent of traffic and warm-process caches. */
export const EVALUATION_CAPTURE_DAYS = 28;
export const EVALUATION_SETTLE_DAYS = 14;
export const EVALUATION_DAILY_HOUR = 7;
export const EVALUATION_MAX_FORECASTS = 300;
export const EVALUATION_MAX_RESULT_GAMES = 15;
export const READONLY_TEAM_REFRESH_MS = 5 * 60_000;
export function evaluationRunDate(now: Date): string | null {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return Number(part('hour')) === EVALUATION_DAILY_HOUR ? `${part('year')}-${part('month')}-${part('day')}` : null;
}
export function evaluationDate(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function evaluationPhase(start: string, date: string): 'capture' | 'settle' | null {
  const days = (Date.parse(date + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000;
  if (!Number.isInteger(days) || days < 0 || days >= EVALUATION_CAPTURE_DAYS + EVALUATION_SETTLE_DAYS) return null;
  return days < EVALUATION_CAPTURE_DAYS ? 'capture' : 'settle';
}

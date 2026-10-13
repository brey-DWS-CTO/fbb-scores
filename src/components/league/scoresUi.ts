/**
 * Small helpers the two scores screens share: the address bar's week, day
 * and demo flags, and a tip-off in the viewer's own clock.
 */

/** A whole number from a query value, or null. */
export function numberParam(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** The query string to carry from screen to screen: the week and the demo flag. */
export function scoresQuery(input: { week?: number | null; demo?: boolean; day?: string | null; team?: number | null }): string {
  const params = new URLSearchParams();
  if (input.week !== undefined && input.week !== null) params.set('week', String(input.week));
  if (input.day) params.set('day', input.day);
  if (input.team !== undefined && input.team !== null) params.set('team', String(input.team));
  if (input.demo) params.set('demo', '1');
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** "7:30 PM" in the viewer's time zone, from an ISO tip-off. Null when there is none. */
export function tipoffText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

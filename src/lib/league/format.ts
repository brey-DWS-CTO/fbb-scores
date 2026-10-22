/** Format the configured draft time in the viewer's local time zone. */
export function formatDraftAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** An em dash for missing numbers, one decimal place otherwise. */
export const fmt1 = (value: number | null | undefined): string =>
  value == null ? '—' : value.toFixed(1);

/**
 * A player as the league writes him: first initial, a dot, the rest. Giannis
 * Antetokounmpo reads "G. Antetokounmpo", Gary Trent Jr. reads "G. Trent Jr.".
 * A one-word name stays as it is, and so does a "Player 12345" placeholder.
 */
export function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1])) return parts.join(' ');
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/** Compact game rows: first name and surname initial, ignoring generational suffixes. */
export function firstNameLastInitial(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1])) return parts.join(' ');
  while (parts.length > 2 && /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[parts.length - 1])) parts.pop();
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

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

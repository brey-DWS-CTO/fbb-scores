export type ScheduleHeat = 'very-low' | 'low' | 'mid' | 'good' | 'high' | 'neutral';

/** Workbook rule: 2 = red, 3 = yellow, 4 = light green, 5+ = dark green. */
export function gameCountHeat(games: number): ScheduleHeat {
  if (games <= 2) return 'very-low';
  if (games === 3) return 'mid';
  if (games === 4) return 'good';
  return 'high';
}

/** Rank a summary value from the lowest to highest value in its metric. */
export function relativeScheduleHeat(value: number, values: readonly number[]): ScheduleHeat {
  if (values.length === 0) return 'neutral';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return 'neutral';
  const position = (value - min) / (max - min);
  if (position === 0) return 'very-low';
  if (position <= 1 / 3) return 'low';
  if (position <= 2 / 3) return 'mid';
  if (position < 1) return 'good';
  return 'high';
}

export function scheduleHeatLabel(heat: ScheduleHeat): string {
  if (heat === 'very-low') return 'lowest';
  if (heat === 'low') return 'below average';
  if (heat === 'mid') return 'middle';
  if (heat === 'good') return 'above average';
  if (heat === 'high') return 'highest';
  return 'even';
}

/* ------------------------------------------------------------------ */
/* Column sorting                                                      */
/* ------------------------------------------------------------------ */

export type SortDirection = 'asc' | 'desc';

/** Which column a table is sorted by, and which way. Null means source order. */
export interface ColumnSort<Key> {
  key: Key;
  direction: SortDirection;
}

/**
 * Tap the same header again to walk the cycle. Fewest first comes first
 * because the commish opens this grid to hunt for light weeks.
 */
export function toggleColumnSort<Key>(
  current: ColumnSort<Key> | null,
  key: Key,
): ColumnSort<Key> | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/** Sort rows by a number. Ties keep their source order, so the grid stays steady. */
export function sortRowsByNumber<Row>(
  rows: readonly Row[],
  value: (row: Row) => number,
  direction: SortDirection | null,
): Row[] {
  if (!direction) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const gap = value(a.row) - value(b.row);
      if (gap !== 0) return direction === 'asc' ? gap : -gap;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function ariaSortValue(direction: SortDirection | null): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

export function sortDirectionLabel(direction: SortDirection): string {
  return direction === 'asc' ? 'fewest first' : 'most first';
}

/** What the next tap on this header will do, for the button label. */
export function nextSortLabel(direction: SortDirection | null): string {
  if (direction === null) return 'sort fewest first';
  if (direction === 'asc') return 'sort most first';
  return 'clear the sort';
}

/** Narrow phone label for a league period, so the frozen column stays slim. */
export function shortPeriodLabel(label: string): string {
  const week = /^Week (\d+)$/.exec(label);
  if (week) return `W${week[1]}`;
  const playIn = /^Play-In (\d+)$/.exec(label);
  if (playIn) return `PI ${playIn[1]}`;
  const playoff = /^Playoff Round (\d+) · Week (\d+)$/.exec(label);
  if (playoff) return `R${playoff[1]} W${playoff[2]}`;
  return label;
}

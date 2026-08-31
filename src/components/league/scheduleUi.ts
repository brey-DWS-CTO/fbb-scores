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

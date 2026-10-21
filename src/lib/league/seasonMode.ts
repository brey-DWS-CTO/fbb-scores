import { pacific } from './lmWeekend.js';
import { leagueSchedule2027 } from './scheduleData.js';

export type SeasonMode = 'in-season' | 'off-season';

export function isSeasonMode(value: unknown): value is SeasonMode {
  return value === 'in-season' || value === 'off-season';
}

/** Until the commissioner chooses, use the earlier Pacific day: draft close or week 1. */
export function resolveSeasonMode(
  state: { seasonMode?: SeasonMode; draft: { closedAt?: string | null } },
  now = new Date(),
): SeasonMode {
  if (isSeasonMode(state.seasonMode)) return state.seasonMode;
  const today = pacific(now).date;
  const closedAt = state.draft.closedAt;
  const closedDay = closedAt && Number.isFinite(Date.parse(closedAt)) ? pacific(closedAt).date : null;
  return today >= leagueSchedule2027[0].startDate || (closedDay !== null && today >= closedDay)
    ? 'in-season' : 'off-season';
}

/** The signed-in home follows the league mode, including commissioner overrides. */
export function seasonHome(mode: SeasonMode): '/scores' | '/keepers' {
  return mode === 'in-season' ? '/scores' : '/keepers';
}

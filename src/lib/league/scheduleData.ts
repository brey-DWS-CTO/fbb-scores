import rawSchedule from '../../data/source/basketball-monster-schedule-2027.json';
import {
  buildLeagueSchedule,
  normalizeScheduleSource,
  summarizeAllTeamSchedules,
} from './schedule.js';

/** Provisional 2026-27 NBA schedule captured from Basketball Monster. */
export const scheduleSnapshot2027 = normalizeScheduleSource(rawSchedule);

/** The league's 22 fantasy periods, including the 2027 All-Star merge in Play-In 2. */
export const leagueSchedule2027 = buildLeagueSchedule(scheduleSnapshot2027);

/** Per-team regular, Play-In, round, and total game counts for projections. */
export const teamScheduleSummaries2027 = summarizeAllTeamSchedules(leagueSchedule2027);

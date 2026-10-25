import { CONFIG_TEAMS, getState, mutateState, listGamesCaps } from './leagueStore.js';
import { emptyMissedLedger, missedWeekKey, missedGamesReport, readMissedWeek, reportDate } from '../../src/lib/league/missedGames.js';
import { loadScoresWeek } from './scoresWeekService.js';
import type { ScoresWeek } from '../../src/lib/league/scores.js';
export async function readMissedGamesReport(now = new Date()) {
  const { state } = await getState();
  return missedGamesReport(state.missedGames ?? emptyMissedLedger(), state.season, CONFIG_TEAMS, await listGamesCaps(state.season), now);
}
export async function refreshMissedGames(period: number | null, now = new Date(), load: (period: number | null) => Promise<ScoresWeek> = loadScoresWeek) {
  const week = await load(period);
  const { state } = await getState();
  if (week.season !== state.season) throw new Error('ESPN season does not match the league.');
  const ref = week.weeks.find(w => w.matchupPeriodId === week.matchupPeriodId);
  const row = ref?.phase === 'regular' ? readMissedWeek(week, CONFIG_TEAMS.map(t => t.espnTeamId), now) : null;
  await mutateState(draft => {
    if (draft.season !== week.season) throw new Error('Season changed during refresh.');
    draft.missedGames ??= emptyMissedLedger();
    draft.missedGames.calendar = week.weeks;
    if (row) {
      const key = missedWeekKey(row.season, row.matchupPeriodId);
      const previous = draft.missedGames.weeks[key];
      if ((!previous || previous.status !== 'final' || row.status === 'final') && (!previous || previous.fetchedAt <= row.fetchedAt)) draft.missedGames.weeks[key] = row;
    }
  });
  return readMissedGamesReport(now);
}
/** Daily catch-up in the existing hourly clock; one historical week per run. */
export async function runMissedGamesClock(now: Date) {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(now);
  if (hour !== '08') return { skipped: true };
  const { state } = await getState();
  const ledger = state.missedGames ?? emptyMissedLedger();
  const missing = ledger.calendar.filter(w => w.phase === 'regular' && w.endDate < reportDate(now)
    && ledger.weeks[missedWeekKey(state.season, w.matchupPeriodId)]?.status !== 'final');
  let report = await refreshMissedGames(missing[0]?.matchupPeriodId ?? null, now);
  if (!missing.length && report.pendingWeeks.length) report = await refreshMissedGames(report.pendingWeeks[0], now);
  return { pendingWeeks: report.pendingWeeks };
}

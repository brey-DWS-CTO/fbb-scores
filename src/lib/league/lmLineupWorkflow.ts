export interface LmLineupContext { leagueId: string; teamId: number; scoringPeriodId: number }
function validContext(context: LmLineupContext): boolean {
  return /^\d+$/.test(context.leagueId) && Number.isSafeInteger(context.teamId) && context.teamId > 0
    && Number.isSafeInteger(context.scoringPeriodId) && context.scoringPeriodId >= 0;
}
/** Observed UI route, not an ESPN write endpoint. No roster mutation is sent. */
export function lmTeamManagerEditorUrl(context: LmLineupContext): string {
  if (!validContext(context)) throw new Error('Invalid LM lineup context.');
  const url = new URL('https://fantasy.espn.com/basketball/tools/lmeditlineup');
  url.searchParams.set('leagueId', context.leagueId);
  url.searchParams.set('teamId', String(context.teamId));
  url.searchParams.set('isActingAsTeamOwner', 'true');
  url.searchParams.set('scoringPeriodId', String(context.scoringPeriodId));
  return url.toString();
}
/** A future browser worker must check this again immediately before a move. */
export function assertLmTeamManagerContext(actualUrl: string, expected: LmLineupContext): void {
  if (!validContext(expected)) throw new Error('Invalid LM lineup context.');
  let actual: URL;
  try { actual = new URL(actualUrl); } catch { throw new Error('ESPN editor context is unavailable.'); }
  const keys = ['leagueId', 'teamId', 'isActingAsTeamOwner', 'scoringPeriodId'];
  if (actual.origin !== 'https://fantasy.espn.com' || actual.pathname !== '/basketball/tools/lmeditlineup'
    || actual.username || actual.password || actual.hash
    || [...actual.searchParams.keys()].some(key => !keys.includes(key))
    || keys.some(key => actual.searchParams.getAll(key).length !== 1)
    || actual.searchParams.get('leagueId') !== expected.leagueId
    || actual.searchParams.get('teamId') !== String(expected.teamId)
    || actual.searchParams.get('scoringPeriodId') !== String(expected.scoringPeriodId)
    || actual.searchParams.get('isActingAsTeamOwner') !== 'true') {
    throw new Error('ESPN editor must match the authorized team, date, and Team Manager role.');
  }
}

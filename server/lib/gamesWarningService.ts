import { gamesCapStatus, gamesWarningDate, gamesWarningKey, lineupGames } from '../../src/lib/league/lineupGames.js';
import { capForWeek } from '../../src/lib/league/gamesCap.js';
import type { ScoresWeek } from '../../src/lib/league/scores.js';
import { CONFIG_TEAMS, claimSentNotice, getOwnerEmails, listGamesCaps } from './leagueStore.js';
import { sendMail } from './mailer.js';
import { loadCurrentScoresWeek } from './scoresWeekService.js';

/** Run from the hourly clock; the Pacific time gate keeps DST at 7 AM. */
export async function runGamesWarnings(
  now: Date,
  origin: string,
  load: () => Promise<ScoresWeek> = loadCurrentScoresWeek,
): Promise<{ due: number; sent: number }> {
  const date = gamesWarningDate(now);
  if (!date) return { due: 0, sent: 0 };
  const loaded = await load();
  // No off-season, stale-week, or incomplete-schedule warnings.
  if (loaded.matchupPeriodId !== loaded.currentMatchupPeriodId
    || !loaded.days.some((day) => day.date === date)) return { due: 0, sent: 0 };
  const [caps, emails] = await Promise.all([listGamesCaps(loaded.season), getOwnerEmails()]);
  const book = new Map(emails.filter((row) => row.email).map((row) => [row.owner, row.email]));
  const week = { ...loaded, gamesCap: capForWeek(caps, loaded.matchupPeriodId, loaded.gamesCap) };
  let due = 0;
  let sent = 0;
  for (const matchup of week.matchups) {
    if (matchup.winner !== 'UNDECIDED') continue;
    for (const side of [matchup.home, matchup.away]) {
      const owner = CONFIG_TEAMS.find((team) => team.espnTeamId === side.teamId)?.owner;
      const address = owner ? book.get(owner) : undefined;
      const games = lineupGames(side, week);
      if (!address || games.estimated || games.difference === null || games.difference === 0 || side.players.length === 0) continue;
      due += 1;
      const key = gamesWarningKey(week.season, week.matchupPeriodId, date, side.teamId);
      if (!(await claimSentNotice(key, week.season))) continue;
      const status = gamesCapStatus(games);
      const result = await sendMail(address, {
        subject: `Lineup warning: ${status}`,
        preheader: `${games.projected} projected games against a cap of ${games.cap}.`,
        heading: `You are projected ${status}`,
        lines: [
          `${side.name}: ${games.projected} projected games against this week's cap of ${games.cap}.`,
          `${games.played} games played + ${games.remaining} remaining in your current lineup.`,
          games.difference > 0 ? 'Review your lineup and bench players to avoid going over the cap.' : 'Review your lineup for chances to use your remaining games.',
        ],
        action: { label: 'CHECK YOUR MATCHUP', href: `${origin}/scores/${matchup.id}?week=${week.matchupPeriodId}` },
        notes: ['Based on the lineup and schedule at 7 AM Pacific. Bench and IR do not count. Out and suspended players have no projected games. Lineup changes can change this forecast.'],
      }, origin, 'notify');
      if (result.ok) sent += 1;
    }
  }
  return { due, sent };
}

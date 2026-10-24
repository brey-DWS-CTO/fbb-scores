import { historicalScoreBaselines } from '../lib/league/scoreBaseline.js';
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDailyScorers, fetchGamesCaps, fetchScoresWeek } from '../lib/league/api.js';
import { courtReads, type CourtRead } from '../lib/league/fouls.js';
import { expectedPointsForGame } from '../lib/league/dailyProjection.js';
import { projectedFppg } from '../lib/league/draftRankings.js';
import { capForWeek, type GamesCapRow } from '../lib/league/gamesCap.js';
import { localDateIso, type ExpectedPoints, type ScorePlayer, type ScoresWeek } from '../lib/league/scores.js';
import { useProjectionData } from './useProjectionData.js';

/** How often the current week asks ESPN again while someone is looking. */
export const SCORES_POLL_MS = 60_000;

export const GAMES_CAPS_KEY = ['games-caps'] as const;

/**
 * The weekly games caps, and the cap for any week: what the commissioner
 * set, else ESPN's limit for the week, else the default.
 */
export function useGamesCaps(): { rows: GamesCapRow[]; capFor: (matchupPeriodId: number, espnCap?: number | null) => number } {
  const query = useQuery({ queryKey: GAMES_CAPS_KEY, queryFn: fetchGamesCaps, staleTime: 60_000 });
  const rows = useMemo(() => query.data?.caps ?? [], [query.data]);
  const capFor = useCallback(
    (matchupPeriodId: number, espnCap: number | null = null) => capForWeek(rows, matchupPeriodId, espnCap),
    [rows],
  );
  return { rows, capFor };
}

/**
 * One fantasy week of scores. The current week keeps asking while the tab
 * is open; a past week is read once. `demo` swaps ESPN for the seeded fake
 * week, loaded only when asked for so it never weighs on the real page.
 */
export function useScoresWeek(matchupPeriod: number | null, demo: boolean, enabled = true, shouldPoll: () => boolean = () => true) {
  return useQuery<ScoresWeek>({
    queryKey: ['scores-week', demo ? 'demo' : (matchupPeriod ?? 'current')],
    queryFn: demo
      ? async () => (await import('../lib/league/scoresDemo.js')).demoWeek()
      : () => fetchScoresWeek(matchupPeriod),
    select: (week) => {
      if (demo) return week;
      const today = week.days.find((day) => day.date === localDateIso(new Date()));
      return today ? { ...week, currentScoringPeriodId: today.scoringPeriodId } : week;
    },
    enabled,
    staleTime: 30_000,
    retry: demo ? false : 1,
    refetchInterval: (query) => {
      if (demo || !shouldPoll()) return false;
      const week = query.state.data;
      return week && week.matchupPeriodId === week.currentMatchupPeriodId ? SCORES_POLL_MS : false;
    },
  });
}

/**
 * Expected points for a player's game on a day: ESPN's projection for
 * that day when it sends one, else a blend of his last 15 days, his
 * season so far and the commissioner's preseason projection. See
 * `dailyProjection.ts` for the weights.
 */
export function useExpectedPoints(): ExpectedPoints {
  const { snapshot } = useProjectionData();
  return useMemo(() => {
    const byId = new Map(historicalScoreBaselines);
    if (snapshot) {
      for (const player of snapshot.players) {
        const value = projectedFppg(player.projection, snapshot.scoringItems);
        if (value !== null) byId.set(player.espnId, value);
      }
    }
    return (player: ScorePlayer, scoringPeriodId: number) =>
      expectedPointsForGame(player, { scoringPeriodId, preseason: byId.get(player.id) ?? null });
  }, [snapshot]);
}

const NO_COURT: ReadonlyMap<string, CourtRead> = new Map();

/**
 * Who is on the floor and who is in foul trouble, by ESPN athlete id, for
 * one date's started games. Shares the Top Performers read, so a phone on
 * both pages asks once. Off unless a game that day is live or just ended.
 */
export function useCourt(date: string | null, enabled: boolean): ReadonlyMap<string, CourtRead> {
  const query = useQuery({
    queryKey: ['daily-scorers', date],
    queryFn: () => fetchDailyScorers(date!),
    enabled: enabled && date !== null,
    staleTime: 30_000,
    refetchInterval: enabled ? SCORES_POLL_MS : false,
    retry: 1,
  });
  return useMemo(() => (query.data ? courtReads(query.data.boxScores) : NO_COURT), [query.data]);
}

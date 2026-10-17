import { useMemo } from 'react';
import type { BoardCell, LeagueDataset, LeagueDynamicState } from '../lib/keeper/types.js';
import { valueBoard } from '../lib/league/draftValue.js';
import { oddsGoneFromClock } from '../lib/league/liveMock.js';
import { buildMockBoard, defaultMockSettings, prepareMock } from '../lib/league/mockDraft.js';
import type { PickNumbers, PickNumbersByKey } from '../lib/league/pickSheet.js';
import { buildProjections, type PlayerProjection } from '../lib/league/projections.js';
import { leagueSchedule2027 } from '../lib/league/scheduleData.js';
import { useProjectionData } from './useProjectionData.js';

/** The odds use one fixed seed so a number does not jump between polls. */
const ODDS_SEED = 1;
const ODDS_RUNS = 60;

/**
 * The numbers for the live draft: projections, play-in and playoff games, and
 * how often each player is gone before the viewer's own next pick. Nothing is
 * fetched or simulated while `enabled` is false, and the odds, the costly
 * part, run only while `odds` is on.
 */
export function useDraftNumbers(input: {
  enabled: boolean;
  /** Run the gone odds. Defaults to on. */
  odds?: boolean;
  dataset: LeagueDataset;
  state: LeagueDynamicState;
  onClock: BoardCell | null;
  /** The viewer's own team, whose next pick the odds count to. */
  person: string | null;
}): {
  numbers: PickNumbersByKey | null;
  projections: ReadonlyMap<string, PlayerProjection>;
  /** Share of drafts each player is gone in, or null while the odds are off. */
  gone: ReadonlyMap<string, number> | null;
  loading: boolean;
} {
  const { enabled, dataset, state, onClock, person } = input;
  const odds = enabled && input.odds !== false;
  const { snapshot, original, edits, loading } = useProjectionData(enabled);

  const values = useMemo(
    () => (enabled && snapshot
      ? valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027, projectionsOnly: true })
      : null),
    [enabled, dataset.players, snapshot],
  );

  const projections = useMemo(
    () => (values && snapshot ? buildProjections(values, snapshot, { keepers: {}, status: {} }, edits, original) : []),
    [values, snapshot, edits, original],
  );

  const byKey = useMemo(() => new Map(projections.map((row) => [row.key, row])), [projections]);

  const onClockOverall = onClock?.pick.overall ?? null;
  const gone = useMemo(() => {
    if (!odds || !values || onClockOverall === null || !person) return new Map<string, number>();
    const board = buildMockBoard(dataset, { viewer: person, state, scenario: {}, useEntered: true });
    const owners = dataset.teams.map((team) => team.owner);
    const prepared = prepareMock({ board, values, settings: defaultMockSettings('realistic', owners, ODDS_SEED) });
    return oddsGoneFromClock(prepared, ODDS_SEED, person, onClockOverall, ODDS_RUNS);
  }, [odds, values, onClockOverall, person, dataset, state]);

  const numbers = useMemo((): PickNumbersByKey | null => {
    if (!enabled || !values) return null;
    const out = new Map<string, PickNumbers>();
    for (const row of projections) {
      out.set(row.key, {
        fppg: row.fppg,
        total: row.total,
        adp: row.adp,
        rank: row.valueRank,
        playIn: row.playInGames,
        playoff: row.playoffGames,
        gone: gone.size > 0 ? gone.get(row.key) ?? 0 : null,
      });
    }
    return out;
  }, [enabled, values, projections, gone]);

  return { numbers, projections: byKey, gone: odds && gone.size > 0 ? gone : null, loading: enabled && loading };
}

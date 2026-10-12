import { useMemo } from 'react';
import type { BoardCell, LeagueDataset, LeagueDynamicState } from '../lib/keeper/types.js';
import { valueBoard } from '../lib/league/draftValue.js';
import { oddsGoneFromClock } from '../lib/league/liveMock.js';
import { buildMockBoard, defaultMockSettings, prepareMock } from '../lib/league/mockDraft.js';
import type { PickNumbers, PickNumbersByKey } from '../lib/league/pickSheet.js';
import { buildProjections } from '../lib/league/projections.js';
import { leagueSchedule2027 } from '../lib/league/scheduleData.js';
import { useProjectionData } from './useProjectionData.js';

/** The odds use one fixed seed so a number does not jump between polls. */
const ODDS_SEED = 1;
const ODDS_RUNS = 60;

/**
 * The commissioner's numbers for the live picker: projections, play-in and
 * playoff games, and how often each player is gone before his own next pick.
 * Null for anyone else, and nothing is fetched or simulated for them.
 */
export function useDraftNumbers(input: {
  enabled: boolean;
  dataset: LeagueDataset;
  state: LeagueDynamicState;
  onClock: BoardCell | null;
  /** The commissioner's own team, whose next pick the odds count to. */
  person: string | null;
}): { numbers: PickNumbersByKey | null; loading: boolean } {
  const { enabled, dataset, state, onClock, person } = input;
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

  const onClockOverall = onClock?.pick.overall ?? null;
  const gone = useMemo(() => {
    if (!values || onClockOverall === null || !person) return new Map<string, number>();
    const board = buildMockBoard(dataset, { viewer: person, state, scenario: {}, useEntered: true });
    const owners = dataset.teams.map((team) => team.owner);
    const prepared = prepareMock({ board, values, settings: defaultMockSettings('realistic', owners, ODDS_SEED) });
    return oddsGoneFromClock(prepared, ODDS_SEED, person, onClockOverall, ODDS_RUNS);
  }, [values, onClockOverall, person, dataset, state]);

  const numbers = useMemo((): PickNumbersByKey | null => {
    if (!enabled || !values) return null;
    const out = new Map<string, PickNumbers>();
    for (const row of projections) {
      out.set(row.key, {
        fppg: row.fppg,
        adp: row.adp,
        rank: row.valueRank,
        playIn: row.playInGames,
        playoff: row.playoffGames,
        gone: gone.size > 0 ? gone.get(row.key) ?? 0 : null,
      });
    }
    return out;
  }, [enabled, values, projections, gone]);

  return { numbers, loading: enabled && loading };
}

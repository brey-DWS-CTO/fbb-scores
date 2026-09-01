/**
 * The Nerds League keeper/draft engine — pure functions, safe for client and server.
 *
 * Rules implemented (Constitution sec. 4 + Keeper Worksheet conventions):
 * - Keeper tiers: all players with >25 GP ranked by prior-season FPPG; pick cost = decile
 *   (rank 1-10 → round 1, 11-20 → round 2, ... 91+ → round 10).
 * - Tier bands: round min = FPPG of rank (round*10); round max = previous round's min − 0.1
 *   (round 1 max = top player's FPPG; round 10 min = 0).
 * - ≤25 GP in prior season → the season-before average is used (both for tier slotting by
 *   value and for the salary cap). 0 GP in prior season → flat 3rd-round pick.
 * - Salary cap = round-3 max + round-3 min. Sum of keeper effective FPPGs must not exceed it.
 * - Two keepers in the same tier: second consumes the next-better owned pick.
 * - Traded-away pick: keeper cost walks up to the next-better owned pick.
 * - Contracts: max years from ORIGINAL round at first keep (1:1, 2-4:2, 5-7:3, 8-10:4);
 *   cost re-derives from current tiers each year; contract travels with trades, never resets.
 */
import type {
  BoardCell,
  DatasetPlayer,
  KeeperSelection,
  LeagueDataset,
  LeagueDynamicState,
  LeagueOverrides,
  PickSlot,
  ResolvedKeeper,
  TeamKeeperResult,
  TierBand,
} from './types.js';

/**
 * Apply commissioner overrides (custom cap, per-player round tweaks) to the
 * static dataset. Cheap enough to run per render behind a useMemo.
 */
export function applyOverrides(
  dataset: LeagueDataset,
  overrides: LeagueOverrides | undefined,
): LeagueDataset {
  if (!overrides || (overrides.cap == null && !Object.keys(overrides.playerRounds ?? {}).length)) {
    return dataset;
  }
  const rounds = overrides.playerRounds ?? {};
  return {
    ...dataset,
    cap: overrides.cap ?? dataset.cap,
    players: dataset.players.map((p) =>
      rounds[p.key] !== undefined
        ? {
            ...p,
            keeper: {
              ...p.keeper,
              round: rounds[p.key],
              flags: [...p.keeper.flags.filter((f) => f !== 'commissioner-override'), 'commissioner-override'],
            },
          }
        : p,
    ),
  };
}

export const KEEPER_ROUNDS = 10;

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* Tier computation (used at dataset build time)                       */
/* ------------------------------------------------------------------ */

export interface TierInput {
  key: string;
  avg2026: number | null; // league-official prior-season FPPG
  gp2026: number;
  priorAvg: number | null; // season-before FPPG (2025)
  /** true when avg2026 comes from the league-official list (occupies a rank);
   * false for API-window depth players who only value-slot into bands. */
  ranked: boolean;
}

export interface TierAssignment {
  key: string;
  round: number | null;
  rank: number | null;
  effectiveAvg: number | null;
  usesPriorYear: boolean;
  zeroGp: boolean;
}

export interface TierComputation {
  bands: TierBand[];
  cap: number;
  capRule: { round3Max: number; round3Min: number };
  assignments: Map<string, TierAssignment>;
}

export function computeTiers(
  players: TierInput[],
  maxYearsByRound: Record<string, number>,
): TierComputation {
  const qualified = players
    .filter((p) => p.ranked && p.avg2026 !== null && p.gp2026 > 25)
    .sort((a, b) => (b.avg2026! - a.avg2026!));

  // Bands from qualified deciles
  const bands: TierBand[] = [];
  for (let r = 1; r <= KEEPER_ROUNDS; r++) {
    const min =
      r === KEEPER_ROUNDS
        ? 0
        : qualified[r * 10 - 1]?.avg2026 ?? 0;
    const max =
      r === 1
        ? qualified[0]?.avg2026 ?? 0
        : round1((bands[r - 2].min) - 0.1);
    bands.push({ round: r, max, min, maxYears: maxYearsByRound[String(r)] ?? 4 });
  }
  const round3Max = bands[2].max;
  const round3Min = bands[2].min;
  const cap = round1(round3Max + round3Min);

  const assignments = new Map<string, TierAssignment>();

  qualified.forEach((p, i) => {
    const rank = i + 1;
    assignments.set(p.key, {
      key: p.key,
      round: Math.min(KEEPER_ROUNDS, Math.ceil(rank / 10)),
      rank,
      effectiveAvg: p.avg2026,
      usesPriorYear: false,
      zeroGp: false,
    });
  });

  // Value-slot substitutes (≤25 GP) and handle 0-GP players
  for (const p of players) {
    if (assignments.has(p.key)) continue;
    const zeroGp = p.gp2026 === 0;
    if (zeroGp) {
      assignments.set(p.key, {
        key: p.key,
        round: p.priorAvg !== null || p.avg2026 !== null ? 3 : null,
        rank: null,
        effectiveAvg: p.priorAvg,
        usesPriorYear: p.priorAvg !== null,
        zeroGp: true,
      });
      continue;
    }
    // ≤25 GP → prior-season average; unranked depth players (>25 GP but not on
    // the official list) → their own average. Either way: slot by value.
    const usesPrior = p.gp2026 <= 25 && p.priorAvg !== null;
    const eff = usesPrior ? p.priorAvg : (p.avg2026 ?? p.priorAvg);
    let round: number | null = null;
    if (eff !== null) {
      round = KEEPER_ROUNDS;
      for (const b of bands) {
        if (eff >= b.min) {
          round = b.round;
          break;
        }
      }
    }
    assignments.set(p.key, {
      key: p.key,
      round,
      rank: null,
      effectiveAvg: eff,
      usesPriorYear: usesPrior,
      zeroGp: false,
    });
  }

  return { bands, cap, capRule: { round3Max, round3Min }, assignments };
}

/* ------------------------------------------------------------------ */
/* Draft board picks + ownership                                       */
/* ------------------------------------------------------------------ */

/** Serpentine slot for a team's draft position in a given round. */
export function slotFor(round: number, draftPosition: number, teamCount = 10): number {
  return round % 2 === 1 ? draftPosition : teamCount + 1 - draftPosition;
}

export function overallFor(round: number, slot: number, teamCount = 10): number {
  return (round - 1) * teamCount + slot;
}

export function pickLabel(pick: PickSlot): string {
  return `${pick.round}.${pick.slot}`;
}

/** All picks in the draft with trade-adjusted ownership, ordered by overall. */
export function buildAllPicks(dataset: LeagueDataset): PickSlot[] {
  const teams = [...dataset.teams].sort((a, b) => a.draftPosition - b.draftPosition);
  const byOwner = new Map(teams.map((t) => [t.owner, t]));
  const picks: PickSlot[] = [];
  for (let r = 1; r <= dataset.draftRounds; r++) {
    for (const t of teams) {
      const slot = slotFor(r, t.draftPosition, teams.length);
      picks.push({
        round: r,
        slot,
        overall: overallFor(r, slot, teams.length),
        originalOwner: t.owner,
        currentOwner: t.owner,
      });
    }
  }
  // Trades apply in order, so a pick can move through several owners and the
  // last one wins. The seed records name only `from`, which is also the team
  // the pick came from; in-app transfers name `originalOwner` explicitly
  // because by then `from` is a later holder.
  for (const trade of dataset.pickTrades) {
    if (!byOwner.has(trade.from) || !byOwner.has(trade.to)) continue;
    const origin = trade.originalOwner ?? trade.from;
    const pick = picks.find((p) => p.round === trade.round && p.originalOwner === origin);
    if (pick) {
      pick.currentOwner = trade.to;
      pick.viaTradeFrom = trade.from;
      pick.tradeNote = trade.tradeNote;
      pick.tradeDate = trade.date;
      pick.tradeCount = (pick.tradeCount ?? 0) + 1;
    }
  }
  return picks.sort((a, b) => a.overall - b.overall);
}

/** Picks currently owned by a team within the keeper-costable rounds (1-10). */
export function ownedKeeperPicks(dataset: LeagueDataset, owner: string): PickSlot[] {
  return buildAllPicks(dataset).filter(
    (p) => p.currentOwner === owner && p.round <= KEEPER_ROUNDS,
  );
}

/* ------------------------------------------------------------------ */
/* Keeper resolution                                                   */
/* ------------------------------------------------------------------ */

const STATUS = {
  none: 'We want KEEPERS, but we want them to come into the league LEGALLY!',
  good: 'These are best keepers, believe me.',
  overCap: 'ILLEGAL KEEPERS! YA FIRED!',
  pickDup:
    'STOP THE COUNT! Your pick costs are the same. A pick of equal or higher value is used to keep the other player.',
  pickTraded: 'LOSER! You traded this pick and must use the next highest pick.',
  pickGood: 'Make your team great again!',
  pickNone: 'Pick some big, beautiful players already!',
} as const;

export function playerByKey(dataset: LeagueDataset, key: string): DatasetPlayer | null {
  return dataset.players.find((p) => p.key === key) ?? null;
}

export function contractProjection(
  dataset: LeagueDataset,
  player: DatasetPlayer,
  tierRound: number | null,
): ResolvedKeeper['contract'] {
  const season = dataset.season; // 2027
  const c = player.keeper.contract;
  if (c && !c.expired && c.lastKeepableSeason >= season) {
    return {
      isNew: false,
      originalRound: c.originalRound,
      firstKeptSeason: c.firstKeptSeason,
      lastKeepableSeason: c.lastKeepableSeason,
      yearsUsedThrough2027: season - c.firstKeptSeason + 1,
      yearsLeftAfter2027: c.lastKeepableSeason - season,
    };
  }
  const originalRound = tierRound ?? KEEPER_ROUNDS;
  const maxYears = dataset.contractMaxYearsByRound[String(originalRound)] ?? 4;
  return {
    isNew: true,
    originalRound,
    firstKeptSeason: season,
    lastKeepableSeason: season + maxYears - 1,
    yearsUsedThrough2027: 1,
    yearsLeftAfter2027: maxYears - 1,
  };
}

/**
 * Resolve a team's keeper selections into pick costs, contract projections and
 * validation results. Priciest keeper (lowest tier round) is assigned first;
 * each keeper consumes the worst owned pick at or better than its tier round.
 */
export function resolveTeamKeepers(
  dataset: LeagueDataset,
  owner: string,
  selections: KeeperSelection[],
): TeamKeeperResult {
  const errors: string[] = [];
  const capLimit = dataset.cap;

  if (selections.length > dataset.maxKeepersPerTeam) {
    errors.push(`Max ${dataset.maxKeepersPerTeam} keepers per team.`);
  }

  const available = ownedKeeperPicks(dataset, owner); // sorted by overall asc
  const used = new Set<number>(); // overall numbers consumed

  const enriched = selections.map((sel) => {
    const player = playerByKey(dataset, sel.playerKey);
    return { sel, player, round: player?.keeper.round ?? null };
  });

  // Assign priciest first (lowest round; tie → higher avg first)
  const order = [...enriched].sort((a, b) => {
    const ra = a.round ?? KEEPER_ROUNDS + 1;
    const rb = b.round ?? KEEPER_ROUNDS + 1;
    if (ra !== rb) return ra - rb;
    return (b.player?.keeper.effectiveAvg ?? 0) - (a.player?.keeper.effectiveAvg ?? 0);
  });

  const resolvedByKey = new Map<KeeperSelection, ResolvedKeeper>();
  const sameTier =
    enriched.length === 2 &&
    enriched[0].round !== null &&
    enriched[0].round === enriched[1].round;

  for (const item of order) {
    const kErrors: string[] = [];
    const { sel, player, round } = item;
    let pick: PickSlot | null = null;
    let bumped = false;
    let bumpReason: ResolvedKeeper['bumpReason'] = null;

    if (!player) {
      kErrors.push(`Unknown player: ${sel.playerName}`);
    } else {
      if (!player.keeper.eligible || player.fantasyTeam !== owner) {
        kErrors.push(
          player.fantasyTeam
            ? `${player.name} finished the season on ${player.fantasyTeam}'s roster — only they can keep him.`
            : `${player.name} wasn't on anyone's final roster, so nobody can keep him.`,
        );
      }
      const c = player.keeper.contract;
      if (c && (c.expired || c.lastKeepableSeason < dataset.season)) {
        kErrors.push(
          `${player.name}'s keeper contract has EXPIRED — he must re-enter the draft pool.`,
        );
      }
      if (round === null) {
        kErrors.push(`${player.name} has no keeper tier (no usable stats).`);
      }
    }

    if (player && round !== null && kErrors.length === 0) {
      // worst owned pick at or better (lower round #) than the tier round
      const candidates = available
        .filter((p) => p.round <= round && !used.has(p.overall))
        .sort((a, b) => b.overall - a.overall);
      pick = candidates[0] ?? null;
      if (!pick) {
        kErrors.push(
          `${player.name} costs a round-${round} pick but you have no pick left in rounds 1-${round}.`,
        );
      } else if (pick.round < round) {
        bumped = true;
        // Only giving away your OWN round-N pick makes this a traded bump. A
        // pick you acquired and then passed on does not, because your own is
        // still on the board.
        const tradedAway = dataset.pickTrades.some(
          (t) => t.round === round && t.from === owner && (t.originalOwner ?? t.from) === owner,
        );
        bumpReason = sameTier && !tradedAway ? 'duplicate' : 'traded';
        used.add(pick.overall);
      } else {
        used.add(pick.overall);
      }
    }

    resolvedByKey.set(sel, {
      selection: sel,
      player,
      effectiveAvg: player?.keeper.effectiveAvg ?? null,
      avgSource: player?.keeper.avgSource ?? 'none',
      round,
      pick,
      bumped,
      bumpReason,
      contract: player ? contractProjection(dataset, player, round) : null,
      errors: kErrors,
    });
  }

  // Return in the order the user selected them
  const keepers = selections.map((sel) => resolvedByKey.get(sel)!);

  const capUsed = round1(
    keepers.reduce((sum, k) => sum + (k.effectiveAvg ?? 0), 0),
  );
  const capOk = capUsed <= capLimit;
  const keeperErrors = keepers.flatMap((k) => k.errors);
  const valid = capOk && errors.length === 0 && keeperErrors.length === 0;

  let statusLine: string;
  if (keepers.length === 0) statusLine = STATUS.none;
  else if (!capOk) statusLine = STATUS.overCap;
  else statusLine = STATUS.good;

  let pickStatusLine: string;
  if (keepers.length === 0) pickStatusLine = STATUS.pickNone;
  else if (keepers.some((k) => k.bumped && k.bumpReason === 'traded'))
    pickStatusLine = STATUS.pickTraded;
  else if (keepers.some((k) => k.bumped && k.bumpReason === 'duplicate'))
    pickStatusLine = STATUS.pickDup;
  else pickStatusLine = STATUS.pickGood;

  return {
    owner,
    keepers,
    capUsed,
    capLimit,
    capOk,
    valid,
    statusLine,
    pickStatusLine,
    errors: [...errors, ...keeperErrors],
  };
}

/**
 * Explain why a player cannot join the current keeper set. This previews the
 * full rules engine so pick ownership, contracts, roster rights, and the cap
 * stay in sync with final validation.
 */
export function keeperCandidateError(
  dataset: LeagueDataset,
  owner: string,
  selections: KeeperSelection[],
  player: DatasetPlayer,
): string | null {
  if (selections.some((selection) => selection.playerKey === player.key)) {
    return 'Already selected';
  }
  if (selections.length >= dataset.maxKeepersPerTeam) {
    return `Max ${dataset.maxKeepersPerTeam} keepers`;
  }

  const preview = resolveTeamKeepers(dataset, owner, [
    ...selections,
    { playerKey: player.key, playerName: player.name },
  ]);
  if (!preview.capOk) {
    return `Over cap by ${(preview.capUsed - preview.capLimit).toFixed(1)} FPPG (${preview.capUsed.toFixed(1)}/${preview.capLimit.toFixed(1)})`;
  }
  return preview.errors[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Draft board assembly                                                */
/* ------------------------------------------------------------------ */

/**
 * Build the full draft board: every pick with ownership, keeper pre-fills
 * (from every team's current keeper selections) and live draft picks.
 * The first unfilled pick (by overall) is "on the clock".
 */
export function buildDraftBoard(
  dataset: LeagueDataset,
  dynamic: LeagueDynamicState,
): BoardCell[] {
  const picks = buildAllPicks(dataset);
  const keeperByOverall = new Map<number, ResolvedKeeper>();
  for (const team of dataset.teams) {
    const sels = dynamic.keepers[team.owner] ?? [];
    if (sels.length === 0) continue;
    const result = resolveTeamKeepers(dataset, team.owner, sels);
    if (!result.valid) continue;
    for (const k of result.keepers) {
      if (k.pick && k.errors.length === 0) keeperByOverall.set(k.pick.overall, k);
    }
  }

  let onClockAssigned = false;
  const cells: BoardCell[] = picks.map((pick) => {
    const selection = dynamic.draft.picks[String(pick.overall)] ?? null;
    const keeper = keeperByOverall.get(pick.overall) ?? null;
    return { pick, selection, keeper, onClock: false };
  });
  // Nobody is on the clock until the commissioner starts the draft
  if (dynamic.draft.startedAt !== null) {
    for (const cell of cells) {
      if (!cell.selection && !cell.keeper && !onClockAssigned) {
        cell.onClock = true;
        onClockAssigned = true;
      }
    }
  }
  return cells;
}

/** Players still available to draft (not kept, not picked). */
export function availablePlayers(
  dataset: LeagueDataset,
  dynamic: LeagueDynamicState,
): DatasetPlayer[] {
  const taken = new Set<string>();
  for (const team of dataset.teams) {
    const selections = dynamic.keepers[team.owner] ?? [];
    const result = resolveTeamKeepers(dataset, team.owner, selections);
    if (!result.valid) continue;
    for (const keeper of result.keepers) taken.add(keeper.selection.playerKey);
  }
  for (const p of Object.values(dynamic.draft.picks)) {
    if (p.playerKey) taken.add(p.playerKey);
  }
  return dataset.players.filter((p) => !taken.has(p.key));
}

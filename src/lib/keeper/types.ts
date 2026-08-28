/** Shared types for the Nerds League keeper/draft system (2027 season). */

export interface TeamInfo {
  owner: string;
  fullName: string;
  espnTeamId: number;
  espnTeamName: string;
  draftPosition: number; // 1-10
  isCommissioner?: boolean;
  inheritedFrom?: string;
}

export interface PickTrade {
  date: string;
  round: number;
  from: string; // owner giving up their own pick
  to: string; // owner receiving it
  tradeNote?: string;
}

/** Human-readable trade summary: what each side RECEIVED. */
export interface TradeDetail {
  date: string;
  teams: [string, string];
  received: Record<string, string[]>;
}

export interface ContractSeed {
  player: string;
  originalOwner: string;
  currentOwner: string | null; // owner holding keeper rights (roster at season end); null = player unrostered
  originalRound: number;
  round2026: number;
  firstKeptSeason: number;
  lastKeepableSeason: number;
  expired?: boolean;
  note?: string;
}

export interface SeasonStats {
  total: number;
  avg: number;
  gp: number;
}

export type AvgSource = '2026' | '2025-official' | '2025-api' | 'none';

export interface PlayerKeeperInfo {
  eligible: boolean; // on a final 2026 roster
  round: number | null; // 1-10 keeper pick tier for the 2027 draft
  rank: number | null; // rank among qualified players (>25 GP), null for substitutes
  effectiveAvg: number | null; // the FPPG that counts for tiers + salary cap
  avgSource: AvgSource;
  usesPriorYear: boolean; // <=25 GP in 2026 → prior season average
  zeroGp2026: boolean; // didn't play at all in 2026 → flat 3rd-round rule
  contract: ContractSeed | null;
  flags: string[];
}

export interface DatasetPlayer {
  key: string;
  espnId: number | null;
  name: string; // short display name, e.g. "N. Jokic"
  fullName: string | null;
  positions: string[];
  proTeam: string;
  injuryStatus?: string | null;
  fantasyTeam: string | null; // owner of the final 2026 roster the player is on
  stats2026: SeasonStats | null; // league-official (in-app) numbers
  api2026: SeasonStats | null; // ESPN API full-season numbers (reference)
  prior: { avg: number; source: '2025-official' | '2025-api' } | null;
  keeper: PlayerKeeperInfo;
}

export interface TierBand {
  round: number;
  max: number;
  min: number;
  maxYears: number;
}

export interface LeagueDataset {
  season: number;
  generatedAt: string;
  cap: number;
  capRule: { round3Max: number; round3Min: number };
  tiers: TierBand[];
  teams: TeamInfo[];
  players: DatasetPlayer[];
  pickTrades: PickTrade[];
  tradeDetails?: TradeDetail[];
  draftRounds: number;
  keeperRounds: number; // rounds that keeper tiers span (10)
  maxKeepersPerTeam: number;
  contractMaxYearsByRound: Record<string, number>;
}

/* ---------- dynamic state (server-persisted) ---------- */

export interface KeeperSelection {
  playerKey: string;
  playerName: string;
}

export interface DraftPickState {
  playerKey?: string;
  playerName?: string;
  proTeam?: string;
  positions?: string[];
  isKeeper?: boolean;
  enteredBy?: string;
  timestamp?: string;
}

export interface LeagueOverrides {
  cap?: number | null;
  playerRounds?: Record<string, number>;
}

export interface LeagueDynamicState {
  season: number;
  keepers: Record<string, KeeperSelection[]>;
  /** Commissioner-controlled public visibility. Missing in old state means hidden. */
  keepersRevealed?: boolean;
  draft: {
    picks: Record<string, DraftPickState>;
    startedAt: string | null;
    /** Pool frozen when the commissioner starts the draft. */
    playerPoolSnapshotId?: string | null;
  };
  /** Commissioner-accepted pool used before the draft is frozen. */
  playerPool?: {
    activeSnapshotId: string | null;
    acceptedAt?: string;
    acceptedBy?: string;
  };
  locks: { keepersLocked: boolean };
  overrides?: LeagueOverrides;
}

/* ---------- engine outputs ---------- */

export interface PickSlot {
  round: number;
  slot: number; // 1-10 position within the round (serpentine applied)
  overall: number;
  originalOwner: string;
  currentOwner: string;
  viaTradeFrom?: string; // set when currentOwner acquired this pick via trade
  tradeNote?: string; // the trade this pick moved in (for tap/hover provenance)
  tradeDate?: string;
}

export interface ResolvedKeeper {
  selection: KeeperSelection;
  player: DatasetPlayer | null;
  effectiveAvg: number | null;
  avgSource: AvgSource;
  round: number | null; // tier round
  pick: PickSlot | null; // the actual pick consumed
  bumped: boolean; // pick used is better than tier round (traded away / duplicate tier)
  bumpReason: 'traded' | 'duplicate' | null;
  contract: {
    isNew: boolean;
    originalRound: number;
    firstKeptSeason: number;
    lastKeepableSeason: number;
    yearsUsedThrough2027: number;
    yearsLeftAfter2027: number;
  } | null;
  errors: string[];
}

export interface TeamKeeperResult {
  owner: string;
  keepers: ResolvedKeeper[];
  capUsed: number;
  capLimit: number;
  capOk: boolean;
  valid: boolean;
  statusLine: string; // league-voice status (the Trump quotes from the old sheet)
  pickStatusLine: string;
  errors: string[];
}

export interface BoardCell {
  pick: PickSlot;
  selection: DraftPickState | null;
  keeper: ResolvedKeeper | null; // pre-filled keeper occupying this pick
  onClock: boolean;
}

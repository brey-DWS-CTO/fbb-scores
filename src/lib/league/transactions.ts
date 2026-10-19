/**
 * The moves people make in season: adds, drops, waiver claims and trades,
 * read out of ESPN's `mTransactions2` view.
 *
 * ESPN sends one transaction per move with an `items` list. A free-agent add
 * with a drop is one transaction with two items. A trade that went through is
 * a `TRADE_ACCEPT` with one item per player moved. Lineup changes are
 * `ROSTER` transactions with `LINEUP` items and are nobody's business.
 *
 * Nothing in here trusts a field to be there. A missing field reads as
 * nothing, never as a crash.
 *
 * Pure. No server, no browser.
 */
import type { TeamInfo } from '../keeper/types.js';

export type MoveKind = 'add' | 'drop' | 'waiver' | 'trade';

/** One player moving once. The unit the store keeps. */
export interface LeagueTransaction {
  /** ESPN's transaction id. Shared by every item of one move. */
  espnId: string;
  season: number;
  kind: MoveKind;
  /** The team that made the move. For a trade, the team the player left. */
  teamId: number;
  owner: string;
  playerId: number;
  playerName: string;
  proTeam: string;
  /** FAAB dollars on a waiver claim. Null otherwise. */
  bid: number | null;
  /** For a trade, where the player went. Null otherwise. */
  toTeamId: number | null;
  toOwner: string | null;
  /** When ESPN processed it, ISO. */
  at: string;
  scoringPeriodId: number | null;
  /** True when a commissioner made the move from LM Tools. */
  byLeagueManager: boolean;
}

/** What `mTransactions2` answers with. Only the fields read here. */
export interface EspnTransactionItem {
  playerId?: number;
  type?: string;
  fromTeamId?: number;
  toTeamId?: number;
}

export interface EspnTransaction {
  id?: string;
  type?: string;
  status?: string;
  teamId?: number;
  bidAmount?: number;
  isLeagueManager?: boolean;
  scoringPeriodId?: number;
  processDate?: number;
  proposedDate?: number;
  items?: EspnTransactionItem[];
}

export interface EspnTransactionsResponse {
  transactions?: EspnTransaction[];
}

export interface PlayerLookup {
  name: string;
  proTeam: string;
}

export interface NormalizeContext {
  season: number;
  teams: readonly Pick<TeamInfo, 'owner' | 'espnTeamId'>[];
  /** By ESPN player id. A player nobody knows reads as "Player 12345". */
  players: ReadonlyMap<number, PlayerLookup>;
}

const EXECUTED = new Set(['EXECUTED']);

function ownerOf(teams: NormalizeContext['teams'], teamId: number | undefined): string | null {
  if (!Number.isInteger(teamId)) return null;
  return teams.find((team) => team.espnTeamId === teamId)?.owner ?? null;
}

function whenOf(raw: EspnTransaction): string | null {
  const stamp = raw.processDate ?? raw.proposedDate;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp <= 0) return null;
  return new Date(stamp).toISOString();
}

/**
 * The moves worth showing, one row per player moved, in the order ESPN sent
 * them. Pending, cancelled and failed transactions stay out, as do lineup
 * changes and the draft itself.
 */
export function normalizeTransactions(raw: EspnTransactionsResponse, ctx: NormalizeContext): LeagueTransaction[] {
  const rows: LeagueTransaction[] = [];
  for (const tx of raw.transactions ?? []) {
    if (!tx.id || !EXECUTED.has(tx.status ?? '')) continue;
    const at = whenOf(tx);
    if (!at) continue;
    const type = tx.type ?? '';
    const isTrade = type === 'TRADE_ACCEPT';
    const isWaiver = type === 'WAIVER';
    const isFreeAgent = type === 'FREEAGENT';
    if (!isTrade && !isWaiver && !isFreeAgent) continue;

    for (const item of tx.items ?? []) {
      const playerId = item.playerId;
      if (!Number.isInteger(playerId) || (playerId ?? 0) <= 0) continue;
      const itemType = item.type ?? '';
      let kind: MoveKind;
      let teamId: number | undefined;
      let toTeamId: number | null = null;
      if (isTrade) {
        kind = 'trade';
        teamId = item.fromTeamId;
        toTeamId = Number.isInteger(item.toTeamId) ? (item.toTeamId as number) : null;
      } else if (itemType === 'ADD') {
        kind = isWaiver ? 'waiver' : 'add';
        teamId = item.toTeamId ?? tx.teamId;
      } else if (itemType === 'DROP') {
        kind = 'drop';
        teamId = item.fromTeamId ?? tx.teamId;
      } else {
        continue;
      }
      const owner = ownerOf(ctx.teams, teamId);
      if (owner === null || !Number.isInteger(teamId)) continue;
      const known = ctx.players.get(playerId as number);
      rows.push({
        espnId: tx.id,
        season: ctx.season,
        kind,
        teamId: teamId as number,
        owner,
        playerId: playerId as number,
        playerName: known?.name ?? `Player ${playerId}`,
        proTeam: known?.proTeam ?? '',
        bid: kind === 'waiver' && typeof tx.bidAmount === 'number' && tx.bidAmount >= 0 ? tx.bidAmount : null,
        toTeamId,
        toOwner: toTeamId === null ? null : ownerOf(ctx.teams, toTeamId),
        at,
        scoringPeriodId: Number.isInteger(tx.scoringPeriodId) ? (tx.scoringPeriodId as number) : null,
        byLeagueManager: tx.isLeagueManager === true,
      });
    }
  }
  return rows;
}

/** The key the store keeps one row under. */
export function transactionKey(row: Pick<LeagueTransaction, 'espnId' | 'playerId' | 'kind'>): string {
  return `${row.espnId}:${row.playerId}:${row.kind}`;
}

// ─── Words for the screen ───────────────────────────────────────────────────

/** One move as the feed shows it: a transaction's rows folded into one card. */
export interface Move {
  /** The ESPN transaction id. */
  id: string;
  at: string;
  kind: 'add' | 'waiver' | 'drop' | 'trade';
  /** The owners involved. One for a move, two for a trade. */
  owners: string[];
  title: string;
  lines: string[];
  byLeagueManager: boolean;
}

const withTeam = (row: Pick<LeagueTransaction, 'playerName' | 'proTeam'>) =>
  row.proTeam ? `${row.playerName} (${row.proTeam})` : row.playerName;

const list = (names: string[]) => (names.length === 0 ? 'nobody' : names.join(', '));

function moveOf(rows: LeagueTransaction[]): Move {
  const first = rows[0];
  const byLeagueManager = rows.some((row) => row.byLeagueManager);
  if (first.kind === 'trade') {
    const owners = [...new Set(rows.flatMap((row) => [row.owner, row.toOwner ?? '']).filter(Boolean))];
    const lines = owners.map((owner) => {
      const got = rows.filter((row) => row.toOwner === owner).map(withTeam);
      return `${owner} gets ${list(got)}.`;
    });
    return { id: first.espnId, at: first.at, kind: 'trade', owners, title: `${owners.join(' and ')} traded`, lines, byLeagueManager };
  }

  const added = rows.filter((row) => row.kind === 'add' || row.kind === 'waiver');
  const dropped = rows.filter((row) => row.kind === 'drop');
  const bid = added.find((row) => row.bid !== null)?.bid ?? null;
  const kind: Move['kind'] = added.some((row) => row.kind === 'waiver') ? 'waiver' : added.length > 0 ? 'add' : 'drop';
  const verb = kind === 'waiver' ? 'claimed' : kind === 'add' ? 'added' : 'dropped';
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`${verb} ${list(added.map(withTeam))}${bid !== null ? ` ($${bid})` : ''}`);
  }
  if (dropped.length > 0) parts.push(`${added.length > 0 ? 'dropped' : verb} ${list(dropped.map(withTeam))}`);
  const title = `${first.owner} ${parts.join(', ')}`;
  const lines: string[] = [];
  if (byLeagueManager) lines.push('LM add');
  return { id: first.espnId, at: first.at, kind, owners: [first.owner], title, lines, byLeagueManager };
}

/** Rows folded into moves, newest first. */
export function movesOf(rows: readonly LeagueTransaction[]): Move[] {
  const byId = new Map<string, LeagueTransaction[]>();
  for (const row of rows) {
    const group = byId.get(row.espnId);
    if (group) group.push(row);
    else byId.set(row.espnId, [row]);
  }
  return [...byId.values()]
    .map(moveOf)
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

/** The moves one owner was part of. */
export function movesFor(moves: readonly Move[], owner: string | null): Move[] {
  if (!owner) return [...moves];
  return moves.filter((move) => move.owners.includes(owner));
}

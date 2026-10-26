import type { LineupSnapshot, MoveRequest } from '../../../src/lib/league/lineup.js';

export interface TeamBinding { leagueId: string; teamId: number }
export interface LineupProvider {
  readonly executionEnabled: boolean;
  readonly reason: string;
  read(team: TeamBinding): Promise<LineupSnapshot>;
  /** Provider must prove the entire transaction is legal, including occupied slots. */
  canExecute(snapshot: LineupSnapshot, move: MoveRequest): Promise<boolean>;
  /** Must not retry; a timeout may mean the move was saved. */
  execute(snapshot: LineupSnapshot, move: MoveRequest): Promise<void>;
}

/** No guessed endpoints, request bodies, selectors, or inherited LM-write capability. */
export class DisabledEspnLineupProvider implements LineupProvider {
  readonly executionEnabled = false;
  readonly reason = 'ESPN lineup execution is not verified. Live moves are disabled.';
  async read(team: TeamBinding): Promise<LineupSnapshot> { void team; throw new Error(this.reason); }
  async canExecute(): Promise<boolean> { return false; }
  async execute(): Promise<void> { throw new Error(this.reason); }
}

/**
 * Boundary for a future authenticated browser worker. Implementations must use
 * a private server-side session, LM Tools → Edit Roster → Perform as Team
 * Manager (isActingAsTeamOwner=true), ordinary manager locks, and a fresh ESPN
 * reload for read(). A locally applied or cached roster is not read-back proof.
 * Login/MFA/CAPTCHA requires human interaction, never a bypass.
 */
export interface EspnBrowserSession extends LineupProvider {
  readonly mechanism: 'authenticated-browser';
}

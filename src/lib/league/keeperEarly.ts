/**
 * A keeper who sits on a better pick than his round: the team traded that
 * round's pick away, or two keepers share a round. The keeper engine decides
 * it (`bumped`); this only says it in words for the board.
 *
 * Pure. No server, no browser.
 */

export interface EarlyKeeperInput {
  bumped: boolean;
  bumpReason: 'traded' | 'duplicate' | null;
  /** The keeper's round, what he should cost. */
  round: number | null;
}

/** One line for a tooltip, or null when the keeper sits in his own round. */
export function earlyKeeperNote(keeper: EarlyKeeperInput, pickLabel: string): string | null {
  if (!keeper.bumped || keeper.round === null) return null;
  const why = keeper.bumpReason === 'duplicate'
    ? `another keeper already uses that round`
    : `the team has no round ${keeper.round} pick`;
  return `Kept early: his round is ${keeper.round}, but ${why}, so he uses ${pickLabel}.`;
}

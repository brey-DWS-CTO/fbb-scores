import { firstTip, lmAddWindow, pacific, type DayGame, type LmAddRequest } from './lmWeekend.js';

/** Only completed adds are public. Unfinished submissions belong to their owner and the commissioner. */
export function visibleLmRequests(requests: readonly LmAddRequest[], viewer: { owner: string | null; isCommissioner: boolean }): LmAddRequest[] {
  return requests.filter(request => viewer.isCommissioner || request.owner === viewer.owner || request.status === 'added');
}

export function claimPriority(a: LmAddRequest, b: LmAddRequest): number {
  return a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id);
}

export function claimReady(input: {
  request: LmAddRequest; now: Date; games: readonly DayGame[];
  onTeamId: number | null; proTeam: string; lastDroppedAt: string | null; lastWaiverAt: string;
}): { action: 'wait' | 'ready' | 'deny'; note: string } {
  const { request, now, games } = input;
  const today = pacific(now).date;
  if (request.forDate > today) return { action: 'wait', note: 'Queued for the selected LM Add day.' };
  if (request.forDate < today) return { action: 'deny', note: 'The selected LM Add day has passed.' };
  const weekday = pacific(now).weekday;
  if (weekday !== 0 && weekday !== 6) return { action: 'deny', note: 'This is not an eligible LM Add day.' };
  const tip = firstTip(games);
  if (!tip || now.toISOString() >= tip) return { action: 'deny', note: 'No eligible pre-tip LM Add window remains.' };
  const window = lmAddWindow(now, games);
  if (!window.closesAt || request.requestedAt >= window.closesAt) return { action: 'deny', note: 'Claim was submitted after the 10-minute cutoff.' };
  const closed = now.toISOString() >= window.closesAt;
  const notReady = (note: string) => ({ action: closed ? 'deny' as const : 'wait' as const, note });
  if (input.onTeamId === null) return { action: 'wait', note: 'ESPN ownership could not be verified. Nothing was added.' };
  if (input.onTeamId !== 0) return notReady('Player is currently rostered; waiting for availability.');
  if (!games.some(game => game.home === input.proTeam || game.away === input.proTeam)) return { action: 'deny', note: 'Player does not have a game on this LM Add day.' };
  if (input.lastDroppedAt !== null && input.lastDroppedAt >= input.lastWaiverAt) return notReady('Player was dropped after the last normal waiver run and must clear normal waivers first.');
  return { action: 'ready', note: 'Free agent, normal waivers cleared, and playing today.' };
}

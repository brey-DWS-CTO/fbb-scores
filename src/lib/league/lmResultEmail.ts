import type { LmAddRequest } from './lmWeekend.js';

export const LM_NO_ROSTER_SPOT = 'No open roster spot. Make room in ESPN before the LM Add window closes.';
export const LM_ROSTER_SPOT_EXPIRED = 'Your roster had no open spot before the LM Add window closed.';

/** Only explicit ESPN roster-capacity failures justify telling an owner their roster was full. */
export function isRosterCapacityError(body: string): boolean {
  return /roster (?:is |was )?full|no (?:open |available )?roster (?:spot|space)|max(?:imum)? roster (?:size|limit)|roster[_ ](?:size[_ ]limit|full|limit[_ ]exceeded)|team has too many players|exceed.{0,30}roster (?:size|limit)/i.test(body);
}

export function lmResultEmail(request: LmAddRequest, origin: string) {
  if (request.status !== 'added' && request.status !== 'denied') return null;
  const day = new Date(`${request.forDate}T12:00:00Z`).toLocaleDateString('en-US', {timeZone:'UTC', weekday:'long', month:'short', day:'numeric'});
  const success = request.status === 'added';
  const reason = request.note === 'This player was already awarded for this LM Add day.'
    ? 'Another team claimed this player first.'
    : request.note === LM_ROSTER_SPOT_EXPIRED ? 'You did not have an open roster spot before the LM Add window closed.'
    : request.note === 'Player is currently rostered; waiting for availability.' ? 'Another team had the player when your LM Add window closed.'
    : 'The add could not be completed before the LM Add window closed. Check the app or contact the commissioner for details.';
  return {
    subject: success ? `LM Add successful: ${request.playerName}` : `LM Add unsuccessful: ${request.playerName}`,
    preheader: success ? `${request.playerName} was added to your team for ${day}.` : reason,
    heading: success ? 'Your LM Add is complete!' : 'Your LM Add was not completed',
    lines: success ? [`${request.owner}, ${request.playerName} was added to your team for ${day}.`, 'You’re all set. Check your lineup in ESPN.']
      : [`${request.owner}, ${request.playerName} was not added to your team for ${day}.`, reason],
    action: {label:'VIEW LM ADDS', href:`${origin.replace(/\/+$/, '')}/lm-adds?date=${request.forDate}`},
    notes: success ? ['Please post your completed LM Add in the group chat too.'] : ['The app never drops players from your roster.'],
  };
}

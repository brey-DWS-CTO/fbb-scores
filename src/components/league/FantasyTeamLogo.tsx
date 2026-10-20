import type { ScoreSide } from '../../lib/league/scores.js';

export default function FantasyTeamLogo({ side, size = 28 }: { side: ScoreSide; size?: number }) {
  const initials = (side.abbrev || side.name.split(/\s+/).map((word) => word[0]).join('')).slice(0, 2).toUpperCase();
  return (
    <span className="fantasy-team-logo" style={{ width: size, height: size }} aria-hidden="true">
      <span>{initials}</span>
      {side.logoUrl && <img src={side.logoUrl} alt="" width={size} height={size} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
    </span>
  );
}

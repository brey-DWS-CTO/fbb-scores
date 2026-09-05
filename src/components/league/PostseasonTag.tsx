import type { PostseasonGames } from '../../hooks/usePostseasonGames.js';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Play-in and playoff games for a player's NBA team, for the commissioner.
 *
 * Draws nothing when there is no team or no schedule for it. A zero would read
 * as "this team plays no playoff games", which is a claim the app cannot make
 * about a player with no NBA team.
 */
export default function PostseasonTag({ games }: { games: PostseasonGames | null }) {
  if (!games) return null;
  return (
    <span
      className="postseason-tag"
      title={`${plural(games.playIn, 'play-in game')}, ${plural(games.playoffs, 'playoff game')}`}
    >
      PI {games.playIn} · PO {games.playoffs}
    </span>
  );
}

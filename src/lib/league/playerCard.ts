/**
 * What a matchup player card opens: his real NBA game, and his latest news.
 *
 * Pure. No server, no browser.
 */
import type { ScorePlayer, ScoresWeek } from './scores.js';

export interface CardGame {
  /** YYYY-MM-DD. */
  date: string;
  /** His NBA team code. */
  team: string;
}

/**
 * The game a card opens. On a day, that day's game. Over a week, the game
 * he is playing or last played, else his next one. Null when he has none.
 */
export function cardGame(player: ScorePlayer, week: ScoresWeek, scoringPeriodId?: number): CardGame | null {
  if (!player.proTeam) return null;
  const days = week.days
    .filter((day) => scoringPeriodId === undefined || day.scoringPeriodId === scoringPeriodId)
    .map((day) => ({ date: day.date, game: player.days[String(day.scoringPeriodId)]?.game ?? null }))
    .filter((day) => day.game !== null && day.game.status !== 'off');
  const started = days.filter((day) => day.game?.status === 'live' || day.game?.status === 'final');
  const pick = started.at(-1) ?? days[0];
  return pick ? { date: pick.date, team: player.proTeam } : null;
}

export interface NewsItem {
  id: number;
  /** The short note: what happened. */
  headline: string;
  /** The longer take, when there is one. */
  story: string | null;
  /** ISO. */
  published: string;
}

/** ESPN's fantasy news feed for one player. It allows calls from the browser. */
export function playerNewsUrl(playerId: number, limit = 25): string {
  return `https://site.api.espn.com/apis/fantasy/v2/games/fba/news/players?limit=${limit}&playerId=${playerId}`;
}

/**
 * The RotoWire notes from ESPN's feed, newest first. Video clips and
 * columns about many players are left out.
 */
export function readPlayerNews(body: unknown, count = 5): NewsItem[] {
  const feed = (body as { feed?: unknown } | null)?.feed;
  if (!Array.isArray(feed)) return [];
  const items: NewsItem[] = [];
  for (const raw of feed) {
    const entry = raw as Record<string, unknown>;
    if (entry.type !== 'Rotowire') continue;
    const headline = typeof entry.headline === 'string' ? entry.headline.trim() : '';
    const published = typeof entry.published === 'string' ? entry.published : '';
    if (!headline || !published) continue;
    const story = typeof entry.story === 'string' && entry.story.trim() ? entry.story.trim() : null;
    items.push({ id: Number(entry.id), headline, story, published });
  }
  return items.sort((a, b) => b.published.localeCompare(a.published)).slice(0, count);
}

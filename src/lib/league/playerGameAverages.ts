import { gameFantasyPoints, type GameLog } from './gameLog.js';
import type { ScoringItem } from './partyScore.js';
export interface AverageWindow { average: number; count: number; target: number | null }
export interface PlayerGameAverages { season: AverageWindow | null; last3: AverageWindow | null; last7: AverageWindow | null; last15: AverageWindow | null }
export function playerGameAverages(log: GameLog, season: number, scoring: readonly ScoringItem[], now = Date.now()): PlayerGameAverages {
  const empty: PlayerGameAverages = { season: null, last3: null, last7: null, last15: null };
  if (log.seasonId !== season) return empty;
  const label = `${season - 1}-${String(season).slice(-2)}`;
  const seen = new Set<string>();
  const games = [...log.games].sort((a, b) => b.date.localeCompare(a.date)).filter(game => {
    if (game.season !== label || !game.result || !Number.isFinite(Date.parse(game.date)) || Date.parse(game.date) >= now
      || !Number.isFinite(game.stats['40']) || game.stats['40'] < 0 || scoring.some(item => !Number.isFinite(game.stats[String(item.statId)])) || seen.has(game.eventId)) return false;
    seen.add(game.eventId); return true;
  });
  const window = (target: number | null): AverageWindow | null => {
    const rows = target === null ? games : games.slice(0, target);
    return rows.length ? { average: rows.reduce((sum, game) => sum + gameFantasyPoints(game, scoring), 0) / rows.length, count: rows.length, target } : null;
  };
  return { season: window(null), last3: window(3), last7: window(7), last15: window(15) };
}

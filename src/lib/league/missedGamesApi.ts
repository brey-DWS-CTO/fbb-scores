import axios from 'axios';
import { sandboxActive, type Credentials } from './api.js';
import type { MissedGamesReport } from './missedGames.js';
function options(c: Credentials) {
  if (sandboxActive()) throw new Error('Missed-games tracking is unavailable in test mode.');
  return { headers: c.session ? { 'x-session': c.session } : { 'x-owner': c.owner, 'x-pin': c.pin ?? '' } };
}
export async function fetchMissedGames(c: Credentials) { return (await axios.get<MissedGamesReport>('/api/league/missed-games', options(c))).data; }
export async function refreshMissedGames(c: Credentials, week: number | null) { return (await axios.post<MissedGamesReport>('/api/league/missed-games/refresh', { week }, options(c))).data; }
export async function approveMissedExemption(c: Credentials, week: number, teamId: number, reason: string) {
  return (await axios.post<MissedGamesReport>('/api/league/missed-games/exemption', { week, teamId, reason }, options(c))).data;
}

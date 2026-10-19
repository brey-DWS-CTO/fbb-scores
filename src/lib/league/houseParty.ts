/**
 * House parties: who is watching which NBA game, and where.
 *
 * Three things live here. Favorite teams, one or two an owner. The WATCH
 * list, which ranks the next two weeks of NBA games for one viewer: his
 * favorites first, then the games with the most league players in them. And
 * the parties themselves: a host (or nobody yet), up to three games with the
 * first as the main one, a note, and who is in.
 *
 * Games come from ESPN's public scoreboard; `parseScoreboard` turns that JSON
 * into plain rows. Rosters come from the draft (keepers and picks) and are
 * passed in, so this file never knows where they came from.
 *
 * Pure. No server, no browser.
 */
import { NBA_TEAMS, normalizeNbaTeamCode } from './schedule.js';

// ─── Teams ──────────────────────────────────────────────────────────────────

export interface NbaTeamInfo {
  code: string;
  city: string;
  name: string;
}

/** The 30 NBA teams in ESPN's codes, with the names people say. */
export const NBA_TEAM_INFO: readonly NbaTeamInfo[] = [
  { code: 'ATL', city: 'Atlanta', name: 'Hawks' },
  { code: 'BOS', city: 'Boston', name: 'Celtics' },
  { code: 'BKN', city: 'Brooklyn', name: 'Nets' },
  { code: 'CHA', city: 'Charlotte', name: 'Hornets' },
  { code: 'CHI', city: 'Chicago', name: 'Bulls' },
  { code: 'CLE', city: 'Cleveland', name: 'Cavaliers' },
  { code: 'DAL', city: 'Dallas', name: 'Mavericks' },
  { code: 'DEN', city: 'Denver', name: 'Nuggets' },
  { code: 'DET', city: 'Detroit', name: 'Pistons' },
  { code: 'GSW', city: 'Golden State', name: 'Warriors' },
  { code: 'HOU', city: 'Houston', name: 'Rockets' },
  { code: 'IND', city: 'Indiana', name: 'Pacers' },
  { code: 'LAC', city: 'LA', name: 'Clippers' },
  { code: 'LAL', city: 'Los Angeles', name: 'Lakers' },
  { code: 'MEM', city: 'Memphis', name: 'Grizzlies' },
  { code: 'MIA', city: 'Miami', name: 'Heat' },
  { code: 'MIL', city: 'Milwaukee', name: 'Bucks' },
  { code: 'MIN', city: 'Minnesota', name: 'Timberwolves' },
  { code: 'NOP', city: 'New Orleans', name: 'Pelicans' },
  { code: 'NYK', city: 'New York', name: 'Knicks' },
  { code: 'OKC', city: 'Oklahoma City', name: 'Thunder' },
  { code: 'ORL', city: 'Orlando', name: 'Magic' },
  { code: 'PHI', city: 'Philadelphia', name: '76ers' },
  { code: 'PHX', city: 'Phoenix', name: 'Suns' },
  { code: 'POR', city: 'Portland', name: 'Trail Blazers' },
  { code: 'SAC', city: 'Sacramento', name: 'Kings' },
  { code: 'SAS', city: 'San Antonio', name: 'Spurs' },
  { code: 'TOR', city: 'Toronto', name: 'Raptors' },
  { code: 'UTA', city: 'Utah', name: 'Jazz' },
  { code: 'WAS', city: 'Washington', name: 'Wizards' },
];

const TEAM_BY_CODE = new Map(NBA_TEAM_INFO.map((team) => [team.code, team]));

/** A team's nickname: "Warriors". Unknown codes come back as given. */
export function teamNickname(code: string): string {
  return TEAM_BY_CODE.get(code)?.name ?? code;
}

/** "Golden State Warriors". */
export function teamFullName(code: string): string {
  const team = TEAM_BY_CODE.get(code);
  return team ? `${team.city} ${team.name}` : code;
}

/** ESPN's logo for a team, from its public CDN. */
export function teamLogoUrl(code: string): string {
  return `https://a.espncdn.com/i/teamlogos/nba/500/${code.toLowerCase()}.png`;
}

/**
 * A team code in ESPN's spelling, or null when it is not one of the 30.
 * "GS", "Lakers" and "lal" all land: people type what they know.
 */
export function normalizeTeam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const code = normalizeNbaTeamCode(trimmed);
  if (NBA_TEAMS.some((team) => team.code === code)) return code;
  const lower = trimmed.toLowerCase();
  const byName = NBA_TEAM_INFO.find((team) =>
    team.name.toLowerCase() === lower
    || `${team.city} ${team.name}`.toLowerCase() === lower
    || team.city.toLowerCase() === lower);
  return byName?.code ?? null;
}

// ─── Favorites ──────────────────────────────────────────────────────────────

export interface FavoriteTeams {
  first: string;
  second: string | null;
}

/** Everyone's favorites, by owner. An owner with none is simply absent. */
export type FavoritesByOwner = Record<string, FavoriteTeams>;

export type FavoritesProblem = 'no-first' | 'bad-team' | 'same-team';

/**
 * Clean a favorites choice. The first team is required; a second may not
 * repeat it. Returns the problem instead of throwing, so a screen can say it.
 */
export function cleanFavorites(input: { first?: unknown; second?: unknown }):
  | { ok: true; favorites: FavoriteTeams }
  | { ok: false; problem: FavoritesProblem } {
  const firstRaw = typeof input.first === 'string' ? input.first.trim() : '';
  if (!firstRaw) return { ok: false, problem: 'no-first' };
  const first = normalizeTeam(firstRaw);
  if (!first) return { ok: false, problem: 'bad-team' };
  const secondRaw = typeof input.second === 'string' ? input.second.trim() : '';
  let second: string | null = null;
  if (secondRaw) {
    second = normalizeTeam(secondRaw);
    if (!second) return { ok: false, problem: 'bad-team' };
    if (second === first) return { ok: false, problem: 'same-team' };
  }
  return { ok: true, favorites: { first, second } };
}

export const FAVORITES_PROBLEM_WORDS: Record<FavoritesProblem, string> = {
  'no-first': 'Pick a first team.',
  'bad-team': 'That is not an NBA team.',
  'same-team': 'Your second team has to be a different team.',
};

/** True when `owner` calls `team` a favorite, first or second. */
export function isFavorite(favorites: FavoritesByOwner, owner: string, team: string): boolean {
  const mine = favorites[owner];
  return mine !== undefined && (mine.first === team || mine.second === team);
}

/** The owners who call `team` a favorite, first-team fans first. */
export function fansOf(favorites: FavoritesByOwner, team: string): string[] {
  const first = Object.entries(favorites).filter(([, teams]) => teams.first === team).map(([owner]) => owner);
  const second = Object.entries(favorites).filter(([, teams]) => teams.second === team).map(([owner]) => owner);
  return [...first.sort(), ...second.sort()];
}

// ─── Games ──────────────────────────────────────────────────────────────────

export type GameState = 'pre' | 'in' | 'post';

/** One NBA game as the scoreboard lists it. */
export interface NbaGame {
  /** ESPN's event id. */
  id: string;
  /** Tip-off, ISO. */
  tipoff: string;
  /** Home and away in ESPN's codes. */
  home: string;
  away: string;
  /** National TV, as ESPN names it: "ESPN", "TNT", "NBA TV". Null for local only. */
  tv: string | null;
  state: GameState;
  /** "7:30 PM EDT", "3rd 5:12", "Final". */
  detail: string;
  homeScore: number | null;
  awayScore: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function scoreOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * National broadcasts only. ESPN lists regional networks too, and nobody
 * drives across town for Bally Sports.
 */
const NATIONAL_TV = ['ESPN', 'ESPN2', 'ABC', 'TNT', 'NBA TV', 'NBC', 'PEACOCK', 'PRIME VIDEO', 'AMAZON PRIME VIDEO', 'TRUTV'];

function nationalTv(names: readonly string[]): string | null {
  for (const name of names) {
    const upper = name.toUpperCase();
    if (NATIONAL_TV.includes(upper)) return upper === 'AMAZON PRIME VIDEO' ? 'PRIME VIDEO' : upper;
  }
  return null;
}

/**
 * ESPN's scoreboard JSON into plain games. Rows missing a team or a date are
 * dropped, never thrown on: the list is read on a phone.
 */
export function parseScoreboard(raw: unknown): NbaGame[] {
  const root = record(raw);
  const events = Array.isArray(root?.events) ? root.events : [];
  const games: NbaGame[] = [];
  for (const entry of events) {
    const event = record(entry);
    if (!event) continue;
    const competition = record(Array.isArray(event.competitions) ? event.competitions[0] : null);
    if (!competition) continue;
    const id = text(event.id) || text(competition.id);
    const tipoff = text(competition.date) || text(event.date);
    if (!id || !tipoff || Number.isNaN(Date.parse(tipoff))) continue;
    let home: string | null = null;
    let away: string | null = null;
    let homeScore: number | null = null;
    let awayScore: number | null = null;
    for (const side of Array.isArray(competition.competitors) ? competition.competitors : []) {
      const competitor = record(side);
      const team = record(competitor?.team);
      const code = normalizeTeam(text(team?.abbreviation));
      if (!competitor || !code) continue;
      if (competitor.homeAway === 'home') {
        home = code;
        homeScore = scoreOf(competitor.score);
      } else if (competitor.homeAway === 'away') {
        away = code;
        awayScore = scoreOf(competitor.score);
      }
    }
    if (!home || !away) continue;
    const names: string[] = [];
    for (const broadcast of Array.isArray(competition.broadcasts) ? competition.broadcasts : []) {
      const row = record(broadcast);
      for (const name of Array.isArray(row?.names) ? row.names : []) {
        if (typeof name === 'string') names.push(name);
      }
    }
    const status = record(competition.status) ?? record(event.status);
    const type = record(status?.type);
    const stateText = text(type?.state);
    const state: GameState = stateText === 'in' ? 'in' : stateText === 'post' ? 'post' : 'pre';
    games.push({
      id,
      tipoff: new Date(tipoff).toISOString(),
      home,
      away,
      tv: nationalTv(names),
      state,
      detail: text(type?.shortDetail) || text(type?.detail),
      homeScore,
      awayScore,
    });
  }
  return games.sort((a, b) => a.tipoff.localeCompare(b.tipoff) || a.id.localeCompare(b.id));
}

/** The calendar day a game is played, in Pacific time, as YYYY-MM-DD. */
export function gameDay(tipoff: string): string {
  const at = new Date(tipoff);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Tue Oct 20". */
export function dayLabel(tipoff: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).formatToParts(new Date(tipoff));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')}`;
}

/** "7:30 PM" in Pacific time. */
export function tipLabel(tipoff: string): string {
  return new Date(tipoff).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Lakers at Warriors". */
export function matchupLabel(game: Pick<NbaGame, 'home' | 'away'>): string {
  return `${teamNickname(game.away)} at ${teamNickname(game.home)}`;
}

// ─── Rosters ────────────────────────────────────────────────────────────────

export interface RosterPlayer {
  key: string;
  name: string;
  /** ESPN's team code. */
  proTeam: string;
}

/** Every owner's players, by owner. */
export type RostersByOwner = Record<string, RosterPlayer[]>;

/** One owner's players in one game. */
export interface OwnerStake {
  owner: string;
  players: RosterPlayer[];
}

/** Who has players in a game, most players first, then by name. */
export function stakesIn(game: Pick<NbaGame, 'home' | 'away'>, rosters: RostersByOwner): OwnerStake[] {
  const stakes: OwnerStake[] = [];
  for (const [owner, players] of Object.entries(rosters)) {
    const inGame = players.filter((player) => {
      const code = normalizeTeam(player.proTeam);
      return code === game.home || code === game.away;
    });
    if (inGame.length > 0) stakes.push({ owner, players: inGame });
  }
  return stakes.sort((a, b) => b.players.length - a.players.length || a.owner.localeCompare(b.owner));
}

/** Last name only, for a tight line: "LeBron James" is "James". */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.trim();
  // "N. Jokic" is already short.
  if (/^[A-Z]\.$/.test(parts[0])) return parts.slice(1).join(' ');
  const suffixes = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv']);
  const last = parts[parts.length - 1].toLowerCase();
  return suffixes.has(last) && parts.length > 2 ? parts[parts.length - 2] : parts[parts.length - 1];
}

// ─── The WATCH list ─────────────────────────────────────────────────────────

/** A game with the reasons one viewer should care. */
export interface WatchGame extends NbaGame {
  score: number;
  /** Which of the viewer's favorites play, if any. */
  favorites: string[];
  /** The viewer's own players in it. */
  mine: RosterPlayer[];
  /** Everyone with players in it, the viewer included. */
  stakes: OwnerStake[];
  /** Two owners hold players on opposite sides. */
  rivalry: RivalryLine | null;
  /** One short line: "Your Warriors. You have Curry, Kyle has LeBron." */
  why: string;
}

export interface RivalryLine {
  /** Each side: the owner and his best-known player on that team. */
  a: { owner: string; player: string; team: string };
  b: { owner: string; player: string; team: string };
}

export const POINTS = {
  firstFavorite: 100,
  secondFavorite: 60,
  /** Each of the viewer's own players. */
  mine: 16,
  /** Each other league player. */
  theirs: 6,
  nationalTv: 20,
  rivalry: 10,
} as const;

/**
 * The first rivalry in a game: two owners with players on opposite sides.
 * Owners with the most at stake are looked at first, so the headline pair is
 * the one with the most players in it.
 */
export function rivalryIn(game: Pick<NbaGame, 'home' | 'away'>, stakes: readonly OwnerStake[]): RivalryLine | null {
  const side = (player: RosterPlayer) => normalizeTeam(player.proTeam);
  for (const first of stakes) {
    const onHome = first.players.find((player) => side(player) === game.home);
    const onAway = first.players.find((player) => side(player) === game.away);
    for (const other of stakes) {
      if (other.owner === first.owner) continue;
      const otherAway = other.players.find((player) => side(player) === game.away);
      const otherHome = other.players.find((player) => side(player) === game.home);
      if (onHome && otherAway) {
        return {
          a: { owner: first.owner, player: lastName(onHome.name), team: game.home },
          b: { owner: other.owner, player: lastName(otherAway.name), team: game.away },
        };
      }
      if (onAway && otherHome) {
        return {
          a: { owner: first.owner, player: lastName(onAway.name), team: game.away },
          b: { owner: other.owner, player: lastName(otherHome.name), team: game.home },
        };
      }
    }
  }
  return null;
}

function listNames(names: readonly string[], limit = 2): string {
  if (names.length <= limit) return names.join(' and ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/** The WHY line for one game, for one viewer. */
export function whyLine(viewer: string, game: Pick<WatchGame, 'favorites' | 'mine' | 'stakes' | 'tv' | 'rivalry'>): string {
  const parts: string[] = [];
  if (game.favorites.length > 0) parts.push(`Your ${game.favorites.map(teamNickname).join(' and ')}.`);
  const others = game.stakes.filter((stake) => stake.owner !== viewer);
  const bits: string[] = [];
  if (game.mine.length > 0) bits.push(`You have ${listNames(game.mine.map((player) => lastName(player.name)))}`);
  for (const stake of others.slice(0, 2)) {
    bits.push(`${stake.owner} has ${listNames(stake.players.map((player) => lastName(player.name)))}`);
  }
  if (others.length > 2) bits.push(`${others.length - 2} more ${others.length - 2 === 1 ? 'team has' : 'teams have'} players in it`);
  if (bits.length > 0) parts.push(`${bits.join(', ')}.`);
  if (game.rivalry) parts.push(`${game.rivalry.a.owner}'s ${game.rivalry.a.player} vs ${game.rivalry.b.owner}'s ${game.rivalry.b.player}.`);
  if (game.tv) parts.push(`On ${game.tv}.`);
  return parts.join(' ');
}

export interface WatchInput {
  viewer: string;
  games: readonly NbaGame[];
  favorites: FavoritesByOwner;
  rosters: RostersByOwner;
}

/**
 * The games ranked for one viewer. Favorites outrank everything, then the
 * games with the most of his own players, then everyone else's, then TV. A
 * game already over drops to the bottom, in order, so the list is still a
 * record of the night.
 */
export function rankGames(input: WatchInput): WatchGame[] {
  const mine = input.favorites[input.viewer];
  const rows = input.games.map((game): WatchGame => {
    const favorites: string[] = [];
    if (mine) {
      for (const team of [game.home, game.away]) {
        if (mine.first === team || mine.second === team) favorites.push(team);
      }
    }
    const stakes = stakesIn(game, input.rosters);
    const own = stakes.find((stake) => stake.owner === input.viewer)?.players ?? [];
    const rivalry = rivalryIn(game, stakes);
    let score = 0;
    for (const team of favorites) score += mine?.first === team ? POINTS.firstFavorite : POINTS.secondFavorite;
    score += own.length * POINTS.mine;
    for (const stake of stakes) if (stake.owner !== input.viewer) score += stake.players.length * POINTS.theirs;
    if (game.tv) score += POINTS.nationalTv;
    if (rivalry) score += POINTS.rivalry;
    const partial = { favorites, mine: own, stakes, tv: game.tv, rivalry };
    return { ...game, score, favorites, mine: own, stakes, rivalry, why: whyLine(input.viewer, partial) };
  });
  const rank = (game: WatchGame) => (game.state === 'post' ? 1 : 0);
  return rows.sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.tipoff.localeCompare(b.tipoff) || a.id.localeCompare(b.id));
}

/** The same games in time order, for a night-by-night read. */
export function byNight(games: readonly WatchGame[]): Array<{ day: string; label: string; games: WatchGame[] }> {
  const nights = new Map<string, WatchGame[]>();
  for (const game of [...games].sort((a, b) => a.tipoff.localeCompare(b.tipoff))) {
    const day = gameDay(game.tipoff);
    const list = nights.get(day);
    if (list) list.push(game);
    else nights.set(day, [game]);
  }
  return [...nights.entries()].map(([day, list]) => ({ day, label: dayLabel(list[0].tipoff), games: list }));
}

// ─── Parties ────────────────────────────────────────────────────────────────

export const MAX_PARTY_GAMES = 3;
export const MAX_PARTY_NOTE = 280;

export type RsvpAnswer = 'in' | 'out';

export interface Rsvp {
  owner: string;
  answer: RsvpAnswer;
  at: string;
}

/** A game as a party keeps it: enough to show without the scoreboard. */
export type PartyGame = Pick<NbaGame, 'id' | 'tipoff' | 'home' | 'away' | 'tv'>;

export interface HouseParty {
  id: string;
  season: number;
  /** Who has the house. Null while people are only "up for it". */
  host: string | null;
  /** One to three. The first is the main game; the night is its night. */
  games: PartyGame[];
  /** Address, what to bring. Shown to the league, and on the share link. */
  note: string;
  createdBy: string;
  createdAt: string;
  rsvps: Rsvp[];
  cancelledAt: string | null;
}

export type PartyProblem =
  | 'no-games'
  | 'too-many-games'
  | 'unknown-game'
  | 'same-game-twice'
  | 'different-nights'
  | 'note-too-long'
  | 'not-host'
  | 'cancelled'
  | 'already-hosted'
  | 'bad-answer'
  | 'over';

export const PARTY_PROBLEM_WORDS: Record<PartyProblem, string> = {
  'no-games': 'Pick at least one game.',
  'too-many-games': `Pick at most ${MAX_PARTY_GAMES} games.`,
  'unknown-game': 'That game is not on the schedule.',
  'same-game-twice': 'That game is in the list twice.',
  'different-nights': 'All the games have to be on the same night.',
  'note-too-long': `Keep the note under ${MAX_PARTY_NOTE} characters.`,
  'not-host': 'Only the host can change that.',
  cancelled: 'That party was called off.',
  'already-hosted': 'Somebody already has that one.',
  'bad-answer': 'Say in or out.',
  over: 'That game is over.',
};

export type PartyCheck<T> = { ok: true; value: T } | { ok: false; problem: PartyProblem };

/** Strip a game to what a party stores. */
export function partyGameOf(game: NbaGame): PartyGame {
  return { id: game.id, tipoff: game.tipoff, home: game.home, away: game.away, tv: game.tv };
}

/**
 * The games for a new party, from the ids a screen sent. They must be on the
 * schedule, on one night, one to three, no repeats. The order sent is kept:
 * the first is the main game.
 */
export function cleanPartyGames(ids: unknown, schedule: readonly NbaGame[]): PartyCheck<PartyGame[]> {
  const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '') : [];
  if (list.length === 0) return { ok: false, problem: 'no-games' };
  if (list.length > MAX_PARTY_GAMES) return { ok: false, problem: 'too-many-games' };
  if (new Set(list).size !== list.length) return { ok: false, problem: 'same-game-twice' };
  const games: PartyGame[] = [];
  for (const id of list) {
    const game = schedule.find((candidate) => candidate.id === id);
    if (!game) return { ok: false, problem: 'unknown-game' };
    games.push(partyGameOf(game));
  }
  const nights = new Set(games.map((game) => gameDay(game.tipoff)));
  if (nights.size > 1) return { ok: false, problem: 'different-nights' };
  return { ok: true, value: games };
}

export function cleanPartyNote(value: unknown): PartyCheck<string> {
  const note = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (note.length > MAX_PARTY_NOTE) return { ok: false, problem: 'note-too-long' };
  return { ok: true, value: note };
}

/** A new party or an "up for it" from one person. */
export function openParty(input: {
  id: string;
  season: number;
  by: string;
  hosting: boolean;
  games: PartyGame[];
  note: string;
  at: string;
}): HouseParty {
  return {
    id: input.id,
    season: input.season,
    host: input.hosting ? input.by : null,
    games: input.games,
    note: input.note,
    createdBy: input.by,
    createdAt: input.at,
    rsvps: [{ owner: input.by, answer: 'in', at: input.at }],
    cancelledAt: null,
  };
}

/** A short id for a share link: eight letters and digits. */
export function partyId(at: string, random: number): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let seed = Math.abs(Math.floor(Date.parse(at) / 1000) ^ Math.floor(random * 2 ** 31)) || 1;
  let id = '';
  for (let index = 0; index < 8; index += 1) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    id += alphabet[seed % alphabet.length];
  }
  return id;
}

/** The night of a party: its main game's tip-off. */
export function partyTipoff(party: Pick<HouseParty, 'games'>): string {
  return party.games[0]?.tipoff ?? '';
}

/** The party is done: its last game tipped off more than four hours ago. */
export function partyOver(party: Pick<HouseParty, 'games'>, now: Date): boolean {
  const last = party.games.reduce((latest, game) => (game.tipoff > latest ? game.tipoff : latest), '');
  return last !== '' && now.getTime() > Date.parse(last) + 4 * 60 * 60 * 1000;
}

export function whoIsIn(party: Pick<HouseParty, 'rsvps'>): string[] {
  return party.rsvps.filter((rsvp) => rsvp.answer === 'in').map((rsvp) => rsvp.owner);
}

export function answerOf(party: Pick<HouseParty, 'rsvps'>, owner: string): RsvpAnswer | null {
  return party.rsvps.find((rsvp) => rsvp.owner === owner)?.answer ?? null;
}

/** In or out. The host stays in: a host who is out should call it off. */
export function rsvp(party: HouseParty, owner: string, answer: unknown, at: string): PartyCheck<HouseParty> {
  if (party.cancelledAt) return { ok: false, problem: 'cancelled' };
  if (answer !== 'in' && answer !== 'out') return { ok: false, problem: 'bad-answer' };
  if (party.host === owner && answer === 'out') return { ok: false, problem: 'not-host' };
  const rsvps = party.rsvps.filter((row) => row.owner !== owner);
  rsvps.push({ owner, answer, at });
  return { ok: true, value: { ...party, rsvps } };
}

/** Take the house. Only an "up for it" with no host yet can be claimed. */
export function takeHosting(party: HouseParty, owner: string, note: string, at: string): PartyCheck<HouseParty> {
  if (party.cancelledAt) return { ok: false, problem: 'cancelled' };
  if (party.host && party.host !== owner) return { ok: false, problem: 'already-hosted' };
  const rsvps = party.rsvps.filter((row) => row.owner !== owner);
  rsvps.push({ owner, answer: 'in', at });
  return { ok: true, value: { ...party, host: owner, note: note || party.note, rsvps } };
}

/** The host changes the games or the note. */
export function editParty(party: HouseParty, owner: string, changes: { games?: PartyGame[]; note?: string }): PartyCheck<HouseParty> {
  if (party.cancelledAt) return { ok: false, problem: 'cancelled' };
  if (!canManage(party, owner, false)) return { ok: false, problem: 'not-host' };
  return { ok: true, value: { ...party, games: changes.games ?? party.games, note: changes.note ?? party.note } };
}

/** The host, the person who opened it, or the commish may call it off. */
export function canManage(party: Pick<HouseParty, 'host' | 'createdBy'>, owner: string, isCommissioner: boolean): boolean {
  if (isCommissioner) return true;
  if (party.host) return party.host === owner;
  return party.createdBy === owner;
}

export function cancelParty(party: HouseParty, owner: string, isCommissioner: boolean, at: string): PartyCheck<HouseParty> {
  if (party.cancelledAt) return { ok: false, problem: 'cancelled' };
  if (!canManage(party, owner, isCommissioner)) return { ok: false, problem: 'not-host' };
  return { ok: true, value: { ...party, cancelledAt: at } };
}

/** Parties still worth showing: not called off, not over. Soonest first. */
export function liveParties(parties: readonly HouseParty[], now: Date): HouseParty[] {
  return parties
    .filter((party) => !party.cancelledAt && !partyOver(party, now))
    .sort((a, b) => partyTipoff(a).localeCompare(partyTipoff(b)) || a.createdAt.localeCompare(b.createdAt));
}

/** Parties that already happened, latest first. Called-off ones are left out. */
export function pastParties(parties: readonly HouseParty[], now: Date): HouseParty[] {
  return parties
    .filter((party) => !party.cancelledAt && partyOver(party, now))
    .sort((a, b) => partyTipoff(b).localeCompare(partyTipoff(a)));
}

/** The parties that include a game, live ones only. */
export function partiesForGame(parties: readonly HouseParty[], gameId: string, now: Date): HouseParty[] {
  return liveParties(parties, now).filter((party) => party.games.some((game) => game.id === gameId));
}

/** What a guest brings: his players in each of the party's games. */
export interface GuestStake {
  owner: string;
  /** Per game, in the party's order. Empty lists stay, so the strip lines up. */
  byGame: RosterPlayer[][];
  total: number;
}

export function guestStakes(party: Pick<HouseParty, 'games' | 'rsvps'>, rosters: RostersByOwner): GuestStake[] {
  return whoIsIn(party)
    .map((owner): GuestStake => {
      const byGame = party.games.map((game) => stakesIn(game, rosters).find((stake) => stake.owner === owner)?.players ?? []);
      return { owner, byGame, total: byGame.reduce((sum, list) => sum + list.length, 0) };
    })
    .sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));
}

/** "Lakers at Warriors, Tue Oct 20, 7:30 PM. Hosted by Kyle." for a text. */
export function partyHeadline(party: Pick<HouseParty, 'games' | 'host'>): string {
  const main = party.games[0];
  if (!main) return 'House party';
  const where = party.host ? `${party.host} is hosting.` : 'Nobody has the house yet.';
  const undercard = party.games.length > 1 ? ` Plus ${party.games.length - 1} more game${party.games.length > 2 ? 's' : ''}.` : '';
  return `${matchupLabel(main)}, ${dayLabel(main.tipoff)}, ${tipLabel(main.tipoff)}. ${where}${undercard}`;
}

// ─── The tally ──────────────────────────────────────────────────────────────

export interface PartyTally {
  owner: string;
  hosted: number;
  attended: number;
}

/** Hosted and attended, by owner, over parties that happened. Most first. */
export function partyTally(owners: readonly string[], parties: readonly HouseParty[], now: Date): PartyTally[] {
  const done = pastParties(parties, now);
  return owners
    .map((owner): PartyTally => ({
      owner,
      hosted: done.filter((party) => party.host === owner).length,
      attended: done.filter((party) => whoIsIn(party).includes(owner)).length,
    }))
    .sort((a, b) => b.attended - a.attended || b.hosted - a.hosted || a.owner.localeCompare(b.owner));
}

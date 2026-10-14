/**
 * NBA award odds and team depth charts, for the commish's AWARDS & DEPTH page.
 *
 * Depth charts come from ESPN's public site API, one call a team. Award odds
 * come from Kalshi's public market API, one call an award. Both are read on
 * the server; this file only turns their JSON into plain rows.
 *
 * Pure. No server, no browser.
 */

export const DEPTH_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type DepthPosition = (typeof DEPTH_POSITIONS)[number];

/** ESPN's NBA team ids run 1 to 30. */
export const ESPN_TEAM_IDS: readonly number[] = Array.from({ length: 30 }, (_, index) => index + 1);

export interface DepthInjury {
  /** ESPN's word for it: Out, Day-To-Day, Questionable. */
  status: string;
  note: string;
}

export interface DepthPlayer {
  /** ESPN athlete id, the same id our player pool uses. */
  id: string;
  name: string;
  injury: DepthInjury | null;
}

export interface TeamDepth {
  teamId: string;
  abbrev: string;
  name: string;
  /** Each position's players in order: the first one starts. */
  slots: Record<DepthPosition, DepthPlayer[]>;
}

export interface Award {
  id: 'mvp' | 'roy' | 'dpoy' | 'mip' | 'sixth';
  label: string;
  title: string;
  /** Kalshi's series for the award. */
  series: string;
}

export const AWARDS: readonly Award[] = [
  { id: 'mvp', label: 'MVP', title: 'Most Valuable Player', series: 'KXNBAMVP' },
  { id: 'roy', label: 'ROY', title: 'Rookie of the Year', series: 'KXNBAROY' },
  { id: 'dpoy', label: 'DPOY', title: 'Defensive Player of the Year', series: 'KXNBADPOY' },
  { id: 'mip', label: 'MIP', title: 'Most Improved Player', series: 'KXNBAMIMP' },
  { id: 'sixth', label: '6MOY', title: 'Sixth Man of the Year', series: 'KXNBASIXTH' },
];

/** Kalshi's 2026-27 award events end in this. */
export const SEASON_EVENT_SUFFIX = '-27';

/** A gap between the buy and sell price wider than this means few bets: the price is a guess. */
export const THIN_SPREAD = 0.1;

export interface AwardRow {
  name: string;
  /**
   * Chance to win, 0 to 1: the middle of the buy and sell price. With few
   * bets the two sit far apart and the middle means nothing, so it is the
   * highest price anyone has offered instead.
   */
  chance: number;
  bid: number;
  ask: number;
  /** Few bets on him: the buy and sell prices sit far apart. */
  thin: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A price Kalshi sends as a string of dollars, as a number from 0 to 1, or null. */
function price(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/** One team's depth chart from ESPN's site API. Throws in plain words on a shape it does not know. */
export function parseDepthChart(body: unknown): TeamDepth {
  const root = record(body);
  const team = record(root?.team);
  const chart = Array.isArray(root?.depthchart) ? record(root.depthchart[0]) : null;
  const positions = record(chart?.positions);
  if (!team || !positions) throw new Error('ESPN sent a depth chart this page cannot read.');
  const slots = {} as Record<DepthPosition, DepthPlayer[]>;
  for (const position of DEPTH_POSITIONS) {
    const athletes = record(positions[position.toLowerCase()])?.athletes;
    slots[position] = (Array.isArray(athletes) ? athletes : [])
      .map((athlete): DepthPlayer | null => {
        const entry = record(athlete);
        const id = text(entry?.id);
        const name = text(entry?.displayName);
        if (!entry || !id || !name) return null;
        const injury = Array.isArray(entry.injuries) ? record(entry.injuries[0]) : null;
        return {
          id,
          name,
          injury: injury ? { status: text(injury.status) || 'Injured', note: text(injury.shortComment) } : null,
        };
      })
      .filter((player): player is DepthPlayer => player !== null);
  }
  return {
    teamId: text(team.id),
    abbrev: text(team.abbreviation),
    name: text(team.displayName),
    slots,
  };
}

/**
 * One award's open markets from Kalshi, best chance first. Only this season's
 * event counts, and anyone under 1% is left off.
 */
export function parseAwardMarkets(body: unknown, eventSuffix = SEASON_EVENT_SUFFIX): AwardRow[] {
  const markets = record(body)?.markets;
  if (!Array.isArray(markets)) throw new Error('Kalshi sent odds this page cannot read.');
  const rows: AwardRow[] = [];
  for (const market of markets) {
    const entry = record(market);
    if (!entry || !text(entry.event_ticker).endsWith(eventSuffix)) continue;
    if (entry.status !== undefined && entry.status !== 'active' && entry.status !== 'open') continue;
    const name = text(entry.yes_sub_title);
    const bid = price(entry.yes_bid_dollars) ?? 0;
    const ask = price(entry.yes_ask_dollars);
    if (!name || ask === null || ask === 0) continue;
    const thin = ask - bid > THIN_SPREAD;
    const chance = thin ? bid : (bid + ask) / 2;
    if (chance < 0.01) continue;
    rows.push({ name, chance, bid, ask, thin });
  }
  return rows.sort((a, b) => b.chance - a.chance || a.name.localeCompare(b.name));
}

/** A name with case, accents, dots and Jr./III taken off, so two sources can agree on it. */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’-]/g, '')
    .split(/\s+/)
    .filter((part) => part && !/^(jr|sr|ii|iii|iv|v)$/.test(part))
    .join(' ');
}

export interface DepthSpot {
  abbrev: string;
  /** Where he sits, like PG1 or SF2, best first. */
  spots: string[];
}

/** Each player's team and depth spots, found by name. */
export function depthSpots(teams: readonly TeamDepth[]): Map<string, DepthSpot> {
  const found = new Map<string, DepthSpot & { ranks: number[] }>();
  for (const team of teams) {
    for (const position of DEPTH_POSITIONS) {
      team.slots[position].forEach((player, index) => {
        const key = nameKey(player.name);
        const spot = found.get(key) ?? { abbrev: team.abbrev, spots: [], ranks: [] };
        spot.spots.push(`${position}${index + 1}`);
        spot.ranks.push(index);
        found.set(key, spot);
      });
    }
  }
  const result = new Map<string, DepthSpot>();
  for (const [key, spot] of found) {
    const order = spot.spots.map((label, index) => ({ label, rank: spot.ranks[index], index }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    result.set(key, { abbrev: spot.abbrev, spots: order.map((entry) => entry.label) });
  }
  return result;
}

export interface AwardOdds {
  award: Award;
  rows: AwardRow[];
}

export interface AwardBadge {
  label: string;
  chance: number;
}

/** The awards each player has a real shot at, at least `min`, best chance first. */
export function awardBadges(awards: readonly AwardOdds[], min = 0.1): Map<string, AwardBadge[]> {
  const badges = new Map<string, AwardBadge[]>();
  for (const { award, rows } of awards) {
    for (const row of rows) {
      if (row.chance < min) continue;
      const key = nameKey(row.name);
      badges.set(key, [...(badges.get(key) ?? []), { label: award.label, chance: row.chance }]);
    }
  }
  for (const list of badges.values()) list.sort((a, b) => b.chance - a.chance);
  return badges;
}

export interface AwardResult {
  award: Award;
  rows: AwardRow[];
  /** Kalshi did not answer for this award, in plain words. */
  error?: string;
}

/** What the server sends the AWARDS & DEPTH page. */
export interface NbaWatch {
  fetchedAt: string;
  teams: TeamDepth[];
  awards: AwardResult[];
  /** Teams ESPN did not answer for, in plain words. */
  errors: string[];
}

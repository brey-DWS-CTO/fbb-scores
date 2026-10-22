/**
 * The app's sections: what the sidebar and the phone bar list, and the tabs
 * inside each one. Seven sections instead of thirteen pages, so the sidebar
 * stays short. Every page keeps its own address, so old links still work and
 * land on the right tab.
 *
 * Pure. No server, no browser.
 */
import { leagueSchedule2027 } from './scheduleData.js';
import type { SeasonMode } from './seasonMode.js';

export type SectionIcon = 'lock' | 'target' | 'arrows' | 'home' | 'book' | 'shield' | 'tv' | 'trophy' | 'bolt';

export interface SectionTab {
  to: string;
  label: string;
  commishOnly?: boolean;
  mode?: SeasonMode;
  beforeReveal?: boolean;
  pages?: readonly SectionTab[];
}

export interface NavSection {
  id: 'scores' | 'cast' | 'keepers' | 'draft' | 'trades' | 'league' | 'vault' | 'rules' | 'commish';
  label: string;
  shortLabel?: string;
  icon: SectionIcon;
  /** On the phone's bottom bar; the rest sit behind MORE. */
  primary?: boolean;
  commishOnly?: boolean;
  /**
   * Where the section opens. Without one, its first tab. A home that is not a
   * tab is a landing page: the tabs stay hidden there.
   */
  home?: string;
  tabs: SectionTab[];
}

/** Views share one League tab while preserving existing saved links. */
export const ACTIVITY_VIEWS: readonly SectionTab[] = [
  { to: '/activity', label: 'MOVES' },
  { to: '/waivers', label: 'WAIVERS', mode: 'in-season' },
  { to: '/lm-adds', label: 'LM ADDS', mode: 'in-season' },
];

/** The sections in their pre-season order. `visibleSections` reorders them once the season starts. */
export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'keepers', label: 'KEEPERS', icon: 'lock', primary: true, tabs: [{ to: '/keepers', label: 'KEEPERS' }] },
  {
    id: 'draft',
    label: 'DRAFT',
    icon: 'target',
    primary: true,
    home: '/draft/start',
    tabs: [
      { to: '/draft', label: 'BOARD' },
      { to: '/draft/recap', label: 'RECAP' },
      { to: '/my-rankings', label: 'MY RANKINGS', mode: 'off-season' },
      { to: '/mock', label: 'MOCK DRAFT', mode: 'off-season' },
      { to: '/projections', label: 'PROJECTIONS', mode: 'off-season' },
      { to: '/tiers', label: 'TIERS', mode: 'off-season' },
    ],
  },
  { id: 'scores', label: 'SCORES', icon: 'tv', tabs: [{ to: '/scores', label: 'SCORES' }] },
  { id: 'cast', label: 'FANTASY CAST', shortLabel: 'CAST', icon: 'bolt', primary: true, tabs: [{ to: '/scores/cast', label: 'FANTASY CAST' }] },
  { id: 'trades', label: 'TRADES', icon: 'arrows', primary: true, tabs: [{ to: '/trades', label: 'TRADES' }] },
  {
    id: 'league',
    label: 'LEAGUE',
    icon: 'home',
    primary: true,
    tabs: [
      { to: '/league', label: 'LEAGUE HQ' },
      { to: '/watch', label: 'WATCH', mode: 'in-season' },
      { to: '/activity', label: 'ACTIVITY', pages: ACTIVITY_VIEWS },
      { to: '/teams', label: 'TEAMS' },
      { to: '/dues', label: 'DUES' },
      { to: '/history', label: 'HISTORY' },
    ],
  },
  {
    // Pre-draft side games stay behind MORE to keep the phone bar compact.
    id: 'vault',
    label: 'VAULT',
    icon: 'trophy',
    tabs: [
      { to: '/achievements', label: 'ACHIEVEMENTS' },
      { to: '/revealed', label: 'REVEALED', beforeReveal: true },
      { to: '/props', label: 'PROP BETS' },
    ],
  },
  {
    id: 'rules',
    label: 'RULES',
    icon: 'book',
    tabs: [
      { to: '/rules', label: 'RULEBOOK' },
      { to: '/votes', label: 'VOTES' },
    ],
  },
  {
    id: 'commish',
    label: 'COMMISH',
    icon: 'shield',
    commishOnly: true,
    tabs: [
      { to: '/admin', label: 'CONTROLS' },
      { to: '/schedule', label: 'SCHEDULE' },
      { to: '/awards', label: 'AWARDS' },
      { to: '/depth', label: 'DEPTH CHARTS' },
    ],
  },
];

/** The first day of the league's week 1. */
export const SEASON_START = leagueSchedule2027[0].startDate;

/** Today as YYYY-MM-DD in the viewer's own time zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True when `pathname` is `to` or a page under it, so /keepers/Brey is KEEPERS. */
export function onPath(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * The one tab a page lights up: the longest tab path it sits on, so
 * /draft/recap is RECAP and not BOARD as well.
 */
export function activeTab(pathname: string, tabs: readonly SectionTab[]): string | null {
  return tabs
    .filter((tab) => onPath(pathname, tab.to) || tab.pages?.some(page => onPath(pathname, page.to)))
    .reduce<string | null>((best, tab) => (best === null || tab.to.length > best.length ? tab.to : best), null);
}

/** Keep menus focused on the current mode; saved page addresses remain valid. */
export function visibleSections(isCommissioner: boolean, keepersPublic: boolean, mode: SeasonMode): NavSection[] {
  const order = mode === 'in-season'
    ? ['scores', 'cast', 'league', 'trades', 'rules', 'commish', 'draft']
    : ['keepers', 'draft', 'cast', 'trades', 'league', 'vault', 'rules', 'commish'];
  return order.flatMap((id) => {
    const section = NAV_SECTIONS.find((entry) => entry.id === id);
    if (!section || (section.commishOnly && !isCommissioner)) return [];
    const archive = mode === 'in-season' && id === 'draft';
    return [{
      ...section,
      label: archive ? 'DRAFT RESULTS' : section.label,
      home: archive ? '/draft' : section.home,
      primary: mode === 'in-season'
        ? ['scores', 'cast', 'league', 'trades'].includes(id)
        : ['keepers', 'draft', 'cast', 'league'].includes(id),
      tabs: section.tabs.filter((tab) =>
        (!tab.commishOnly || isCommissioner)
        && (!tab.mode || tab.mode === mode)
        && (!tab.beforeReveal || !keepersPublic))
        .map(tab => ({ ...tab, pages: tab.pages?.filter(page => !page.mode || page.mode === mode) })),
    }];
  });
}

/** The section a page belongs to, or null for pages outside the nav. */
export function sectionFor(pathname: string, sections: readonly NavSection[]): NavSection | null {
  return sections.reduce<NavSection | null>((best, section) => {
    const match = activeTab(pathname, section.tabs);
    const previous = best && activeTab(pathname, best.tabs);
    return match && (!previous || match.length > previous.length) ? section : best;
  }, null);
}

/** Where a section's link goes: its home, else its first tab. */
export function sectionHome(section: NavSection): string {
  return section.home ?? section.tabs[0].to;
}

/** True on a section's landing page, where the tabs stay out of the way. */
export function onLanding(pathname: string, section: NavSection): boolean {
  return section.home !== undefined && pathname === section.home && !section.tabs.some((tab) => tab.to === section.home);
}

/**
 * The app's sections: what the sidebar and the phone bar list, and the tabs
 * inside each one. Seven sections instead of thirteen pages, so the sidebar
 * stays short. Every page keeps its own address, so old links still work and
 * land on the right tab.
 *
 * Pure. No server, no browser.
 */
import { leagueSchedule2027 } from './scheduleData.js';

export type SectionIcon = 'lock' | 'target' | 'arrows' | 'home' | 'book' | 'shield' | 'tv' | 'trophy';

export interface SectionTab {
  to: string;
  label: string;
  commishOnly?: boolean;
}

export interface NavSection {
  id: 'scores' | 'keepers' | 'draft' | 'trades' | 'league' | 'vault' | 'rules' | 'commish';
  label: string;
  icon: SectionIcon;
  /** On the phone's bottom bar; the rest sit behind MORE. */
  primary?: boolean;
  /** On the bottom bar only until keepers go public, then behind MORE. */
  primaryUntilKeepersPublic?: boolean;
  commishOnly?: boolean;
  /**
   * Where the section opens. Without one, its first tab. A home that is not a
   * tab is a landing page: the tabs stay hidden there.
   */
  home?: string;
  tabs: SectionTab[];
}

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
      { to: '/my-rankings', label: 'MY RANKINGS' },
      { to: '/mock', label: 'MOCK DRAFT' },
      { to: '/projections', label: 'PROJECTIONS' },
      { to: '/tiers', label: 'TIERS' },
    ],
  },
  { id: 'scores', label: 'SCORES', icon: 'tv', tabs: [{ to: '/scores', label: 'SCORES' }] },
  { id: 'trades', label: 'TRADES', icon: 'arrows', primary: true, tabs: [{ to: '/trades', label: 'TRADES' }] },
  {
    id: 'league',
    label: 'LEAGUE',
    icon: 'home',
    primary: true,
    tabs: [
      { to: '/league', label: 'LEAGUE HQ' },
      { to: '/activity', label: 'ACTIVITY' },
      { to: '/teams', label: 'TEAMS' },
      { to: '/dues', label: 'DUES' },
      { to: '/history', label: 'HISTORY' },
    ],
  },
  {
    // The pre-draft side games. Reveals mean nothing once keepers are public,
    // so on draft day it steps off the phone bar and gives the room back.
    id: 'vault',
    label: 'VAULT',
    icon: 'trophy',
    primaryUntilKeepersPublic: true,
    tabs: [
      { to: '/achievements', label: 'ACHIEVEMENTS' },
      { to: '/revealed', label: 'REVEALED' },
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

/** True from the first day of week 1 on. */
export function seasonUnderway(today: string): boolean {
  return today >= SEASON_START;
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
    .filter((tab) => onPath(pathname, tab.to))
    .reduce<string | null>((best, tab) => (best === null || tab.to.length > best.length ? tab.to : best), null);
}

/**
 * The sections a viewer may see, with only the tabs they may see.
 *
 * VAULT sits on the phone bar only until keepers go public. Before the
 * season SCORES sits after DRAFT and behind MORE on a phone: there is
 * nothing to score yet. From the first day of week 1 it moves to the front
 * of the bar, and KEEPERS steps back behind MORE, because the keepers are
 * set and the phone bar holds four sections and no more.
 */
export function visibleSections(isCommissioner: boolean, keepersPublic = false, today: string = todayIso()): NavSection[] {
  const sections = NAV_SECTIONS
    .filter((section) => !section.commishOnly || isCommissioner)
    .map((section) => ({
      ...section,
      primary: section.primary === true || (section.primaryUntilKeepersPublic === true && !keepersPublic),
      tabs: section.tabs.filter((tab) => !tab.commishOnly || isCommissioner),
    }));
  if (!seasonUnderway(today)) return sections;
  const scores = sections.find((section) => section.id === 'scores');
  const rest = sections
    .filter((section) => section.id !== 'scores')
    .map((section) => (section.id === 'keepers' ? { ...section, primary: false } : section));
  return scores ? [{ ...scores, primary: true }, ...rest] : rest;
}

/** The section a page belongs to, or null for pages outside the nav. */
export function sectionFor(pathname: string, sections: readonly NavSection[]): NavSection | null {
  return sections.find((section) => section.tabs.some((tab) => onPath(pathname, tab.to))) ?? null;
}

/** Where a section's link goes: its home, else its first tab. */
export function sectionHome(section: NavSection): string {
  return section.home ?? section.tabs[0].to;
}

/** True on a section's landing page, where the tabs stay out of the way. */
export function onLanding(pathname: string, section: NavSection): boolean {
  return section.home !== undefined && pathname === section.home && !section.tabs.some((tab) => tab.to === section.home);
}

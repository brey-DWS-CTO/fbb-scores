/**
 * The app's sections: what the sidebar and the phone bar list, and the tabs
 * inside each one. Six sections instead of twelve pages, so the sidebar stays
 * short. Every page keeps its own address, so old links still work and land
 * on the right tab.
 *
 * Pure. No server, no browser.
 */

export type SectionIcon = 'lock' | 'target' | 'arrows' | 'home' | 'book' | 'shield';

export interface SectionTab {
  to: string;
  label: string;
  commishOnly?: boolean;
}

export interface NavSection {
  id: 'keepers' | 'draft' | 'trades' | 'league' | 'rules' | 'commish';
  label: string;
  icon: SectionIcon;
  /** On the phone's bottom bar; the rest sit behind MORE. */
  primary?: boolean;
  commishOnly?: boolean;
  /** The first tab is where the section opens. */
  tabs: SectionTab[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  { id: 'keepers', label: 'KEEPERS', icon: 'lock', primary: true, tabs: [{ to: '/keepers', label: 'KEEPERS' }] },
  {
    id: 'draft',
    label: 'DRAFT',
    icon: 'target',
    primary: true,
    tabs: [
      { to: '/draft', label: 'BOARD' },
      { to: '/mock', label: 'MOCK DRAFT' },
      { to: '/projections', label: 'PROJECTIONS' },
      { to: '/tiers', label: 'TIERS' },
    ],
  },
  { id: 'trades', label: 'TRADES', icon: 'arrows', primary: true, tabs: [{ to: '/trades', label: 'TRADES' }] },
  {
    id: 'league',
    label: 'LEAGUE',
    icon: 'home',
    primary: true,
    tabs: [
      { to: '/league', label: 'LEAGUE HQ' },
      { to: '/teams', label: 'TEAMS' },
      { to: '/history', label: 'HISTORY' },
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
    ],
  },
];

/** True when `pathname` is `to` or a page under it, so /keepers/Brey is KEEPERS. */
export function onPath(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The sections a viewer may see, with only the tabs they may see. */
export function visibleSections(isCommissioner: boolean): NavSection[] {
  return NAV_SECTIONS
    .filter((section) => !section.commishOnly || isCommissioner)
    .map((section) => ({ ...section, tabs: section.tabs.filter((tab) => !tab.commishOnly || isCommissioner) }));
}

/** The section a page belongs to, or null for pages outside the nav. */
export function sectionFor(pathname: string, sections: readonly NavSection[]): NavSection | null {
  return sections.find((section) => section.tabs.some((tab) => onPath(pathname, tab.to))) ?? null;
}

/** Where a section's link goes: its first tab. */
export function sectionHome(section: NavSection): string {
  return section.tabs[0].to;
}

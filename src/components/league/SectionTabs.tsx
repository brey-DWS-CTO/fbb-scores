import { NavLink, useLocation } from 'react-router-dom';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import { activeTab, onLanding, sectionFor, visibleSections } from '../../lib/league/navSections.js';

/** The tabs across the top of a section with more than one page. */
export default function SectionTabs() {
  const { identity } = useIdentity();
  const { meta, seasonMode } = useLeagueState();
  const { pathname } = useLocation();
  const section = sectionFor(pathname, visibleSections(identity?.isCommissioner === true, meta?.revealed === true, seasonMode, identity?.isGuest === true));
  if (!section || section.tabs.length < 2 || onLanding(pathname, section)) return null;
  const active = activeTab(pathname, section.tabs);
  const pages = section.tabs.find(tab => tab.to === active)?.pages;
  return (
    <>
    <nav className="section-tabs" aria-label={`${section.label} pages`}>
      {section.tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          // `end` keeps the router from lighting /draft on /draft/recap; `active` decides.
          end
          className={active === tab.to ? 'section-tab hub-heading active' : 'section-tab hub-heading'}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
    {pages && pages.length > 1 && <nav className="activity-view-tabs" aria-label="Activity views">
      {pages.map(page => <NavLink key={page.to} to={page.to} end className={({ isActive }) => `activity-view-tab${isActive ? ' active' : ''}`}>
        {page.label}
      </NavLink>)}
    </nav>}
    </>
  );
}

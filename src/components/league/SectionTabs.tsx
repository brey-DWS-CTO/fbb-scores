import { NavLink, useLocation } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { onPath, sectionFor, visibleSections } from '../../lib/league/navSections.js';

/** The tabs across the top of a section with more than one page. */
export default function SectionTabs() {
  const { identity } = useIdentity();
  const { pathname } = useLocation();
  const section = sectionFor(pathname, visibleSections(identity?.isCommissioner === true));
  if (!section || section.tabs.length < 2) return null;
  return (
    <nav className="section-tabs" aria-label={`${section.label} pages`}>
      {section.tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={onPath(pathname, tab.to) ? 'section-tab hub-heading active' : 'section-tab hub-heading'}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

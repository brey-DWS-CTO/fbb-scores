import { useEffect, useLayoutEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../../lib/league/sidebar.js';
import { onPath, sectionFor, sectionHome, visibleSections } from '../../lib/league/navSections.js';

function TradeBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="nav-badge" aria-label={`${count} offers waiting`}>
      {count}
    </span>
  );
}

export default function AppNav() {
  const { identity } = useIdentity();
  const { meta } = useLeagueState();
  const location = useLocation();
  // The sheet is open only for the path it was opened on, so navigating
  // anywhere closes it without an effect.
  const [moreAnchor, setMoreAnchor] = useState<string | null>(null);
  const moreOpen = moreAnchor === location.pathname;
  const setMoreOpen = (open: boolean) => setMoreAnchor(open ? location.pathname : null);

  // Offers waiting on this member. The server counts them, so the badge cannot
  // give away an offer between two other teams.
  const pendingTrades = meta?.pendingTrades ?? 0;

  // Desktop only: the sidebar shrinks to icons so wide pages get the room.
  // The class sits on <html> because the page shell that must widen with it
  // lives outside this component.
  const [collapsed, setCollapsed] = useState(() =>
    readSidebarCollapsed(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('nav-collapsed', collapsed);
    return () => document.documentElement.classList.remove('nav-collapsed');
  }, [collapsed]);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCollapsed(window.localStorage, next);
  };

  // One list drives both bars. `primary` sections sit on the phone's bottom
  // bar; the rest live behind MORE. Desktop shows every section.
  const sections = visibleSections(identity?.isCommissioner === true);
  const current = sectionFor(location.pathname, sections);
  const primary = sections.filter((section) => section.primary);
  const secondary = sections.filter((section) => !section.primary);
  const moreActive = current !== null && !current.primary;

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreAnchor(null);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [moreOpen]);



  return (
    <>
      <header className="top-nav" id="app-sidebar">
        <div className="top-nav-inner">
          <div className="top-nav-head">
            <NavLink to="/keepers" className="top-nav-brand hub-heading">
              <img src="/logo.png" alt="" aria-hidden="true" />
              <span>FBB Scores</span>
            </NavLink>
            <button
              type="button"
              className="nav-collapse-btn tap-btn"
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              title={collapsed ? 'Show the menu' : 'Hide the menu'}
              aria-label={collapsed ? 'Show the menu' : 'Hide the menu'}
              onClick={toggleSidebar}
            >
              <NavIcon name="menu" />
            </button>
          </div>
          <nav className="top-nav-links" aria-label="Main">
            {sections.map((t) => (
              <NavLink
                key={t.id}
                to={sectionHome(t)}
                className={current?.id === t.id ? 'top-nav-link hub-heading active' : 'top-nav-link hub-heading'}
                {...(collapsed ? { title: t.label, 'aria-label': t.label } : {})}
              >
                <span aria-hidden="true"><NavIcon name={t.icon} /></span><span className="top-nav-label">{t.label}</span>
                {t.id === 'trades' && pendingTrades > 0 && (
                  <span className="nav-pill" aria-label={`${pendingTrades} offers waiting`}>
                    {pendingTrades}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="top-nav-account">
            <IdentityChip placement="nav" />
          </div>
        </div>
      </header>


      <nav className="bottom-nav" aria-label="Main">
        {primary.map((t) => (
          <NavLink
            key={t.id}
            to={sectionHome(t)}
            className={current?.id === t.id ? 'bottom-nav-tab active' : 'bottom-nav-tab'}
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              <NavIcon name={t.icon} />
              {t.id === 'trades' && <TradeBadge count={pendingTrades} />}
            </span>
            <span className="hub-heading bottom-nav-label">{t.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={moreActive || moreOpen ? 'bottom-nav-tab tap-btn active' : 'bottom-nav-tab tap-btn'}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <span className="bottom-nav-icon" aria-hidden="true"><NavIcon name="menu" /></span>
          <span className="hub-heading bottom-nav-label">MORE</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="more-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="more-drawer" role="dialog" aria-modal="true" aria-label="More pages">
            <div className="more-drawer-head">
              <span className="hub-heading more-drawer-title">More</span>
              <button
                type="button"
                className="tap-btn more-drawer-close"
                aria-label="Close menu"
                onClick={() => setMoreOpen(false)}
              >
                <NavIcon name="close" />
              </button>
            </div>
            <div className="more-list">
              {secondary.map((section) => (
                <section className="more-section" key={section.id} aria-labelledby={`more-${section.id}`}>
                  <h2 className="more-section-title hub-heading" id={`more-${section.id}`}>{section.label}</h2>
                  {section.tabs.map((tab) => (
                    <NavLink
                      key={tab.to}
                      to={tab.to}
                      className={onPath(location.pathname, tab.to) ? 'more-item active' : 'more-item'}
                      onClick={() => setMoreOpen(false)}
                    >
                      <span className="more-item-icon" aria-hidden="true"><NavIcon name={section.icon} /></span>
                      <span className="hub-heading more-item-label">{tab.label}</span>
                    </NavLink>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

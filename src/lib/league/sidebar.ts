// The desktop sidebar remembers whether it was collapsed to icons. The choice
// lives in localStorage, which a private window or blocked site data can make
// throw, so both helpers swallow errors and fall back to "open".

export const SIDEBAR_KEY = 'nerds.nav.collapsed';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** True only when the store holds an explicit "collapsed" mark. */
export function readSidebarCollapsed(store: Store | undefined): boolean {
  try {
    return store?.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

/** Saves the choice. A store that refuses just means it does not persist. */
export function writeSidebarCollapsed(store: Store | undefined, collapsed: boolean): void {
  try {
    store?.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    // Nothing to do: the sidebar still works, it just forgets on reload.
  }
}

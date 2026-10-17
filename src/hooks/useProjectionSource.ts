import { useSyncExternalStore } from 'react';
import type { ProjectionSource } from '../lib/league/expertProjections.js';
import { useIdentity } from './useLeague.js';

const KEY = 'fbb-projection-source';
const SOURCES: readonly ProjectionSource[] = ['espn', 'hashtag', 'blend'];
const listeners = new Set<() => void>();

function read(): ProjectionSource {
  try {
    const value = window.localStorage.getItem(KEY);
    return SOURCES.includes(value as ProjectionSource) ? value as ProjectionSource : 'espn';
  } catch {
    return 'espn';
  }
}

let current: ProjectionSource = typeof window === 'undefined' ? 'espn' : read();

/** Pick the commissioner's projection source. Remembered on this device. */
export function setProjectionSource(source: ProjectionSource): void {
  current = source;
  try { window.localStorage.setItem(KEY, source); } catch { /* no storage: lasts until reload */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The projection source in use: the commissioner's pick, ESPN for everyone else. */
export function useProjectionSource(): ProjectionSource {
  const { identity } = useIdentity();
  const picked = useSyncExternalStore(subscribe, () => current, () => 'espn' as const);
  return identity?.isCommissioner === true ? picked : 'espn';
}

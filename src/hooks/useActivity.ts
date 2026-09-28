/**
 * When the person at this screen last did anything.
 *
 * One set of listeners for the whole page. The polling rule in
 * src/lib/league/polling.ts reads the idle time; a page that stopped
 * polling while idle registers here to be woken on the next tap.
 */
import type { QueryClient } from '@tanstack/react-query';
import { IDLE_AFTER_MS } from '../lib/league/polling.js';

let lastActivityAt = Date.now();
let installed = false;
/** Each client, and how many mounted pages want it woken. */
const clients = new Map<QueryClient, number>();

function markActive(): void {
  const wasIdle = Date.now() - lastActivityAt >= IDLE_AFTER_MS;
  lastActivityAt = Date.now();
  if (!wasIdle) return;
  for (const client of clients.keys()) void client.invalidateQueries({ queryKey: ['league-state'] });
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const options = { passive: true, capture: true };
  for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(event, markActive, options);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markActive();
  });
}

export function idleForMs(): number {
  return Date.now() - lastActivityAt;
}

/** Refetch league state on the first sign of life after an idle spell. */
export function wakeOnActivity(client: QueryClient): () => void {
  install();
  clients.set(client, (clients.get(client) ?? 0) + 1);
  return () => {
    const left = (clients.get(client) ?? 1) - 1;
    if (left > 0) clients.set(client, left);
    else clients.delete(client);
  };
}

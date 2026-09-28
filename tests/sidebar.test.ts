import assert from 'node:assert/strict';
import test from 'node:test';
import { SIDEBAR_KEY, readSidebarCollapsed, writeSidebarCollapsed } from '../src/lib/league/sidebar.js';

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const brokenStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

test('the sidebar starts open when nothing is saved', () => {
  assert.equal(readSidebarCollapsed(fakeStore()), false);
  assert.equal(readSidebarCollapsed(undefined), false);
});

test('only an explicit collapsed mark counts', () => {
  assert.equal(readSidebarCollapsed(fakeStore({ [SIDEBAR_KEY]: '1' })), true);
  assert.equal(readSidebarCollapsed(fakeStore({ [SIDEBAR_KEY]: '0' })), false);
  assert.equal(readSidebarCollapsed(fakeStore({ [SIDEBAR_KEY]: 'yes' })), false);
});

test('writing then reading round-trips the choice', () => {
  const store = fakeStore();
  writeSidebarCollapsed(store, true);
  assert.equal(readSidebarCollapsed(store), true);
  writeSidebarCollapsed(store, false);
  assert.equal(readSidebarCollapsed(store), false);
});

test('a store that throws never breaks the nav', () => {
  assert.equal(readSidebarCollapsed(brokenStore), false);
  assert.doesNotThrow(() => writeSidebarCollapsed(brokenStore, true));
  assert.doesNotThrow(() => writeSidebarCollapsed(undefined, true));
});

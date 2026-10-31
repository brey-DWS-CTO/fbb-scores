import type { RulebookIndex } from './rulebook.js';

const clauseId = 'transactions.waivers.lmadd.public';
const oldText = 'The LM add must be announced publicly in the league group chat. No exceptions for phone calls, personal conversations, or similar.';
export const lmAddRequestText = 'The LM add must be requested through the app or announced publicly in the league group chat. No exceptions for phone calls, personal conversations, or similar.';

/** Display clarification only. Published books and their signatures stay intact. */
export function lmAddRuleDisplay(index: RulebookIndex): RulebookIndex {
  const clause = index.byId.get(clauseId);
  if (clause?.text !== oldText) return index;
  const updated = { ...clause, text: lmAddRequestText };
  const byId = new Map(index.byId);
  byId.set(clauseId, updated);
  return { entries: index.entries.map((entry) => entry === clause ? updated : entry), byId };
}

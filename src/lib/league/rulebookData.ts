import rawRulebook from '../../data/source/rulebook-2027.json';
import { buildRulebookIndex, type Rulebook } from './rulebook.js';

/**
 * The committed 2027 rulebook seed, imported from the constitution docx.
 *
 * This is the fallback, exactly as the player pool and schedule work. Once
 * phase 3 lands, published versions live in Neon and this stays the seed.
 */
export const rulebook2027 = rawRulebook as unknown as Rulebook;

/** Numbers and cross-references resolved once for the whole app. */
export const rulebookIndex2027 = buildRulebookIndex(rulebook2027);

/**
 * Linking rule prose to the numbers the app actually enforces.
 *
 * Clauses carry `settings: ["keeper.salaryCap"]`. This module says what each of
 * those keys is worth in the running app, and flags a clause whose wording
 * quotes a different number.
 *
 * It is deliberately cautious. A clause is only flagged when the app really
 * enforces a value AND the prose quotes numbers AND the enforced one is not
 * among them. Anything the app does not enforce is reported as such rather than
 * guessed at, because a false alarm on a constitution is worse than a gap.
 */

import type { LeagueDataset } from '../keeper/types.js';
import { buildRulebookIndex, type Rulebook, type RulebookEntry } from './rulebook.js';

export interface SettingSpec {
  key: string;
  label: string;
  /** What the app enforces today, or null when nothing enforces it yet. */
  value: number | string | null;
  /** Where the live value comes from, so a reader can go check it. */
  source: string;
}

export type SettingStatus = 'ok' | 'check' | 'unenforced' | 'unknown-key';

export interface SettingAudit {
  key: string;
  label: string;
  value: number | string | null;
  source: string;
  status: SettingStatus;
  /** The rules that cite this setting, by number. */
  citedBy: Array<{ id: string; number: string; title?: string }>;
  /** Set on 'check': the numbers the prose quotes instead. */
  quoted?: number[];
  detail?: string;
}

/** Every setting the app can speak to, sourced from the committed dataset. */
export function buildSettingsRegistry(dataset: LeagueDataset): Map<string, SettingSpec> {
  const specs: SettingSpec[] = [
    {
      key: 'keeper.salaryCap',
      label: 'Keeper salary cap',
      value: dataset.cap,
      source: 'Computed from the 3rd round tier',
    },
    {
      key: 'keeper.salaryCapFormula',
      label: 'Cap formula inputs',
      value: `${dataset.capRule.round3Min} + ${dataset.capRule.round3Max}`,
      source: '3rd round tier bottom + top',
    },
    {
      key: 'keeper.maxPerTeam',
      label: 'Keepers per team',
      value: dataset.maxKeepersPerTeam,
      source: 'Keeper engine',
    },
    {
      key: 'league.teamCount',
      label: 'Teams in the league',
      value: dataset.teams.length,
      source: 'League config',
    },
    {
      key: 'keeper.contractYears',
      label: 'Contract years by round',
      value: Object.entries(dataset.contractMaxYearsByRound)
        .map(([round, years]) => `${round}:${years}`)
        .join(' '),
      source: 'Keeper engine',
    },
    {
      key: 'picktrade.tradableRounds',
      label: 'Rounds that can be traded',
      value: `3-${dataset.draftRounds}`,
      source: 'Commissioner ruling, ahead of the rule book',
    },
  ];
  return new Map(specs.map((spec) => [spec.key, spec]));
}

/** Numbers quoted in a piece of prose, decimals included. */
export function quotedNumbers(text: string): number[] {
  const found = text.match(/\d+(?:\.\d+)?/g);
  return found ? found.map(Number) : [];
}

function mentions(text: string, value: number): boolean {
  return quotedNumbers(text).some((n) => Math.abs(n - value) < 0.001);
}

/**
 * Compare the contract table in the book against what the engine enforces.
 * This one can be checked exactly, so it is checked exactly.
 */
function auditContractTable(
  entry: RulebookEntry,
  dataset: LeagueDataset,
): string | null {
  if (!entry.table) return null;
  const wrong: string[] = [];
  for (const row of entry.table.rows) {
    const round = row[0]?.trim();
    const years = Number(row[1]);
    const enforced = dataset.contractMaxYearsByRound[round];
    if (enforced === undefined) {
      wrong.push(`round ${round} is not a round the app knows`);
    } else if (enforced !== years) {
      wrong.push(`round ${round} says ${row[1]}, the app uses ${enforced}`);
    }
  }
  const rounds = Object.keys(dataset.contractMaxYearsByRound);
  const listed = new Set(entry.table.rows.map((r) => r[0]?.trim()));
  for (const round of rounds) {
    if (!listed.has(round)) wrong.push(`round ${round} is missing from the table`);
  }
  return wrong.length ? wrong.join('; ') : null;
}

/**
 * Every setting key the book cites, with whether the prose still agrees.
 * Sorted worst first, so what needs attention is at the top.
 */
export function auditRulebookSettings(
  book: Rulebook,
  dataset: LeagueDataset,
): SettingAudit[] {
  const registry = buildSettingsRegistry(dataset);
  const index = buildRulebookIndex(book);
  const byKey = new Map<string, SettingAudit>();

  for (const entry of index.entries) {
    for (const key of entry.settings ?? []) {
      const spec = registry.get(key);
      let audit = byKey.get(key);
      if (!audit) {
        audit = {
          key,
          label: spec?.label ?? key,
          value: spec?.value ?? null,
          source: spec?.source ?? 'Nothing in the app reads this yet',
          status: spec ? 'ok' : 'unknown-key',
          citedBy: [],
        };
        byKey.set(key, audit);
      }
      audit.citedBy.push({ id: entry.id, number: entry.number, title: entry.title });

      if (!spec) continue;

      if (key === 'keeper.contractYears') {
        const problem = auditContractTable(entry, dataset);
        if (problem) {
          audit.status = 'check';
          audit.detail = problem;
        }
        continue;
      }

      if (typeof spec.value !== 'number' || !entry.text) continue;
      const quoted = quotedNumbers(entry.text);
      if (quoted.length && !mentions(entry.text, spec.value)) {
        audit.status = 'check';
        audit.quoted = quoted;
        audit.detail = `The rule quotes ${quoted.join(', ')}; the app uses ${spec.value}.`;
      }
    }
  }

  // Keys the app knows about but no rule cites: worth naming, not alarming.
  for (const [key, spec] of registry) {
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      label: spec.label,
      value: spec.value,
      source: spec.source,
      status: 'unenforced',
      citedBy: [],
      detail: 'No rule points at this setting.',
    });
  }

  const rank: Record<SettingStatus, number> = {
    check: 0,
    'unknown-key': 1,
    unenforced: 2,
    ok: 3,
  };
  return [...byKey.values()].sort(
    (a, b) => rank[a.status] - rank[b.status] || a.key.localeCompare(b.key),
  );
}

/** How many settings need a look. Publishing warns on this. */
export function settingsNeedingAttention(audits: SettingAudit[]): SettingAudit[] {
  return audits.filter((a) => a.status === 'check');
}

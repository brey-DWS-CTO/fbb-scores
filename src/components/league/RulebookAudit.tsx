import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import RulebookHistory from './RulebookHistory.js';
import { anchorFor, type Rulebook } from '../../lib/league/rulebook.js';
import { auditRulebookSettings, type SettingAudit } from '../../lib/league/rulebookSettings.js';
import type { RulebookVersionSummary } from '../../lib/league/api.js';
import { useLeagueData } from '../../hooks/useLeague.js';

const STATUS_LABEL: Record<SettingAudit['status'], string> = {
  check: 'CHECK',
  'unknown-key': 'NOT WIRED',
  unenforced: 'UNUSED',
  ok: 'AGREES',
};

/**
 * Two commissioner views over the rule book: which rules disagree with what the
 * app enforces, and what has been published so far.
 *
 * Both are read-only. The settings audit is deliberately cautious; see
 * rulebookSettings.ts for why it would rather report a gap than guess.
 */
export default function RulebookAudit({
  book,
  versions,
  versionError,
  currentVersionId,
}: {
  book: Rulebook;
  /** Loaded once by the page, so the list, the tab, and print agree. */
  versions: RulebookVersionSummary[] | null;
  versionError: string | null;
  currentVersionId: string | null;
}) {
  const { dataset } = useLeagueData();
  const [tab, setTab] = useState<'settings' | 'history' | null>(null);

  const audits = useMemo(
    () => (dataset ? auditRulebookSettings(book, dataset) : []),
    [book, dataset],
  );
  const needsCheck = audits.filter((a) => a.status === 'check');

  return (
    <div className="audit-block">
      <div className="audit-tabs">
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'settings'}
          onClick={() => setTab(tab === 'settings' ? null : 'settings')}
        >
          SETTINGS
          {needsCheck.length > 0 && <span className="audit-badge">{needsCheck.length}</span>}
        </button>
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'history'}
          onClick={() => setTab(tab === 'history' ? null : 'history')}
        >
          HISTORY
        </button>
      </div>

      {tab === 'settings' && (
        <div className="audit-body">
          <p className="rule-edit-hint">
            {needsCheck.length === 0
              ? 'Every rule that names a number agrees with what the app enforces.'
              : needsCheck.length === 1
                ? '1 rule names a number the app does not use.'
                : `${needsCheck.length} rules name a number the app does not use.`}
          </p>
          <ul className="audit-list">
            {audits.map((audit) => (
              <li key={audit.key} className={`audit-row audit-${audit.status}`}>
                <div className="audit-row-head">
                  <span className="audit-status">{STATUS_LABEL[audit.status]}</span>
                  <span className="audit-label">{audit.label}</span>
                  <span className="audit-value">
                    {audit.value === null ? 'not enforced' : String(audit.value)}
                  </span>
                </div>
                {audit.detail && <p className="audit-detail">{audit.detail}</p>}
                {audit.citedBy.length > 0 && (
                  <p className="audit-cited">
                    {audit.citedBy.map((cite, i) => (
                      <span key={cite.id}>
                        {i > 0 && ', '}
                        <Link to={`/rules#${anchorFor(cite.id)}`}>{cite.number}</Link>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'history' && (
        <div className="audit-body">
          <RulebookHistory
            versions={versions}
            error={versionError}
            currentVersionId={currentVersionId}
            viewingId={null}
            emptyLine={`Nothing published yet. The first publish becomes revision ${book.revision}.`}
          />
        </div>
      )}
    </div>
  );
}

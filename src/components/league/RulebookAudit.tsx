import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { anchorFor, type Rulebook } from '../../lib/league/rulebook.js';
import { auditRulebookSettings, type SettingAudit } from '../../lib/league/rulebookSettings.js';
import { fetchRulebookVersions, type RulebookVersionSummary } from '../../lib/league/api.js';
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
export default function RulebookAudit({ book }: { book: Rulebook }) {
  const { dataset } = useLeagueData();
  const [tab, setTab] = useState<'settings' | 'history' | null>(null);
  const [versions, setVersions] = useState<RulebookVersionSummary[] | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);

  const audits = useMemo(
    () => (dataset ? auditRulebookSettings(book, dataset) : []),
    [book, dataset],
  );
  const needsCheck = audits.filter((a) => a.status === 'check');

  useEffect(() => {
    if (tab !== 'history' || versions) return;
    let cancelled = false;
    fetchRulebookVersions()
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch(() => {
        if (!cancelled) setVersionError('Could not load the version history.');
      });
    return () => {
      cancelled = true;
    };
  }, [tab, versions]);

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
          {versionError && <p className="rules-draft-error">{versionError}</p>}
          {!versionError && !versions && <p className="rule-edit-hint">Loading…</p>}
          {versions?.length === 0 && (
            <p className="rule-edit-hint">Nothing published yet. The first publish becomes revision {book.revision}.</p>
          )}
          {versions && versions.length > 0 && (
            <ul className="audit-list">
              {versions.map((version) => (
                <li key={version.id} className="audit-row audit-version">
                  <div className="audit-row-head">
                    <span className="audit-status">REV {version.revision}</span>
                    <span className="audit-label">
                      {new Date(version.publishedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="audit-value">{version.publishedBy}</span>
                  </div>
                  {version.notes && <p className="audit-detail">{version.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

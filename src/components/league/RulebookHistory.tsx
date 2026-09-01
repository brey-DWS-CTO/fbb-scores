import type { RulebookVersionSummary } from '../../lib/league/api.js';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The amendment history: every published revision, newest first, with the note
 * the commissioner wrote and a way into the frozen book itself.
 *
 * Presentational on purpose. The page that shows it owns the fetch, so the
 * same rows serve the on-screen list, the commissioner's HISTORY tab, and the
 * printed document without three trips to the server.
 */
export default function RulebookHistory({
  versions,
  error,
  currentVersionId,
  viewingId,
  onOpen,
  emptyLine,
}: {
  versions: RulebookVersionSummary[] | null;
  error: string | null;
  /** The revision members read right now. */
  currentVersionId: string | null;
  /** The revision on screen, when it is not the current one. */
  viewingId: string | null;
  onOpen?: (versionId: string | null) => void;
  emptyLine: string;
}) {
  if (error) return <p className="rules-draft-error">{error}</p>;
  if (!versions) return <p className="rule-edit-hint">Loading…</p>;
  if (versions.length === 0) return <p className="rule-edit-hint">{emptyLine}</p>;

  return (
    <ul className="audit-list history-list">
      {versions.map((version) => {
        const isCurrent = version.id === currentVersionId;
        const isOpen = viewingId ? version.id === viewingId : isCurrent;
        return (
          <li key={version.id} className="audit-row audit-version">
            <div className="audit-row-head">
              <span className="audit-status">REV {version.revision}</span>
              <span className="audit-label">{formatDay(version.publishedAt)}</span>
              <span className="audit-value">{version.publishedBy}</span>
            </div>
            {version.notes && <p className="audit-detail">{version.notes}</p>}
            {onOpen && (
              <div className="history-actions">
                {isCurrent && <span className="history-tag">CURRENT</span>}
                <button
                  type="button"
                  className="rule-edit-btn tap-btn"
                  disabled={isOpen}
                  onClick={() => onOpen(isCurrent ? null : version.id)}
                >
                  {isOpen ? 'ON SCREEN' : 'READ THIS ONE'}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

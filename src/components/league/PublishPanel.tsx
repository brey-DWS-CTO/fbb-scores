import { useMemo, useState } from 'react';
import type { Rulebook } from '../../lib/league/rulebook.js';
import {
  diffRulebooks,
  rulebookFingerprint,
  summarizeDiff,
  type ChangeKind,
} from '../../lib/league/rulebookDiff.js';

const LABEL: Record<ChangeKind, string> = {
  added: 'ADDED',
  removed: 'REMOVED',
  reworded: 'REWORDED',
  retitled: 'RETITLED',
  moved: 'RENUMBERED',
};

/**
 * The diff between the published book and the saved draft, plus the button
 * that freezes the draft as a new version.
 *
 * The fingerprint shown here is sent with the publish, so the server can refuse
 * if the draft changed after the commissioner looked at this.
 */
export default function PublishPanel({
  published,
  draft,
  dirty,
  busy,
  settingsToCheck,
  onPublish,
}: {
  published: Rulebook;
  draft: Rulebook;
  /** True when there are edits that have not been saved to the draft yet. */
  dirty: boolean;
  busy: boolean;
  /** Rules quoting a number the app does not use. Publishing needs a nod first. */
  settingsToCheck: number;
  onPublish: (fingerprint: string, notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState(false);

  const diff = useMemo(() => diffRulebooks(published, draft), [published, draft]);
  const fingerprint = useMemo(() => rulebookFingerprint(draft), [draft]);

  if (diff.identical) {
    return (
      <p className="rules-draft-note">
        The draft matches the published rule book. Nothing to publish.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rules-tool rules-tool-publish tap-btn"
        onClick={() => setOpen(true)}
      >
        REVIEW &amp; PUBLISH · {summarizeDiff(diff)}
      </button>
    );
  }

  return (
    <div className="publish-panel">
      <div className="publish-head">
        <span className="hub-heading publish-title">PUBLISH TO THE LEAGUE</span>
        <span className="publish-summary">{summarizeDiff(diff)}</span>
      </div>

      {dirty && (
        <p className="rule-edit-warn">
          Save the draft first. Publishing takes the saved draft, not what is on screen.
        </p>
      )}

      <ol className="publish-changes">
        {diff.changes.map((change) => (
          <li key={`${change.kind}-${change.id}`} className={`publish-change publish-${change.kind}`}>
            <div className="publish-change-head">
              <span className="publish-kind">{LABEL[change.kind]}</span>
              <span className="publish-number">
                {change.kind === 'added' && change.toNumber}
                {change.kind === 'removed' && change.fromNumber}
                {change.kind !== 'added' &&
                  change.kind !== 'removed' &&
                  (change.fromNumber === change.toNumber
                    ? change.toNumber
                    : `${change.fromNumber} → ${change.toNumber}`)}
              </span>
              {change.title && <span className="publish-change-title">{change.title}</span>}
            </div>
            {change.kind === 'reworded' || change.kind === 'retitled' ? (
              <>
                <p className="publish-before">{change.before || '(empty)'}</p>
                <p className="publish-after">{change.after || '(empty)'}</p>
              </>
            ) : (
              (change.after || change.before) && (
                <p className="publish-text">{change.after || change.before}</p>
              )
            )}
          </li>
        ))}
      </ol>

      <label className="rule-edit-label">
        What changed and why (shown in the version history)
        <textarea
          className="hub-input rule-edit-textarea"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Removed the consolation matchup, agreed by the league."
        />
      </label>

      {settingsToCheck > 0 && (
        <label className="publish-override">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
          />
          <span>
            {settingsToCheck === 1
              ? '1 rule names a number the app does not use'
              : `${settingsToCheck} rules name a number the app does not use`}
            . See the SETTINGS tab. Publish anyway.
          </span>
        </label>
      )}

      <p className="rule-edit-hint">
        Publishing freezes this exact book as a new revision that everyone reads. It cannot be
        edited afterwards; a correction means publishing again.
      </p>

      <div className="rule-edit-actions">
        <button
          type="button"
          className="rule-edit-save tap-btn"
          disabled={busy || dirty || (settingsToCheck > 0 && !override)}
          onClick={() => onPublish(fingerprint, notes)}
        >
          {busy ? 'PUBLISHING...' : 'PUBLISH'}
        </button>
        <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setOpen(false)}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

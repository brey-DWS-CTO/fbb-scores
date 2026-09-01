import { useState } from 'react';
import type { Identity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  signRulebook,
  type RulebookSignaturesResponse,
} from '../../lib/league/api.js';
import { describeSignatures, signatureStatus } from '../../lib/league/rulebookSignatures.js';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Who has signed the published revision, and the member's own signature.
 *
 * A signature belongs to one frozen revision. Publishing a new one wipes the
 * board, so this panel always reads the current version and says so. It prints
 * with the book, which is what makes a printed copy show its standing.
 */
export default function SignaturePanel({
  identity,
  data,
  /** True while the reader is looking at an older revision. */
  historical,
  onSigned,
}: {
  identity: Identity | null;
  data: RulebookSignaturesResponse | null;
  historical: boolean;
  onSigned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;

  const status = signatureStatus(data.members, data.signed, data.versionId);
  const mine = identity ? data.signed.find((s) => s.owner === identity.owner) : undefined;
  const isCurrent = data.versionId !== null && data.versionId === data.currentVersionId;
  const canSignNow =
    identity !== null && isCurrent && !historical && !mine && data.fingerprint !== null;

  const sign = async () => {
    if (!identity || !data.currentVersionId || !data.fingerprint) return;
    setBusy(true);
    setError(null);
    try {
      await signRulebook(identity, data.currentVersionId, data.fingerprint);
      onSigned();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel sign-block">
      <div className="sign-head">
        <span className="hub-heading sign-title">SIGNATURES</span>
        <span className="sign-count">{describeSignatures(status)}</span>
      </div>

      {!data.versionId && (
        <p className="sign-line">Nothing to sign yet.</p>
      )}

      {data.versionId && (
        <>
          <p className="sign-ack">&ldquo;{data.acknowledgement}&rdquo;</p>

          <div className="sign-lists">
            <div className="sign-column">
              <span className="sign-column-head">SIGNED</span>
              {status.signed.length === 0 ? (
                <span className="sign-none">Nobody yet</span>
              ) : (
                <ul className="sign-names">
                  {status.signed.map((signature) => (
                    <li key={signature.owner}>
                      <span className="sign-name">{signature.owner}</span>
                      <span className="sign-when">{formatDay(signature.signedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sign-column">
              <span className="sign-column-head">NOT SIGNED</span>
              {status.missing.length === 0 ? (
                <span className="sign-none">Nobody left</span>
              ) : (
                <ul className="sign-names">
                  {status.missing.map((owner) => (
                    <li key={owner}>
                      <span className="sign-name">{owner}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {mine && (
            <p className="sign-line sign-mine">
              You signed revision {mine.revision} on {formatDay(mine.signedAt)}.
            </p>
          )}

          {historical && (
            <p className="sign-line">
              These are the signatures on this old revision. Members sign the revision in force.
            </p>
          )}

          {!identity && !mine && (
            <p className="sign-line">Sign in from the home page to add your name.</p>
          )}

          {canSignNow && (
            <div className="sign-actions">
              <button type="button" className="rule-edit-save tap-btn" disabled={busy} onClick={sign}>
                {busy ? 'SIGNING...' : 'I AGREE, SIGN IT'}
              </button>
              <span className="rule-edit-hint">
                Your name and the time go on this revision. A new revision means signing again.
              </span>
            </div>
          )}

          {error && <p className="rules-draft-error">{error}</p>}
        </>
      )}
    </section>
  );
}

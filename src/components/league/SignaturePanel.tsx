import { useEffect, useState } from 'react';
import type { Identity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  fetchOwnerEmails,
  requestRulebookSignatures,
  signRulebook,
  withdrawRulebookSignature,
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

  // ── Sending the note (commissioner) ──
  const isCommish = identity?.isCommissioner === true;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addressed, setAddressed] = useState<Set<string> | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  useEffect(() => {
    if (!picking || !identity || !isCommish) return;
    let cancelled = false;
    fetchOwnerEmails(identity)
      .then((rows) => {
        if (!cancelled) setAddressed(new Set(rows.filter((r) => r.email !== '').map((r) => r.owner)));
      })
      .catch(() => {
        if (!cancelled) setAddressed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [picking, identity, isCommish]);

  // Nothing published means nothing to sign. The page already says so.
  if (!data || !data.versionId) return null;

  const status = signatureStatus(data.members, data.signed, data.versionId);
  const mine = identity ? data.signed.find((s) => s.owner === identity.owner) : undefined;
  const isCurrent = data.versionId !== null && data.versionId === data.currentVersionId;
  const canSignNow =
    identity !== null && isCurrent && !historical && !mine && data.fingerprint !== null;

  const openPicker = () => {
    // Start with everyone who has not signed. The commissioner trims from there.
    const unsigned = data.members.filter((o) => !data.signed.some((s) => s.owner === o));
    setPicked(new Set(unsigned));
    setSentNote(null);
    setPicking(true);
  };

  const togglePick = (owner: string) => {
    const next = new Set(picked);
    if (next.has(owner)) next.delete(owner);
    else next.add(owner);
    setPicked(next);
  };

  const sendRequest = async () => {
    if (!identity || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestRulebookSignatures(identity, [...picked]);
      const sent = result.sent.length ? `Sent to ${result.sent.join(', ')}.` : 'Nothing sent.';
      const missing = result.noAddress.length
        ? ` No address on file for ${result.noAddress.join(', ')}; add one on the Admin page.`
        : '';
      setSentNote(sent + missing);
      setPicking(false);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (owner: string) => {
    if (!identity) return;
    if (!window.confirm(`Withdraw ${owner}'s signature on revision ${data.revision}? They can sign again.`)) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawRulebookSignature(identity, owner);
      onSigned();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

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
                      {isCommish && isCurrent && !historical && (
                        <button
                          type="button"
                          className="sign-withdraw tap-btn"
                          disabled={busy}
                          onClick={() => withdraw(signature.owner)}
                          title="Withdraw this signature so they can sign again"
                        >
                          withdraw
                        </button>
                      )}
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

          {isCommish && isCurrent && !historical && !picking && (
            <div className="sign-actions sign-send">
              <button type="button" className="rules-tool tap-btn" disabled={busy} onClick={openPicker}>
                EMAIL A SIGN REQUEST
              </button>
              <span className="rule-edit-hint">
                Pick who gets the "read it, sign it" email. Try it on yourself first.
              </span>
            </div>
          )}

          {isCommish && picking && (
            <div className="sign-picker">
              <span className="sign-column-head">WHO GETS THE EMAIL</span>
              <ul className="sign-pick-list">
                {data.members.map((owner) => {
                  const signedAlready = data.signed.some((s) => s.owner === owner);
                  const hasAddress = addressed === null ? null : addressed.has(owner);
                  return (
                    <li key={owner}>
                      <label className="sign-pick">
                        <input
                          type="checkbox"
                          checked={picked.has(owner)}
                          onChange={() => togglePick(owner)}
                        />
                        <span className="sign-name">{owner}</span>
                        <span className="sign-when">
                          {signedAlready ? 'signed' : 'not signed'}
                          {hasAddress === false ? ' · no address' : ''}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="sign-actions">
                <button
                  type="button"
                  className="rule-edit-save tap-btn"
                  disabled={busy || picked.size === 0}
                  onClick={sendRequest}
                >
                  {busy ? 'SENDING...' : `SEND TO ${picked.size}`}
                </button>
                <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setPicking(false)}>
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {sentNote && <p className="rules-draft-note">{sentNote}</p>}
          {error && <p className="rules-draft-error">{error}</p>}
        </>
      )}
    </section>
  );
}

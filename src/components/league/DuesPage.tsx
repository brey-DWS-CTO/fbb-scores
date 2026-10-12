import { useCallback, useEffect, useState } from 'react';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  changeDues,
  fetchDues,
  saveDuesSettings,
  sendDuesShame,
  type DuesResponse,
} from '../../lib/league/api.js';
import {
  duesNote,
  formatDollars,
  shameList,
  venmoPayUrl,
  type DuesAction,
  type DuesLine,
  type DuesStatus,
} from '../../lib/league/dues.js';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const STATUS_LABEL: Record<DuesStatus, string> = {
  unpaid: 'NOT PAID',
  paid: 'SAYS PAID',
  verified: 'CONFIRMED',
};

/** What a commissioner can do to one team, in the order the buttons show. */
function commishActions(line: DuesLine, isCommish: boolean): Array<{ action: DuesAction; label: string }> {
  const actions: Array<{ action: DuesAction; label: string }> = [];
  if (line.status !== 'verified') actions.push({ action: 'verify', label: 'CONFIRM' });
  if (line.status === 'paid') actions.push({ action: 'unpaid', label: 'NOT RECEIVED' });
  if (line.status === 'verified') actions.push({ action: 'unverify', label: 'UNDO' });
  // The collector confirms money; only a commissioner sets the fee.
  if (isCommish) {
    actions.push(line.half ? { action: 'full', label: 'FULL FEE' } : { action: 'half', label: 'HALF FEE' });
  }
  return actions;
}

/**
 * League dues. Members pay on Venmo, tap I PAID, and a commissioner confirms
 * once they see it land. The app never sees Venmo itself.
 */
export default function DuesPage() {
  const { identity } = useIdentity();
  const [data, setData] = useState<DuesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [venmoDraft, setVenmoDraft] = useState('');
  const [payeeDraft, setPayeeDraft] = useState('');

  const show = useCallback((next: DuesResponse) => {
    setData(next);
    setVenmoDraft(next.venmo ? `@${next.venmo}` : '');
    setPayeeDraft(next.payee);
  }, []);

  useEffect(() => {
    fetchDues()
      .then(show)
      .catch((e) => setError(apiErrorMessage(e)));
  }, [show]);

  const act = async (run: () => Promise<DuesResponse>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      show(await run());
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const isCommish = identity?.isCommissioner === true;
  const isCollector = Boolean(identity && data?.payee && data.payee === identity.owner);
  const canConfirm = isCommish || isCollector;
  const mine = identity && data ? data.lines.find((l) => l.owner === identity.owner) : undefined;
  const collector = data?.payee || 'the commissioner';

  const shame = async () => {
    if (!identity || !data) return;
    const late = shameList(data);
    if (!window.confirm(`Email ${late.join(', ')} that they still owe?`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendDuesShame(identity);
      const sent = result.sent.length ? `Shamed ${result.sent.join(', ')}.` : 'Nothing sent.';
      const missing = result.noAddress.length
        ? ` No address on file for ${result.noAddress.join(', ')}.`
        : '';
      setNotice(sent + missing);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const change = (owner: string, action: DuesAction, ask?: string) => {
    if (!identity) return;
    if (ask && !window.confirm(ask)) return;
    void act(() => changeDues(identity, owner, action));
  };

  return (
    <main className="rules-page dues-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="star" size={18} className="icon-in-heading" />
            DUES
          </h1>
          <p>
            {data
              ? `${formatDollars(data.full)} a team for the ${data.season} season. Pay ${collector} on Venmo, then tap I PAID.`
              : 'Loading dues.'}
          </p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && notice && <p className="rules-draft-note">{notice}</p>}

      {data && mine && identity && (
        <section className="panel dues-mine">
          <span className="hub-heading dues-title">YOUR DUES</span>
          <div className="dues-amount">
            {formatDollars(mine.amount)}
            {mine.half && <span className="dues-half">HALF FEE</span>}
          </div>

          {mine.status === 'unpaid' && (
            <>
              <div className="dues-actions">
                {data.venmo ? (
                  <a
                    className="rule-edit-save tap-btn dues-venmo"
                    href={venmoPayUrl(data.venmo, mine.amount, duesNote(data.season, mine.owner))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PAY {formatDollars(mine.amount)} ON VENMO
                  </a>
                ) : (
                  <span className="rule-edit-hint">The Venmo link is not set yet.</span>
                )}
                <button
                  type="button"
                  className="rule-edit-save tap-btn"
                  disabled={busy}
                  onClick={() => change(mine.owner, 'paid')}
                >
                  I PAID
                </button>
              </div>
              <p className="rule-edit-hint">
                {data.venmo ? `Venmo @${data.venmo}. ` : ''}The app cannot see Venmo. Tap I PAID once
                you send it, and a commissioner confirms it when it lands.
              </p>
            </>
          )}

          {mine.status === 'paid' && mine.paidAt && (
            <>
              <p className="dues-line">
                You marked this paid on {formatDay(mine.paidAt)}. A commissioner will confirm it once
                they see it on Venmo.
              </p>
              <div className="dues-actions">
                <button
                  type="button"
                  className="rule-edit-cancel tap-btn"
                  disabled={busy}
                  onClick={() => change(mine.owner, 'unpaid', 'Take back I PAID?')}
                >
                  UNDO
                </button>
              </div>
            </>
          )}

          {mine.status === 'verified' && mine.verifiedAt && (
            <p className="dues-line dues-done">
              Paid. {mine.verifiedBy ?? 'A commissioner'} confirmed it on {formatDay(mine.verifiedAt)}.
            </p>
          )}
        </section>
      )}

      {data && !identity && (
        <p className="rule-edit-hint dues-signin">Sign in from the home page to mark yours paid.</p>
      )}

      {data && (
        <section className="panel dues-board">
          <div className="dues-head">
            <span className="hub-heading dues-title">THE LEAGUE</span>
            <span className="dues-count">
              {data.paid} of {data.lines.length} paid · {data.verified} confirmed ·{' '}
              {formatDollars(data.collected)} of {formatDollars(data.expected)} in
            </span>
          </div>
          <ul className="dues-list">
            {data.lines.map((line) => (
              <li key={line.owner} className="dues-row">
                <span className="dues-owner">{line.owner}</span>
                <span className="dues-owed">
                  {formatDollars(line.amount)}
                  {line.half && <span className="dues-half">HALF</span>}
                </span>
                <span className={`dues-status dues-status-${line.status}`}>
                  {STATUS_LABEL[line.status]}
                  {line.status === 'paid' && line.paidAt && ` ${formatDay(line.paidAt)}`}
                  {line.status === 'verified' && line.verifiedAt && ` ${formatDay(line.verifiedAt)}`}
                </span>
                {canConfirm && (
                  <span className="dues-row-actions">
                    {commishActions(line, isCommish).map(({ action, label }) => (
                      <button
                        key={action}
                        type="button"
                        className="rules-tool tap-btn dues-small"
                        disabled={busy}
                        onClick={() =>
                          change(
                            line.owner,
                            action,
                            action === 'unpaid'
                              ? `Mark ${line.owner} not paid? This clears their I PAID.`
                              : undefined,
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isCommish && (
            <div className="dues-actions">
              <button
                type="button"
                className="rule-edit-delete tap-btn"
                disabled={busy || shameList(data).length === 0}
                onClick={() => void shame()}
              >
                {shameList(data).length === 0
                  ? 'NOBODY TO SHAME'
                  : `SEND SHAME EMAIL (${shameList(data).length})`}
              </button>
            </div>
          )}
        </section>
      )}

      {data && isCommish && identity && (
        <section className="panel dues-settings">
          <span className="hub-heading dues-title">WHO COLLECTS</span>
          <label className="dues-field">
            <span>Member</span>
            <select value={payeeDraft} onChange={(e) => setPayeeDraft(e.target.value)}>
              <option value="">Nobody yet</option>
              {data.lines.map((line) => (
                <option key={line.owner} value={line.owner}>
                  {line.owner}
                </option>
              ))}
            </select>
          </label>
          <label className="dues-field">
            <span>Venmo</span>
            <input
              value={venmoDraft}
              onChange={(e) => setVenmoDraft(e.target.value)}
              placeholder="@name or venmo.com/u/name"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <div className="dues-actions">
            <button
              type="button"
              className="rule-edit-save tap-btn"
              disabled={busy}
              onClick={() => act(() => saveDuesSettings(identity, { venmo: venmoDraft, payee: payeeDraft }))}
            >
              SAVE
            </button>
          </div>
          <p className="rule-edit-hint">
            Only commissioners see this box. The member who collects also gets the CONFIRM buttons. Up to {data.halfMaxTeams} teams may pay
            the {formatDollars(data.half)} half fee.
          </p>
        </section>
      )}
    </main>
  );
}

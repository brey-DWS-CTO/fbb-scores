import { useCallback, useEffect, useState } from 'react';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import SignInPanel from './SignInPanel.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  createPropBet,
  fetchPropBets,
  removePropBet,
  settlePropBet,
  takePropSide,
  type PropBetsResponse,
} from '../../lib/league/api.js';
import {
  MAX_LINE,
  MAX_TEXT_LENGTH,
  MIN_LINE,
  canRemoveProp,
  canSettleProp,
  parsePropInput,
  parseResult,
  propLabel,
  propResult,
  propSentence,
  propsBySubject,
  sideOf,
  type PropBet,
  type PropSide,
} from '../../lib/league/propBets.js';

/**
 * Prop bets. Anyone sets an over/under on anyone else and anyone takes a side.
 * You never see the ones about you. Sides lock when the draft starts; whoever
 * set a prop, or the commissioner, enters the final count after.
 */
export default function PropBetsPage() {
  const { identity } = useIdentity();
  const [data, setData] = useState<PropBetsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [line, setLine] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  /** The prop whose final count is being typed, and the draft number. */
  const [settling, setSettling] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async () => {
    if (!identity) return;
    try {
      setData(await fetchPropBets(identity));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to see and set prop bets." />
      </main>
    );
  }

  const act = async (run: () => Promise<PropBetsResponse>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await run());
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(apiErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // You never pick yourself. The server refuses it too.
  const owners = (data?.owners ?? []).filter((o) => o !== identity.owner);
  const parsed = parsePropInput({ subject, text, line }, owners, [identity.owner]);
  const locked = data?.locked === true;

  const submit = async () => {
    setTried(true);
    if (!parsed.ok) return;
    const ok = await act(() => createPropBet(identity, parsed.input), `Up: ${propSentence(parsed.input)}.`);
    if (ok) {
      setSubject('');
      setLine('');
      setText('');
      setTried(false);
    }
  };

  const take = (prop: PropBet, side: PropSide) => {
    const current = sideOf(prop, identity.owner);
    void act(() => takePropSide(identity, prop.id, current === side ? null : side));
  };

  const remove = (prop: PropBet) => {
    if (!window.confirm(`Take down "${propSentence(prop)}"?`)) return;
    void act(() => removePropBet(identity, prop.id), 'Prop taken down.');
  };

  const saveResult = async (prop: PropBet, raw: string | null) => {
    const value = raw === null ? null : raw.trim();
    const check = parseResult(value);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (await act(() => settlePropBet(identity, prop.id, check.value))) setSettling(null);
  };

  const groups = data ? propsBySubject(data.props, data.owners) : [];

  return (
    <main className="rules-page props-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="target" size={18} className="icon-in-heading" />
            PROP BETS
          </h1>
          <p>Over/unders on anyone. Sides lock at the draft.</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && notice && <p className="rules-draft-note">{notice}</p>}

      {data && !locked && (
        <section className="panel props-form">
          <div className="props-fields">
            <label className="rule-edit-label props-who">
              Who?
              <select className="hub-input" value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Pick someone</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="rule-edit-label props-line">
              Over/under
              <input
                className="hub-input"
                type="number"
                inputMode="decimal"
                min={MIN_LINE}
                max={MAX_LINE}
                step={1}
                placeholder="1.5"
                value={line}
                onChange={(e) => setLine(e.target.value)}
              />
            </label>
            <label className="rule-edit-label props-what">
              What?
              <input
                className="hub-input"
                type="text"
                maxLength={MAX_TEXT_LENGTH}
                placeholder="times he asks about the rules"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          </div>
          {parsed.ok ? (
            <p className="props-preview">{propSentence(parsed.input)}</p>
          ) : (
            tried && <p className="rules-draft-error props-problem">{parsed.message}</p>
          )}
          <button type="button" className="rule-edit-save tap-btn props-add" disabled={busy} onClick={submit}>
            ADD PROP
          </button>
        </section>
      )}

      {locked && <div className="panel rules-empty">The draft has started. Props and sides are locked.</div>}
      {data && groups.length === 0 && <div className="panel rules-empty">No props yet. Set the first one.</div>}

      {groups.map((group) => (
        <section key={group.owner} className="props-group">
          <h2 className="hub-heading rules-article">{group.owner.toUpperCase()}</h2>
          <div className="vote-list">
            {group.props.map((prop) => {
              const mine = sideOf(prop, identity.owner);
              const overs = prop.takes.filter((t) => t.side === 'over').map((t) => t.owner);
              const unders = prop.takes.filter((t) => t.side === 'under').map((t) => t.owner);
              const won = propResult(prop);
              const canRemove = canRemoveProp(prop, identity.owner, identity.isCommissioner) && (!locked || identity.isCommissioner);
              const canSettle = canSettleProp(prop, identity.owner, identity.isCommissioner);
              const editing = settling?.id === prop.id ? settling : null;
              return (
                <article key={prop.id} className="panel vote-card props-card">
                  <div className="vote-head">
                    <span className="vote-meta">Set by {prop.createdBy}</span>
                    {won && <span className="hub-heading props-result">{won.toUpperCase()} HITS</span>}
                  </div>
                  <h3 className="vote-title">{propLabel(prop)}</h3>
                  {prop.result !== null && prop.result !== undefined && (
                    <p className="props-final">Final count: {prop.result}</p>
                  )}
                  <div className="vote-actions">
                    <button
                      type="button"
                      className={mine === 'over' ? 'vote-btn vote-btn-yes vote-btn-on tap-btn' : 'vote-btn vote-btn-yes tap-btn'}
                      disabled={busy || locked}
                      onClick={() => take(prop, 'over')}
                    >
                      OVER{overs.length > 0 ? ` · ${overs.length}` : ''}
                    </button>
                    <button
                      type="button"
                      className={mine === 'under' ? 'vote-btn vote-btn-no vote-btn-on tap-btn' : 'vote-btn vote-btn-no tap-btn'}
                      disabled={busy || locked}
                      onClick={() => take(prop, 'under')}
                    >
                      UNDER{unders.length > 0 ? ` · ${unders.length}` : ''}
                    </button>
                  </div>
                  {(overs.length > 0 || unders.length > 0) && (
                    <p className="vote-yours">
                      {overs.length > 0 && `Over: ${overs.join(', ')}. `}
                      {unders.length > 0 && `Under: ${unders.join(', ')}.`}
                    </p>
                  )}
                  {editing && (
                    <div className="props-settle">
                      <input
                        className="hub-input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        placeholder="Final count"
                        aria-label="Final count"
                        value={editing.value}
                        onChange={(e) => setSettling({ id: prop.id, value: e.target.value })}
                      />
                      <button type="button" className="rule-edit-save tap-btn" disabled={busy} onClick={() => saveResult(prop, editing.value)}>
                        SAVE
                      </button>
                      <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setSettling(null)}>
                        CANCEL
                      </button>
                    </div>
                  )}
                  {(canSettle || canRemove) && !editing && (
                    <div className="vote-actions vote-actions-close">
                      {canSettle && (
                        <button
                          type="button"
                          className="vote-close tap-btn"
                          disabled={busy}
                          onClick={() => setSettling({ id: prop.id, value: prop.result?.toString() ?? '' })}
                        >
                          {prop.result === null || prop.result === undefined ? 'ENTER RESULT' : 'CHANGE RESULT'}
                        </button>
                      )}
                      {canRemove && (
                        <button type="button" className="vote-close tap-btn" disabled={busy} onClick={() => remove(prop)}>
                          TAKE DOWN
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}

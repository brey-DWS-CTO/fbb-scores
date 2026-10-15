import { useCallback, useEffect, useState } from 'react';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  createPropBet,
  fetchPropBets,
  removePropBet,
  takePropSide,
  type PropBetsResponse,
} from '../../lib/league/api.js';
import {
  MAX_CUSTOM_LENGTH,
  MAX_LINE,
  MIN_LINE,
  NBA_TEAMS,
  POSITION_NAMES,
  PROP_POSITIONS,
  canRemoveProp,
  parsePropInput,
  propLabel,
  propsBySubject,
  sideOf,
  type PropBet,
  type PropKind,
  type PropSide,
} from '../../lib/league/propBets.js';

const KIND_LABEL: Record<PropKind, string> = {
  team: 'An NBA team',
  position: 'A position',
  custom: 'Something else',
};

/**
 * Prop bets on the draft. Anyone sets a line on anyone's draft and anyone
 * takes a side. Everything locks when the draft starts.
 */
export default function PropBetsPage() {
  const { identity } = useIdentity();
  const [data, setData] = useState<PropBetsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [line, setLine] = useState('1.5');
  const [kind, setKind] = useState<PropKind>('team');
  const [team, setTeam] = useState('');
  const [position, setPosition] = useState('');
  const [words, setWords] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchPropBets());
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (run: () => Promise<PropBetsResponse>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await run());
      if (done) setNotice(done);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const owners = data?.owners ?? [];
  const target = kind === 'team' ? team : kind === 'position' ? position : words;
  const draft = { subject, kind, target, line: Number(line) };
  const parsed = parsePropInput(draft, owners);
  const locked = data?.locked === true;

  const submit = () => {
    if (!identity || !parsed.ok) return;
    void act(async () => {
      const next = await createPropBet(identity, parsed.input);
      setSubject('');
      setWords('');
      return next;
    }, `Up: ${propLabel(parsed.input)}.`);
  };

  const take = (prop: PropBet, side: PropSide) => {
    if (!identity) return;
    const current = sideOf(prop, identity.owner);
    void act(() => takePropSide(identity, prop.id, current === side ? null : side));
  };

  const remove = (prop: PropBet) => {
    if (!identity) return;
    if (!window.confirm(`Take down "${propLabel(prop)}"?`)) return;
    void act(() => removePropBet(identity, prop.id), 'Prop taken down.');
  };

  const groups = data ? propsBySubject(data.props, owners) : [];

  return (
    <main className="rules-page props-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="target" size={18} className="icon-in-heading" />
            PROP BETS
          </h1>
          <p>
            Set a line on anyone's draft, then take the over or the under. Lines end in .5, so nothing
            pushes. Keepers count. Everything locks when the draft starts.
          </p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && notice && <p className="rules-draft-note">{notice}</p>}

      {data && !locked && identity && (
        <section className="panel rule-edit-form props-form">
          <span className="hub-heading achieve-title">SET A PROP</span>
          <div className="props-fields">
            <label className="rule-edit-label">
              Whose draft?
              <select className="hub-input" value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">Pick a team</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="rule-edit-label">
              Over or under
              <input
                className="hub-input"
                type="number"
                inputMode="decimal"
                min={MIN_LINE}
                max={MAX_LINE}
                step={1}
                value={line}
                onChange={(e) => setLine(e.target.value)}
              />
            </label>
            <label className="rule-edit-label">
              What counts?
              <select className="hub-input" value={kind} onChange={(e) => setKind(e.target.value as PropKind)}>
                {(Object.keys(KIND_LABEL) as PropKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            {kind === 'team' && (
              <label className="rule-edit-label">
                NBA team
                <select className="hub-input" value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">Pick a team</option>
                  {[...NBA_TEAMS]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {kind === 'position' && (
              <label className="rule-edit-label">
                Position
                <select className="hub-input" value={position} onChange={(e) => setPosition(e.target.value)}>
                  <option value="">Pick a position</option>
                  {PROP_POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}, {POSITION_NAMES[p]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'custom' && (
              <label className="rule-edit-label">
                Count what?
                <input
                  className="hub-input"
                  type="text"
                  maxLength={MAX_CUSTOM_LENGTH}
                  placeholder="rookies"
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                />
              </label>
            )}
          </div>
          <p className="props-preview">
            {parsed.ok ? propLabel(parsed.input) : parsed.message}
          </p>
          {kind === 'custom' && (
            <p className="rule-edit-hint">The app cannot count these. The league settles them after the draft.</p>
          )}
          <div className="rule-edit-actions">
            <button type="button" className="rule-edit-save tap-btn" disabled={busy || !parsed.ok} onClick={submit}>
              ADD PROP
            </button>
          </div>
        </section>
      )}

      {data && !locked && !identity && (
        <div className="panel rules-empty">Sign in to set a prop or take a side.</div>
      )}
      {locked && (
        <div className="panel rules-empty">
          {data?.draftDone ? 'The draft is done. Here is how every prop landed.' : 'The draft is on. Props are locked and count up live.'}
        </div>
      )}

      {data && groups.length === 0 && <div className="panel rules-empty">No props yet. Set the first one.</div>}

      {groups.map((group) => (
        <section key={group.owner} className="props-group">
          <h2 className="hub-heading rules-article">{group.owner.toUpperCase()}'S DRAFT</h2>
          <div className="vote-list">
            {group.props.map((prop) => {
              const mine = identity ? sideOf(prop, identity.owner) : null;
              const overs = prop.takes.filter((t) => t.side === 'over').map((t) => t.owner);
              const unders = prop.takes.filter((t) => t.side === 'under').map((t) => t.owner);
              const tally = data?.tallies[prop.id];
              const canRemove =
                identity !== null && canRemoveProp(prop, identity.owner, identity.isCommissioner) && (!locked || identity.isCommissioner);
              return (
                <article key={prop.id} className="panel vote-card props-card">
                  <div className="vote-head">
                    <span className="vote-meta">Set by {prop.createdBy}</span>
                    {tally?.result && (
                      <span className="hub-heading props-result">{tally.result.toUpperCase()} HITS</span>
                    )}
                  </div>
                  <h3 className="vote-title">{propLabel(prop)}</h3>
                  {locked && tally && (
                    <p className="vote-yours">
                      {tally.count === null ? 'The league settles this one.' : `Drafted so far: ${tally.count}.`}
                    </p>
                  )}
                  <div className="vote-actions">
                    <button
                      type="button"
                      className={mine === 'over' ? 'vote-btn vote-btn-yes vote-btn-on tap-btn' : 'vote-btn vote-btn-yes tap-btn'}
                      disabled={busy || locked || !identity}
                      onClick={() => take(prop, 'over')}
                    >
                      OVER {overs.length > 0 ? `· ${overs.length}` : ''}
                    </button>
                    <button
                      type="button"
                      className={mine === 'under' ? 'vote-btn vote-btn-no vote-btn-on tap-btn' : 'vote-btn vote-btn-no tap-btn'}
                      disabled={busy || locked || !identity}
                      onClick={() => take(prop, 'under')}
                    >
                      UNDER {unders.length > 0 ? `· ${unders.length}` : ''}
                    </button>
                  </div>
                  {(overs.length > 0 || unders.length > 0) && (
                    <p className="vote-yours">
                      {overs.length > 0 && `Over: ${overs.join(', ')}. `}
                      {unders.length > 0 && `Under: ${unders.join(', ')}.`}
                    </p>
                  )}
                  {!locked && mine && <p className="vote-yours">You took the {mine}. Tap it again to step off.</p>}
                  {canRemove && (
                    <div className="vote-actions vote-actions-close">
                      <button type="button" className="vote-close tap-btn" disabled={busy} onClick={() => remove(prop)}>
                        TAKE DOWN
                      </button>
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

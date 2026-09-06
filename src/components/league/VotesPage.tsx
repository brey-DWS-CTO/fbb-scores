import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import RulePicker from './RulePicker.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  amendFromPoll,
  apiErrorMessage,
  castPollVote,
  closePollById,
  editPollById,
  fetchPolls,
  openPoll,
  type PollsResponse,
  fetchPublishedRulebook,
} from '../../lib/league/api.js';
import {
  describePollEdit,
  describeTally,
  editResetsVotes,
  pollEditChanges,
  pollKindLabel,
  tallyPoll,
  voteOf,
  type Poll,
  type PollKind,
} from '../../lib/league/polls.js';
import {
  anchorFor,
  buildRulebookIndex,
  type RulebookIndex,
} from '../../lib/league/rulebook.js';
import { rulebookIndex2027 } from '../../lib/league/rulebookData.js';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** How close a vote is to the yes count it needs. */
function Tally({ poll }: { poll: Poll }) {
  const tally = tallyPoll(poll);
  const pct = Math.min(100, Math.round((tally.yes / Math.max(1, tally.needed)) * 100));
  return (
    <div className="vote-tally">
      <div className="vote-bar" aria-hidden="true">
        <div
          className={tally.passed ? 'vote-bar-fill vote-bar-pass' : 'vote-bar-fill'}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="vote-counts">
        <span className="vote-yes">{tally.yes} yes</span>
        <span className="vote-no">{tally.no} no</span>
        <span className="vote-silent">{tally.notVoted} silent</span>
        <span className="vote-needed">{describeTally(poll)}</span>
      </div>
    </div>
  );
}

/**
 * The commissioner's rewrite of an open vote.
 *
 * It warns before it clears anything: changing the title or the rules makes
 * every vote already cast an answer to a different question.
 */
function PollEditForm({
  poll,
  busy,
  index,
  onSave,
  onCancel,
}: {
  poll: Poll;
  busy: boolean;
  index: RulebookIndex;
  onSave: (input: { title: string; detail: string; affects: string[] }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(poll.title);
  const [detail, setDetail] = useState(poll.detail);
  const [affects, setAffects] = useState<string[]>(poll.affects);
  const kind = poll.kind ?? 'change';

  const changed = pollEditChanges(poll, { title, detail, affects, threshold: poll.threshold });
  const clears = editResetsVotes(changed) && poll.votes.length > 0;
  const blocked = !title.trim() || (kind === 'change' && affects.length === 0);

  return (
    <div className="rule-edit-form vote-edit-form">
      <label className="rule-edit-label">
        What are you proposing?
        <input
          className="hub-input rule-edit-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="rule-edit-label">
        Why
        <textarea
          className="hub-input rule-edit-textarea"
          rows={4}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
        />
      </label>

      <RulePicker
        index={index}
        selected={affects}
        onChange={setAffects}
        label={kind === 'change' ? 'Which rule would change?' : 'Where should it sit? (optional)'}
        hint="Everyone voting sees exactly which rules this touches."
        max={kind === 'new-rule' ? 1 : undefined}
      />

      <p className={clears ? 'rule-edit-hint vote-edit-warn' : 'rule-edit-hint'}>
        {clears
          ? `This changes what the vote asks, so the ${poll.votes.length} votes already cast get cleared.`
          : 'Changing the title or the rules clears the votes already cast. Changing the why does not.'}
      </p>

      <div className="rule-edit-actions">
        <button
          type="button"
          className="rule-edit-save tap-btn"
          disabled={busy || blocked || changed.length === 0}
          onClick={() => onSave({ title, detail, affects })}
        >
          {busy ? 'SAVING...' : 'SAVE THE VOTE'}
        </button>
        <button type="button" className="rule-edit-cancel tap-btn" onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

function PollCard({
  poll,
  owner,
  isCommish,
  busy,
  index,
  editing,
  onVote,
  onClose,
  onAmend,
  onEdit,
  onEditSave,
  onEditCancel,
}: {
  poll: Poll;
  owner: string;
  isCommish: boolean;
  busy: boolean;
  /** Built from the published book, so rule numbers match what members read. */
  index: RulebookIndex;
  editing: boolean;
  onVote: (poll: Poll, choice: 'yes' | 'no') => void;
  onClose: (poll: Poll, cancel: boolean) => void;
  onAmend: (poll: Poll) => void;
  onEdit: (poll: Poll) => void;
  onEditSave: (poll: Poll, input: { title: string; detail: string; affects: string[] }) => void;
  onEditCancel: () => void;
}) {
  const mine = voteOf(poll, owner);
  const open = poll.status === 'open';
  const canClose = open && (poll.proposedBy === owner || isCommish);
  const kind = poll.kind ?? 'change';
  const edits = poll.edits ?? [];

  return (
    <article className={`panel vote-card vote-${poll.status}`}>
      <div className="vote-head">
        <span className="hub-heading vote-status">{poll.status.toUpperCase()}</span>
        <span className="vote-meta">
          {poll.proposedBy} · {formatDate(poll.openedAt)} · needs {poll.threshold}%
        </span>
      </div>
      <span className={kind === 'new-rule' ? 'vote-kind vote-kind-new' : 'vote-kind'}>
        {pollKindLabel(kind)}
      </span>

      {editing ? (
        <PollEditForm
          poll={poll}
          busy={busy}
          index={index}
          onSave={(input) => onEditSave(poll, input)}
          onCancel={onEditCancel}
        />
      ) : (
        <>
          <h3 className="vote-title">{poll.title}</h3>
          {poll.detail && <p className="vote-detail">{poll.detail}</p>}

          {poll.affects.length > 0 && (
            <p className="vote-affects">
              {kind === 'new-rule' ? 'Goes near ' : 'Changes '}
              {poll.affects.map((id, i) => {
                const entry = index.byId.get(id);
                return (
                  <span key={id}>
                    {i > 0 && ', '}
                    <Link to={`/rules#${anchorFor(id)}`}>{entry ? entry.number : id}</Link>
                  </span>
                );
              })}
            </p>
          )}

          {/* An edit is never silent. A member who voted on the old wording
              has to see that it moved, and what moved. */}
          {edits.length > 0 && (
            <ul className="vote-edits">
              {edits.map((edit, i) => (
                <li key={`${edit.at}-${String(i)}`}>
                  {formatDate(edit.at)}: {describePollEdit(edit)}
                </li>
              ))}
            </ul>
          )}

          <Tally poll={poll} />

          {open && (
            <div className="vote-actions">
              <button
                type="button"
                className={mine === 'yes' ? 'vote-btn vote-btn-yes vote-btn-on tap-btn' : 'vote-btn vote-btn-yes tap-btn'}
                disabled={busy}
                onClick={() => onVote(poll, 'yes')}
              >
                YES
              </button>
              <button
                type="button"
                className={mine === 'no' ? 'vote-btn vote-btn-no vote-btn-on tap-btn' : 'vote-btn vote-btn-no tap-btn'}
                disabled={busy}
                onClick={() => onVote(poll, 'no')}
              >
                NO
              </button>
            </div>
          )}

          {open && mine && <p className="vote-yours">You voted {mine}. You can change it until it closes.</p>}
          {open && !mine && <p className="vote-yours">You have not voted. Silence counts as no.</p>}

          {canClose && (
            <div className="vote-actions vote-actions-close">
              <button type="button" className="vote-close tap-btn" disabled={busy} onClick={() => onClose(poll, false)}>
                CLOSE &amp; COUNT
              </button>
              <button type="button" className="vote-close tap-btn" disabled={busy} onClick={() => onClose(poll, true)}>
                CANCEL VOTE
              </button>
            </div>
          )}

          {/* Only the commissioner, and only while it is open. Members never
              edit a vote, not even their own. */}
          {open && isCommish && (
            <div className="vote-actions vote-actions-close">
              <button
                type="button"
                className="vote-close tap-btn"
                disabled={busy}
                onClick={() => onEdit(poll)}
              >
                EDIT THIS VOTE
              </button>
            </div>
          )}

          {!open && poll.closedBy && (
            <p className="vote-yours">
              Closed by {poll.closedBy}
              {poll.closedAt ? ` on ${formatDate(poll.closedAt)}` : ''}.
            </p>
          )}

          {/* A passed vote is a mandate. It reaches the book only when the
              commissioner writes it into the draft and publishes. */}
          {poll.status === 'passed' && (
            <div className="vote-amend">
              {poll.appliedRevision !== undefined ? (
                <p className="vote-yours">In the book since revision {poll.appliedRevision}.</p>
              ) : poll.seededAt ? (
                <p className="vote-yours">
                  In the commissioner's draft since {formatDate(poll.seededAt)}, waiting to be
                  published.
                </p>
              ) : (
                <p className="vote-yours">Waiting for the commissioner to write it into the book.</p>
              )}
              {isCommish && !poll.seededAt && (
                <button
                  type="button"
                  className="rule-edit-save tap-btn"
                  disabled={busy}
                  onClick={() => onAmend(poll)}
                >
                  START THE AMENDMENT
                </button>
              )}
              {isCommish && poll.seededAt && poll.appliedRevision === undefined && (
                <Link className="vote-close tap-btn" to="/rules">
                  OPEN THE DRAFT
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** /votes — league votes. Every member gets one to start each season. */
export default function VotesPage() {
  const { identity } = useIdentity();
  const [data, setData] = useState<PollsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  /** Which open vote the commissioner is rewriting, if any. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<PollKind | null>(null);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [affects, setAffects] = useState<string[]>([]);
  const [index, setIndex] = useState<RulebookIndex>(rulebookIndex2027);
  const [searchParams, setSearchParams] = useSearchParams();

  // Rule numbers must match the book members actually read.
  useEffect(() => {
    let cancelled = false;
    fetchPublishedRulebook()
      .then((latest) => {
        if (!cancelled) setIndex(buildRulebookIndex(latest.book));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    if (!identity) return;
    try {
      setData(await fetchPolls(identity));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  // Arriving from a rule on /rules: the composer opens already set to a change
  // of that rule, so the member never types an id.
  const askedKind = searchParams.get('kind');
  const askedRule = searchParams.get('rule');
  useEffect(() => {
    if (askedKind !== 'change' && askedKind !== 'new-rule') return;
    setComposing(true);
    setKind(askedKind);
    if (askedRule) setAffects([askedRule]);
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [askedKind, askedRule, setSearchParams]);

  if (!identity) {
    return (
      <main className="rules-page">
        <div className="panel rules-status">
          <span className="hub-heading">SIGN IN</span>
          <p>Sign in from the home page to see and cast league votes.</p>
        </div>
      </main>
    );
  }

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const closeComposer = () => {
    setComposing(false);
    setKind(null);
    setTitle('');
    setDetail('');
    setAffects([]);
  };

  const submit = () =>
    act(async () => {
      if (!kind) return;
      await openPoll(identity, { kind, title, detail, affects });
      closeComposer();
    });

  const saveEdit = (poll: Poll, input: { title: string; detail: string; affects: string[] }) =>
    act(async () => {
      const updated = await editPollById(identity, poll.id, input);
      setEditingId(null);
      const last = updated.edits?.[updated.edits.length - 1];
      setNotice(last ? describePollEdit(last) : 'The vote was saved.');
    });

  const amend = (poll: Poll) =>
    act(async () => {
      const result = await amendFromPoll(identity, poll.id);
      setNotice(`${result.note} Open the rule book to write it and publish.`);
    });

  const polls = data?.polls ?? [];
  // Any open poll knows its own roll and threshold; fall back to the usual 60%.
  const sample = polls.find((p) => p.status === 'open') ?? polls[0];
  const thresholdLine = sample
    ? `A change needs ${tallyPoll(sample).needed} of the ${sample.eligibleVoters.length} teams. Not voting counts as no.`
    : 'A change needs 60% of all teams. Not voting counts as no.';
  const open = polls.filter((p) => p.status === 'open');
  const done = polls.filter((p) => p.status !== 'open');

  return (
    <main className="rules-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-purple">
            <NavIcon name="ballot" size={18} className="icon-in-heading" />
            VOTES
          </h1>
          <p>{thresholdLine}</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && notice && <p className="rules-draft-note">{notice}</p>}

      {!composing && (
        <button
          type="button"
          className="rules-tool vote-start tap-btn"
          disabled={busy || !data?.you.canLaunch}
          onClick={() => setComposing(true)}
        >
          {!data?.you.canLaunch
            ? 'YOU HAVE USED YOUR VOTE THIS SEASON'
            : identity.isCommissioner
              ? '+ START A VOTE'
              : '+ START YOUR VOTE'}
        </button>
      )}

      {composing && (
        <div className="rule-edit-form">
          <span className="rule-edit-label">What kind of vote is this?</span>
          <div className="vote-kind-picker">
            <button
              type="button"
              className={kind === 'change' ? 'vote-kind-btn vote-kind-on tap-btn' : 'vote-kind-btn tap-btn'}
              aria-pressed={kind === 'change'}
              onClick={() => setKind('change')}
            >
              CHANGE A RULE
            </button>
            <button
              type="button"
              className={kind === 'new-rule' ? 'vote-kind-btn vote-kind-on tap-btn' : 'vote-kind-btn tap-btn'}
              aria-pressed={kind === 'new-rule'}
              onClick={() => setKind('new-rule')}
            >
              ADD A NEW RULE
            </button>
          </div>

          {kind && (
            <>
              <label className="rule-edit-label">
                What are you proposing?
                <input
                  className="hub-input rule-edit-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === 'change' ? 'Expand IR to two slots' : 'Add a trade deadline'}
                />
              </label>
              <label className="rule-edit-label">
                Why
                <textarea
                  className="hub-input rule-edit-textarea"
                  rows={4}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Make the case in a sentence or two."
                />
              </label>

              <RulePicker
                index={index}
                selected={affects}
                onChange={setAffects}
                label={kind === 'change' ? 'Which rule would change?' : 'Where should it sit? (optional)'}
                hint={
                  kind === 'change'
                    // Reads as an unmet requirement if it says "pick at least
                    // one" while one is already picked, which it usually is
                    // when the vote started from a rule.
                    ? affects.length === 0
                      ? 'Pick the rule this would change.'
                      : 'Everyone voting sees exactly which rules this touches.'
                    : 'Naming a rule tells the commissioner where the new one goes.'
                }
                max={kind === 'new-rule' ? 1 : undefined}
              />
            </>
          )}

          <p className="rule-edit-hint">
            {identity.isCommissioner
              ? 'As commissioner you can start as many votes as the league needs.'
              : 'One vote each per season. Cancelling gives it back.'}
          </p>
          <div className="rule-edit-actions">
            <button
              type="button"
              className="rule-edit-save tap-btn"
              disabled={
                busy || !kind || !title.trim() || (kind === 'change' && affects.length === 0)
              }
              onClick={submit}
            >
              {busy ? 'STARTING...' : 'START THE VOTE'}
            </button>
            <button type="button" className="rule-edit-cancel tap-btn" onClick={closeComposer}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      <div className="vote-list">
        {open.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            owner={identity.owner}
            isCommish={identity.isCommissioner}
            busy={busy}
            index={index}
            editing={editingId === poll.id}
            onVote={(p, choice) => act(() => castPollVote(identity, p.id, choice))}
            onClose={(p, cancel) => act(() => closePollById(identity, p.id, cancel))}
            onAmend={amend}
            onEdit={(p) => setEditingId(p.id)}
            onEditSave={saveEdit}
            onEditCancel={() => setEditingId(null)}
          />
        ))}
        {open.length === 0 && !composing && (
          <div className="panel rules-empty">Nothing is being voted on right now.</div>
        )}

        {done.length > 0 && (
          <>
            <h2 className="hub-heading rules-article vote-done-heading">SETTLED</h2>
            {done.map((poll) => (
              <PollCard
                key={poll.id}
                poll={poll}
                owner={identity.owner}
                isCommish={identity.isCommissioner}
                busy={busy}
                index={index}
                editing={false}
                onVote={() => undefined}
                onClose={() => undefined}
                onAmend={amend}
                onEdit={() => undefined}
                onEditSave={() => undefined}
                onEditCancel={() => undefined}
              />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

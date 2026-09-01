import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  castPollVote,
  closePollById,
  fetchPolls,
  openPoll,
  type PollsResponse,
  fetchPublishedRulebook,
} from '../../lib/league/api.js';
import { describeTally, tallyPoll, voteOf, type Poll } from '../../lib/league/polls.js';
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

function PollCard({
  poll,
  owner,
  isCommish,
  busy,
  index,
  onVote,
  onClose,
}: {
  poll: Poll;
  owner: string;
  isCommish: boolean;
  busy: boolean;
  /** Built from the published book, so rule numbers match what members read. */
  index: RulebookIndex;
  onVote: (poll: Poll, choice: 'yes' | 'no') => void;
  onClose: (poll: Poll, cancel: boolean) => void;
}) {
  const mine = voteOf(poll, owner);
  const open = poll.status === 'open';
  const canClose = open && (poll.proposedBy === owner || isCommish);

  return (
    <article className={`panel vote-card vote-${poll.status}`}>
      <div className="vote-head">
        <span className="hub-heading vote-status">{poll.status.toUpperCase()}</span>
        <span className="vote-meta">
          {poll.proposedBy} · {formatDate(poll.openedAt)} · needs {poll.threshold}%
        </span>
      </div>
      <h3 className="vote-title">{poll.title}</h3>
      {poll.detail && <p className="vote-detail">{poll.detail}</p>}

      {poll.affects.length > 0 && (
        <p className="vote-affects">
          Changes{' '}
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

      {!open && poll.closedBy && (
        <p className="vote-yours">
          Closed by {poll.closedBy}
          {poll.closedAt ? ` on ${formatDate(poll.closedAt)}` : ''}.
        </p>
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
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [affects, setAffects] = useState('');
  const [index, setIndex] = useState<RulebookIndex>(rulebookIndex2027);

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
    try {
      await run();
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    act(async () => {
      await openPoll(identity, {
        title,
        detail,
        affects: affects
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setComposing(false);
      setTitle('');
      setDetail('');
      setAffects('');
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
          <h1 className="hub-heading glow-purple">🗳 VOTES</h1>
          <p>{thresholdLine}</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}

      {!composing && (
        <button
          type="button"
          className="rules-tool vote-start tap-btn"
          disabled={busy || !data?.you.canLaunch}
          onClick={() => setComposing(true)}
        >
          {data?.you.canLaunch ? '+ START YOUR VOTE' : 'YOU HAVE USED YOUR VOTE THIS SEASON'}
        </button>
      )}

      {composing && (
        <div className="rule-edit-form">
          <label className="rule-edit-label">
            What are you proposing?
            <input
              className="hub-input rule-edit-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Expand IR to two slots"
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
          <label className="rule-edit-label">
            Rules it would change (optional)
            <input
              className="hub-input rule-edit-input"
              value={affects}
              onChange={(e) => setAffects(e.target.value)}
              placeholder="rosters.size, format.size"
            />
          </label>
          <p className="rule-edit-hint">
            You get one vote to start each season. Cancelling gives it back. Nothing can start
            once the draft begins.
          </p>
          <div className="rule-edit-actions">
            <button type="button" className="rule-edit-save tap-btn" disabled={busy || !title.trim()} onClick={submit}>
              {busy ? 'STARTING...' : 'START THE VOTE'}
            </button>
            <button type="button" className="rule-edit-cancel tap-btn" onClick={() => setComposing(false)}>
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
            onVote={(p, choice) => act(() => castPollVote(identity, p.id, choice))}
            onClose={(p, cancel) => act(() => closePollById(identity, p.id, cancel))}
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
                onVote={() => undefined}
                onClose={() => undefined}
              />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

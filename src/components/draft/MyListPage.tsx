import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import IdentityChip from '../league/IdentityChip.js';
import NavIcon from '../league/NavIcon.js';
import SignInPanel from '../league/SignInPanel.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { apiErrorMessage, clearDraftList, fetchDraftList, saveDraftList } from '../../lib/league/api.js';
import { DRAFT_LIST_MAX, listToText, parseListText, type DraftList } from '../../lib/league/autoDraft.js';

/**
 * A member's private list for the draft: names, best first, one a line. If
 * they cannot be there and the commish puts their team on auto, each pick
 * takes the top name still available. Nobody else ever sees the list, the
 * commish included.
 */
export default function MyListPage() {
  const { identity } = useIdentity();
  const { state } = useLeagueData();
  const [saved, setSaved] = useState<DraftList | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const load = useCallback(async () => {
    if (!identity) return;
    try {
      const response = await fetchDraftList(identity);
      setSaved(response.list);
      setText(listToText(response.list));
      setLoaded(true);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  const typed = useMemo(() => parseListText(text), [text]);

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to keep a draft list." />
      </main>
    );
  }

  const dirty = loaded && text.trim() !== listToText(saved).trim();
  const unmatched = saved?.entries.filter((entry) => !entry.playerKey) ?? [];
  const matched = (saved?.entries.length ?? 0) - unmatched.length;
  const draftOn = state.draft.startedAt !== null && !state.draft.closedAt;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await saveDraftList(identity, text);
      setSaved(response.list);
      setText(listToText(response.list));
      const missing = response.list?.entries.filter((entry) => !entry.playerKey).length ?? 0;
      setNotice(response.list
        ? `Saved. ${response.list.entries.length} name${response.list.entries.length === 1 ? '' : 's'}${missing ? `, ${missing} not in the pool` : ''}.`
        : 'Your list is empty.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setArmed(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await clearDraftList(identity);
      setSaved(response.list);
      setText('');
      setNotice('List cleared.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="rules-page my-list-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-teal">
            <NavIcon name="ballot" size={18} className="icon-in-heading" />
            MY LIST
          </h1>
          <p>Your picks if you cannot be there. Nobody else sees it, the commish included.</p>
        </div>
        <IdentityChip />
      </header>

      <section className="panel my-list-how">
        <p>
          Type or paste player names, best first, one a line. Numbers are fine.
          If you miss the draft and the commish puts your team on auto, each of your
          picks takes the top name on this list still available. When the list runs
          out, you get the best player left on the board.
        </p>
        <p className="my-list-dim">
          Keepers are already yours. Players kept by other teams are skipped. Up to {DRAFT_LIST_MAX} names.
          {draftOn ? ' The draft is on: a save takes effect from your next pick.' : ''}
        </p>
      </section>

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && notice && <p className="rules-draft-note">{notice}</p>}

      <section className="panel my-list-form">
        <label className="rule-edit-label" htmlFor="my-list-text">
          Names, best first
          <textarea
            id="my-list-text"
            className="hub-input rule-edit-textarea my-list-text"
            rows={14}
            spellCheck={false}
            placeholder={'1. Nikola Jokic\n2. Luka Doncic\n3. Victor Wembanyama'}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={!loaded && !error}
          />
        </label>
        <div className="my-list-count">
          {typed.length} name{typed.length === 1 ? '' : 's'} typed
          {saved && !dirty ? ` · ${matched} matched to the pool` : ''}
        </div>
        <div className="my-list-actions">
          <button type="button" className="vote-btn my-list-save" disabled={busy || !loaded || !dirty} onClick={save}>
            {busy ? 'SAVING…' : 'SAVE LIST'}
          </button>
          {saved && (
            <button
              type="button"
              className={`vote-btn my-list-clear${armed ? ' is-armed' : ''}`}
              disabled={busy}
              onClick={armed ? clear : () => setArmed(true)}
            >
              {armed ? 'CLEAR IT?' : 'CLEAR'}
            </button>
          )}
        </div>
      </section>

      {saved && unmatched.length > 0 && (
        <section className="panel my-list-missing">
          <div className="hub-heading">NOT IN THE POOL · {unmatched.length}</div>
          <p>These names did not match a player. Check the spelling, or leave them: they are skipped on draft day.</p>
          <ul>
            {unmatched.map((entry) => <li key={entry.rank}>{entry.rank}. {entry.name}</li>)}
          </ul>
        </section>
      )}

      {saved && (
        <section className="panel my-list-saved">
          <div className="hub-heading">SAVED · {saved.entries.length}</div>
          <ol>
            {saved.entries.map((entry) => (
              <li key={entry.rank} className={entry.playerKey ? '' : 'is-missing'}>
                <span className="my-list-rank">{entry.rank}</span>
                <span className="my-list-name">{entry.playerName ?? entry.name}</span>
                {entry.playerName && entry.playerName.toLowerCase() !== entry.name.toLowerCase() && (
                  <small>typed “{entry.name}”</small>
                )}
                {!entry.playerKey && <small>not in the pool</small>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="mock-note mock-note-dim">
        Want to see the board? <Link to="/draft">Open the live draft</Link>.
      </p>
    </main>
  );
}

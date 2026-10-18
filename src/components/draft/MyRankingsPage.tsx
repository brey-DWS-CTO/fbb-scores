import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import IdentityChip from '../league/IdentityChip.js';
import NavIcon from '../league/NavIcon.js';
import SignInPanel from '../league/SignInPanel.js';
import { useDraftData, useIdentity } from '../../hooks/useLeague.js';
import { availablePlayers } from '../../lib/keeper/engine.js';
import { RANKINGS_FILE_ACCEPT, readRankingsFile } from '../../lib/league/rankingsFile.js';
import { apiErrorMessage, clearDraftList, fetchDraftList, saveDraftList } from '../../lib/league/api.js';
import { DRAFT_LIST_MAX, listToText, parseListText, type DraftList } from '../../lib/league/autoDraft.js';

/**
 * A member's private rankings for the draft: names, best first, one a line.
 * If they cannot be there and the commish puts their team on auto, each pick
 * takes the top name still available. Nobody else ever sees the rankings,
 * the commish included.
 */
export default function MyRankingsPage() {
  const { identity } = useIdentity();
  const { state, dataset } = useDraftData();
  const fileInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<DraftList | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [dragging, setDragging] = useState(false);

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
  const draftOn = state.draft.startedAt !== null && !state.draft.closedAt;
  // How many of their names are still on the board. Theirs to see, nobody else's.
  const stillThere = useMemo(() => {
    if (!draftOn || !saved) return null;
    const open = new Set(availablePlayers(dataset, state).map((player) => player.key));
    return saved.entries.filter((entry) => entry.playerKey && open.has(entry.playerKey)).length;
  }, [draftOn, saved, dataset, state]);

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to keep your rankings." />
      </main>
    );
  }

  // The commissioner in a member's seat. Their rankings stay closed to him,
  // so the page says why instead of showing a form that cannot save.
  if (identity.impersonatedBy) {
    return (
      <main className="rules-page my-list-page">
        <header className="rules-page-header">
          <div>
            <h1 className="hub-heading glow-teal">
              <NavIcon name="ballot" size={18} className="icon-in-heading" />
              MY RANKINGS
            </h1>
          </div>
          <IdentityChip />
        </header>
        <section className="panel my-list-closed">
          <div className="hub-heading">CLOSED WHILE ACTING AS {identity.owner.toUpperCase()}</div>
          <p>
            {identity.owner}'s rankings are theirs alone. Nobody else sees them, the commish included, not even from their seat.
            To test this page as a member, sign out and sign in as them with their PIN.
          </p>
        </section>
      </main>
    );
  }

  const dirty = loaded && text.trim() !== listToText(saved).trim();
  const unmatched = saved?.entries.filter((entry) => !entry.playerKey) ?? [];
  const matched = (saved?.entries.length ?? 0) - unmatched.length;

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setNotice(null);
    try {
      const loaded = await readRankingsFile(file);
      const names = parseListText(loaded);
      if (names.length === 0) {
        setError(`No names found in ${file.name}. Put one name a line, or in one column.`);
        return;
      }
      setText(names.map((name, index) => `${index + 1}. ${name}`).join('\n'));
      setNotice(`Loaded ${names.length} name${names.length === 1 ? '' : 's'} from ${file.name}. Tap SAVE RANKINGS to keep them.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not read ${file.name}`);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

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
        : 'Your rankings are empty.');
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
      setNotice('Rankings cleared.');
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
            MY RANKINGS
          </h1>
          <p>Your picks if you cannot be there. Nobody else sees them, the commish included.</p>
        </div>
        <IdentityChip />
      </header>

      <section className="panel my-list-how">
        <p>
          Type or paste player names, best first, one a line. Numbers are fine.
          If you miss the draft and the commish puts your team on auto, each of your
          picks takes the top name on your rankings still available. When they run
          out, you get the best player left on the board.
        </p>
        <p className="my-list-dim">
          Keepers are already yours. Players kept by other teams are skipped. Up to {DRAFT_LIST_MAX} names.
          {draftOn ? ' The draft is on: a save takes effect from your next pick.' : ''}
        </p>
      </section>

      {draftOn && saved && stillThere !== null && (
        <section className={`panel my-list-left${stillThere === 0 ? ' is-out' : ''}`}>
          {stillThere === 0
            ? 'Your rankings have run out. If you are on auto, each pick now takes the best player left on the board.'
            : `${stillThere} of your ${saved.entries.length} names ${stillThere === 1 ? 'is' : 'are'} still on the board.`}
        </section>
      )}

      {error && <p className="rules-draft-error">{error}</p>}
      {!error && notice && <p className="rules-draft-note">{notice}</p>}

      <section
        className={`panel my-list-form${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragging(false);
          void onFile(event.dataTransfer.files[0]);
        }}
      >
        <div className="my-list-upload">
          <button type="button" className="vote-btn my-list-upload-btn" disabled={busy || !loaded} onClick={() => fileInput.current?.click()}>
            UPLOAD A FILE
          </button>
          <span>Excel, CSV or text, or drop the file on the box below. Names in any column.</span>
          <input ref={fileInput} type="file" accept={RANKINGS_FILE_ACCEPT} hidden onChange={(event) => void onFile(event.target.files?.[0])} />
        </div>
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
          {dragging && <div className="my-list-drop" aria-hidden="true">DROP IT HERE</div>}
        </label>
        <div className="my-list-count">
          {typed.length} name{typed.length === 1 ? '' : 's'} typed
          {saved && !dirty ? ` · ${matched} matched to the pool` : ''}
        </div>
        <div className="my-list-actions">
          <button type="button" className="vote-btn my-list-save" disabled={busy || !loaded || !dirty} onClick={save}>
            {busy ? 'SAVING…' : 'SAVE RANKINGS'}
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

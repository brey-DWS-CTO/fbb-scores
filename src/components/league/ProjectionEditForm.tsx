import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, deleteProjectionEdit, saveProjectionEdit } from '../../lib/league/api.js';
import { projectedPerGame, type ProjectionRow, type ScoringItem } from '../../lib/league/draftRankings.js';
import {
  GAMES_STAT,
  PER_GAME_STATS,
  editedProjection,
  previewEdit,
  projectionGames,
  type ProjectionEdit,
} from '../../lib/league/projectionEdits.js';
import { PROJECTION_EDITS_KEY } from '../../hooks/useProjectionData.js';
import { useIdentity } from '../../hooks/useLeague.js';

interface Props {
  espnId: number;
  name: string;
  /** ESPN's own projection, before any edit. */
  espn: ProjectionRow | null;
  edit: ProjectionEdit | null;
  scoringItems: readonly ScoringItem[];
  onDone: () => void;
}

const tidy = (value: number | undefined | null) => (value === undefined || value === null ? '' : String(Math.round(value * 10) / 10));

/**
 * Edit one player's projection: games and the per-game line. The FPPG and
 * season total under the boxes recompute as you type, in this league's
 * scoring with the double-double bonus worked out from the new line.
 * Only numbers that differ from ESPN's are saved.
 */
export default function ProjectionEditForm({ espnId, name, espn, edit, scoringItems, onDone }: Props) {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const espnLine = useMemo(() => projectedPerGame(espn) ?? {}, [espn]);
  const espnGames = projectionGames(espn);
  const current = useMemo(() => (edit ? projectedPerGame(editedProjection(espn, edit)) ?? {} : espnLine), [edit, espn, espnLine]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = { [GAMES_STAT.id]: tidy(edit?.games ?? espnGames) };
    for (const stat of PER_GAME_STATS) start[stat.id] = tidy(current[stat.id]);
    return start;
  });
  const [note, setNote] = useState(edit?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only what differs from ESPN goes into the edit.
  const draft = useMemo(() => {
    const games = Number(values[GAMES_STAT.id]);
    const perGame: Record<string, number> = {};
    for (const stat of PER_GAME_STATS) {
      const raw = values[stat.id];
      if (raw === '' || raw === undefined) continue;
      const number = Number(raw);
      if (!Number.isFinite(number)) continue;
      if (tidy(number) !== tidy(espnLine[stat.id])) perGame[stat.id] = number;
    }
    return {
      games: values[GAMES_STAT.id] !== '' && Number.isFinite(games) && tidy(games) !== tidy(espnGames) ? games : null,
      perGame,
    };
  }, [values, espnLine, espnGames]);
  const before = previewEdit(espn, { games: null, perGame: {} }, scoringItems);
  const after = previewEdit(espn, draft, scoringItems);
  const changed = draft.games !== null || Object.keys(draft.perGame).length > 0;

  const run = async (action: () => Promise<unknown>) => {
    if (!identity) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: PROJECTION_EDITS_KEY });
      onDone();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => saveProjectionEdit(identity!, espnId, { name, games: draft.games, perGame: draft.perGame, note }));
  const reset = () => run(() => deleteProjectionEdit(identity!, espnId));

  const field = (id: string, label: string, espnValue: number | null | undefined) => (
    <label key={id} className="proj-edit-field">
      <span className="proj-edit-label">{label}</span>
      <input
        className="hub-input"
        type="number"
        inputMode="decimal"
        step={id === GAMES_STAT.id ? 1 : 0.1}
        min={0}
        value={values[id] ?? ''}
        onChange={(event) => setValues((currentValues) => ({ ...currentValues, [id]: event.target.value }))}
      />
      <small className={tidy(Number(values[id])) !== tidy(espnValue) ? 'is-changed' : ''}>ESPN {tidy(espnValue) || '–'}</small>
    </label>
  );

  return (
    <div className="proj-edit" onClick={(event) => event.stopPropagation()}>
      <div className="proj-edit-grid">
        {field(GAMES_STAT.id, GAMES_STAT.label, espnGames)}
        {PER_GAME_STATS.map((stat) => field(stat.id, stat.label, espnLine[stat.id]))}
      </div>
      <label className="proj-edit-note">
        <span className="proj-edit-label">NOTE</span>
        <input className="hub-input" type="text" maxLength={200} placeholder="Why, e.g. hurt until January" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="proj-edit-result">
        <span>ESPN: <strong>{before.fppg?.toFixed(1) ?? '–'}</strong> FPPG, <strong>{before.total?.toLocaleString() ?? '–'}</strong> total</span>
        <span className="proj-edit-arrow">→</span>
        <span>Yours: <strong className="proj-edit-new">{after.fppg?.toFixed(1) ?? '–'}</strong> FPPG, <strong className="proj-edit-new">{after.total?.toLocaleString() ?? '–'}</strong> total</span>
      </div>
      {error && <div className="identity-error" role="alert">{error}</div>}
      <div className="proj-edit-actions">
        <button type="button" className="tap-btn mock-mini-btn is-primary" disabled={busy || !changed} onClick={() => void save()}>
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={onDone}>CANCEL</button>
        {edit && (
          <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void reset()}>RESET TO ESPN</button>
        )}
      </div>
    </div>
  );
}

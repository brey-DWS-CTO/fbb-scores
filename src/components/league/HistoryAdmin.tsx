import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  applyHistoryImport,
  fetchHistoryDraft,
  previewHistoryImport,
  publishHistory,
  resetHistoryDraft,
  saveHistoryDraft,
  type HistoryImportPreviewResponse,
} from '../../lib/league/api.js';
import {
  historyFingerprint,
  mergeSeasonImport,
  validateHistory,
  type LeagueHistory,
  type SeasonImport,
  type SourceRef,
} from '../../lib/league/history.js';
import type { TeamMapping } from '../../lib/league/historyImport.js';

const NO_FRANCHISE = '';

interface EspnTeamRow {
  espnTeamId: number;
  name: string;
  finalRank: number | null;
}

/**
 * Commissioner tools for league history: read a season from ESPN, look at what
 * it would change, save it into the draft, then publish it with a reason.
 *
 * Nothing here writes to published history. Importing touches the draft only,
 * and publishing needs the fingerprint of the exact draft on screen.
 */
export default function HistoryAdmin() {
  const { identity } = useIdentity();
  const [draft, setDraft] = useState<LeagueHistory | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [seasonNumber, setSeasonNumber] = useState('17');
  const [espnSeasonId, setEspnSeasonId] = useState('2027');
  const [payloadText, setPayloadText] = useState('');
  const [teamMap, setTeamMap] = useState<Record<number, string>>({});
  const [espnTeams, setEspnTeams] = useState<EspnTeamRow[]>([]);
  const [preview, setPreview] = useState<HistoryImportPreviewResponse | null>(null);

  const [handChampion, setHandChampion] = useState(NO_FRANCHISE);
  const [handRunnerUp, setHandRunnerUp] = useState(NO_FRANCHISE);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!identity) return;
    const row = await fetchHistoryDraft(identity);
    setDraft(row.history);
    setVersion(row.version);
  }, [identity]);

  useEffect(() => {
    load().catch((e) => setError(apiErrorMessage(e)));
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const fingerprint = useMemo(() => (draft ? historyFingerprint(draft) : ''), [draft]);
  const problems = useMemo(() => (draft ? validateHistory(draft) : []), [draft]);
  const blockers = problems.filter((problem) => problem.severity === 'error');

  if (!identity?.isCommissioner || !draft) return null;

  const parsedPayload = (): unknown | undefined => {
    const text = payloadText.trim();
    if (text === '') return undefined;
    return JSON.parse(text) as unknown;
  };

  const importRequest = () => ({
    seasonNumber: Number(seasonNumber),
    espnSeasonId: Number(espnSeasonId),
    teamMap: espnTeams
      .filter((team) => (teamMap[team.espnTeamId] ?? NO_FRANCHISE) !== NO_FRANCHISE)
      .map((team): TeamMapping => {
        const franchise = draft.franchises.find((entry) => entry.id === teamMap[team.espnTeamId]);
        return {
          espnTeamId: team.espnTeamId,
          franchiseId: teamMap[team.espnTeamId],
          // The record book names people, not ESPN team names. An old season
          // whose owner has since changed is corrected in the draft.
          ownerName: franchise?.currentOwner ?? franchise?.name ?? team.name,
        };
      }),
    payload: parsedPayload(),
  });

  const runPreview = () =>
    run(async () => {
      const result = await previewHistoryImport(identity, importRequest());
      setPreview(result);
      if (result.espnTeams.length > 0) setEspnTeams(result.espnTeams);
      setNotice(
        result.blocked
          ? 'ESPN answered. Map every team to a franchise, then read it again.'
          : `${result.diff.changes.length} changes, ${result.conflicts.length} conflicts. Nothing written yet.`,
      );
    });

  const runApply = () =>
    run(async () => {
      if (!preview) return;
      const result = await applyHistoryImport(identity, {
        ...importRequest(),
        fingerprint: preview.fingerprint,
        expectedVersion: version,
      });
      setPreview(null);
      await load();
      setNotice(`Saved to the draft: ${result.changes} changes. Publish when it reads right.`);
    });

  const recordByHand = () =>
    run(async () => {
      const number = Number(seasonNumber);
      const champion = draft.franchises.find((franchise) => franchise.id === handChampion);
      const runnerUp = draft.franchises.find((franchise) => franchise.id === handRunnerUp);
      if (!champion || !runnerUp || champion.id === runnerUp.id) {
        throw new Error('Pick a champion and a different runner-up');
      }
      const source: SourceRef = {
        provenance: 'commissioner',
        reference: `Commissioner entry, ${new Date().toISOString().slice(0, 10)}`,
        verified: true,
        recordedAt: new Date().toISOString(),
      };
      const endYear = Number(espnSeasonId);
      const incoming: SeasonImport = {
        seasonNumber: number,
        label: `${endYear - 1}-${endYear}`,
        startYear: endYear - 1,
        endYear,
        espnSeasonId: endYear,
        status: 'complete',
        standingsComplete: false,
        placements: [
          { franchiseId: champion.id, ownerName: champion.currentOwner ?? champion.name, placement: 1, source },
          { franchiseId: runnerUp.id, ownerName: runnerUp.currentOwner ?? runnerUp.name, placement: 2, source },
        ],
        records: [],
        source,
      };
      const merged = mergeSeasonImport(draft, incoming);
      const saved = await saveHistoryDraft(identity, merged.history, version);
      setDraft(merged.history);
      setVersion(saved.version);
      setNotice(`Season ${number} written into the draft. Publish when it reads right.`);
    });

  const runPublish = () =>
    run(async () => {
      if (reason.trim().length < 3) throw new Error('Say why this revision exists');
      const result = await publishHistory(identity, fingerprint, reason.trim(), '');
      setReason('');
      await load();
      setNotice(`Published revision ${result.revision}.`);
    });

  const runReset = () =>
    run(async () => {
      const row = await resetHistoryDraft(identity);
      setDraft(row.history);
      setVersion(row.version);
      setPreview(null);
      setNotice('Draft thrown away. Back to the published history.');
    });

  return (
    <section className="panel history-admin">
      <div className="hub-heading history-heading">LEAGUE HISTORY</div>
      <p className="records-caption">
        Draft version {version}. {draft.seasons.length} seasons, {draft.records.length} records.{' '}
        <Link to="/history" className="records-link">
          Read it
        </Link>
      </p>

      {error && <div className="history-admin-error">{error}</div>}
      {notice && <div className="history-admin-notice">{notice}</div>}
      {blockers.length > 0 && (
        <div className="history-admin-error">
          {blockers.length} problems block publishing: {blockers[0].where} — {blockers[0].message}
        </div>
      )}

      <div className="history-admin-row">
        <label>
          Season number
          <input
            className="history-input"
            value={seasonNumber}
            inputMode="numeric"
            onChange={(event) => setSeasonNumber(event.target.value)}
          />
        </label>
        <label>
          ESPN season (year it ends)
          <input
            className="history-input"
            value={espnSeasonId}
            inputMode="numeric"
            onChange={(event) => setEspnSeasonId(event.target.value)}
          />
        </label>
      </div>

      <details className="history-admin-details">
        <summary>Paste an ESPN response instead of pulling it</summary>
        <textarea
          className="history-input history-textarea"
          rows={4}
          value={payloadText}
          placeholder="Leave this empty to pull the season live. ESPN credentials live in Vercel only."
          onChange={(event) => setPayloadText(event.target.value)}
        />
      </details>

      {espnTeams.length > 0 && (
        <div className="history-admin-map">
          <div className="hub-heading history-subheading">MAP ESPN TEAMS TO FRANCHISES</div>
          {espnTeams.map((team) => (
            <label key={team.espnTeamId} className="history-map-row">
              <span>
                {team.name} <span className="history-source">#{team.espnTeamId}</span>
              </span>
              <select
                className="history-input"
                value={teamMap[team.espnTeamId] ?? NO_FRANCHISE}
                onChange={(event) =>
                  setTeamMap((current) => ({ ...current, [team.espnTeamId]: event.target.value }))
                }
              >
                <option value={NO_FRANCHISE}>not mapped</option>
                {draft.franchises.map((franchise) => (
                  <option key={franchise.id} value={franchise.id}>
                    {franchise.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="history-admin-actions">
        <button type="button" className="tap-btn history-btn" disabled={busy} onClick={runPreview}>
          READ SEASON
        </button>
        <button
          type="button"
          className="tap-btn history-btn"
          disabled={busy || !preview || preview.blocked}
          onClick={runApply}
        >
          SAVE TO DRAFT
        </button>
        <button type="button" className="tap-btn history-btn" disabled={busy} onClick={runReset}>
          RESET DRAFT
        </button>
      </div>

      {preview && (
        <div className="history-preview">
          <div className="hub-heading history-subheading">WHAT WOULD CHANGE</div>
          {preview.importProblems.length > 0 && (
            <ul className="history-flags">
              {preview.importProblems.map((problem) => (
                <li key={`${problem.kind}-${problem.message}`}>
                  {problem.severity === 'error' ? 'Blocked: ' : 'Note: '}
                  {problem.message}
                </li>
              ))}
            </ul>
          )}
          {preview.conflicts.length > 0 && (
            <ul className="history-flags">
              {preview.conflicts.map((conflict) => (
                <li key={conflict.id}>{conflict.note}</li>
              ))}
            </ul>
          )}
          {preview.diff.identical ? (
            <p className="records-caption">Nothing changes.</p>
          ) : (
            <ul className="history-flags">
              {preview.diff.changes.slice(0, 40).map((change) => (
                <li key={`${change.kind}-${change.id}`}>
                  {change.kind}: {change.label} {change.after ? `→ ${change.after}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="history-admin-map">
        <div className="hub-heading history-subheading">OR RECORD THE SEASON BY HAND</div>
        <div className="history-admin-row">
          <label>
            Champion
            <select
              className="history-input"
              value={handChampion}
              onChange={(event) => setHandChampion(event.target.value)}
            >
              <option value={NO_FRANCHISE}>pick one</option>
              {draft.franchises.map((franchise) => (
                <option key={franchise.id} value={franchise.id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Runner-up
            <select
              className="history-input"
              value={handRunnerUp}
              onChange={(event) => setHandRunnerUp(event.target.value)}
            >
              <option value={NO_FRANCHISE}>pick one</option>
              {draft.franchises.map((franchise) => (
                <option key={franchise.id} value={franchise.id}>
                  {franchise.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="tap-btn history-btn" disabled={busy} onClick={recordByHand}>
          WRITE IT INTO THE DRAFT
        </button>
      </div>

      <div className="history-admin-map">
        <div className="hub-heading history-subheading">PUBLISH</div>
        <p className="records-caption">
          Publishing freezes the draft as a new revision. A correction never overwrites the old one.
        </p>
        <input
          className="history-input"
          value={reason}
          placeholder="Why this revision exists"
          onChange={(event) => setReason(event.target.value)}
        />
        <button
          type="button"
          className="tap-btn history-btn"
          disabled={busy || blockers.length > 0 || reason.trim().length < 3}
          onClick={runPublish}
        >
          PUBLISH HISTORY
        </button>
      </div>
    </section>
  );
}

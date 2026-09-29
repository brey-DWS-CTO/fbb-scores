import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptDraftRankings,
  acceptPlayerPool,
  acceptTeamNames,
  apiErrorMessage,
  fetchDraftRankings,
  fetchEspnDraftRankingPreview,
  fetchEspnPlayerPoolPreview,
  fetchEspnTeamNamePreview,
  fetchPlayerPool,
  sandboxActive,
  type FetchedDraftRankingPreviewResponse,
  type FetchedPlayerPoolPreviewResponse,
  type TeamNamePreviewResponse,
} from '../../lib/league/api.js';
import {
  SYNC_LABELS,
  SYNC_PARTS,
  partsToSave,
  summarizePlayers,
  summarizeRankings,
  summarizeTeams,
  type SyncPart,
  type SyncSummary,
} from '../../lib/league/espnSync.js';
import { useApplyStateResponse, useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import NavIcon from './NavIcon.js';

const shortDate = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });

interface Check {
  players: FetchedPlayerPoolPreviewResponse | null;
  rankings: FetchedDraftRankingPreviewResponse | null;
  teams: TeamNamePreviewResponse | null;
  errors: Partial<Record<SyncPart, string>>;
}

type Outcome = { ok: true } | { ok: false; error: string };

/**
 * Commissioner tool: one button that asks ESPN for the player list, the draft
 * ranks and projections, and the team names, says what changed, and saves the
 * lot in one tap. Each part keeps its own preview and accept on the server.
 */
export default function EspnSyncPanel() {
  const { identity } = useIdentity();
  const { state } = useLeagueState();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState<'check' | 'save' | null>(null);
  const [armed, setArmed] = useState(false);
  const [saved, setSaved] = useState<Partial<Record<SyncPart, Outcome>> | null>(null);

  const isCommish = identity?.isCommissioner === true;
  const poolQuery = useQuery({
    queryKey: ['admin-player-pool', state.playerPool?.activeSnapshotId ?? `dataset-${state.season}`, state.draft.playerPoolSnapshotId ?? 'unlocked'],
    queryFn: () => fetchPlayerPool(identity),
    enabled: isCommish,
    staleTime: 30_000,
  });
  const rankingsQuery = useQuery({
    queryKey: ['admin-draft-rankings', state.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchDraftRankings(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 30_000,
  });

  if (!identity || !isCommish) return null;
  const draftStarted = state.draft.startedAt !== null;
  const inSandbox = sandboxActive();
  const pool = poolQuery.data?.snapshot ?? null;
  const ranks = rankingsQuery.data?.fallback ? null : rankingsQuery.data?.snapshot ?? null;

  const summaries: Record<SyncPart, SyncSummary | null> = {
    players: check?.players ? summarizePlayers(check.players.preview, check.players, draftStarted) : null,
    rankings: check?.rankings ? summarizeRankings(check.rankings.preview, check.rankings) : null,
    teams: check?.teams ? summarizeTeams(check.teams.preview) : null,
  };
  const toSave = partsToSave(Object.values(summaries));

  const runCheck = async () => {
    setBusy('check');
    setArmed(false);
    setSaved(null);
    const [players, rankings, teams] = await Promise.allSettled([
      fetchEspnPlayerPoolPreview(identity),
      fetchEspnDraftRankingPreview(identity),
      fetchEspnTeamNamePreview(identity),
    ]);
    const errors: Check['errors'] = {};
    if (players.status === 'rejected') errors.players = apiErrorMessage(players.reason);
    if (rankings.status === 'rejected') errors.rankings = apiErrorMessage(rankings.reason);
    if (teams.status === 'rejected') errors.teams = apiErrorMessage(teams.reason);
    setCheck({
      players: players.status === 'fulfilled' ? players.value : null,
      rankings: rankings.status === 'fulfilled' ? rankings.value : null,
      teams: teams.status === 'fulfilled' ? teams.value : null,
      errors,
    });
    setBusy(null);
  };

  const save = async () => {
    if (!check) return;
    setBusy('save');
    const outcomes: Partial<Record<SyncPart, Outcome>> = {};
    // One at a time: each accept returns fresh league state for the next.
    for (const part of toSave) {
      try {
        if (part === 'players' && check.players) {
          applyState(await acceptPlayerPool(identity, check.players.candidate, check.players));
        } else if (part === 'rankings' && check.rankings) {
          applyState(await acceptDraftRankings(identity, check.rankings.candidate, check.rankings));
        } else if (part === 'teams' && check.teams) {
          applyState(await acceptTeamNames(identity, check.teams));
        }
        outcomes[part] = { ok: true };
      } catch (caught) {
        outcomes[part] = { ok: false, error: apiErrorMessage(caught) };
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['admin-player-pool'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-draft-rankings'] });
    setSaved(outcomes);
    setCheck(null);
    setArmed(false);
    setBusy(null);
  };

  return (
    <section className="panel espn-sync">
      <div className="hub-heading espn-sync-title">UPDATE FROM ESPN</div>
      <p className="espn-sync-lede">
        Pulls the player list, draft ranks and projections, and team names from ESPN. Shows what
        changed. Saves nothing until you say so. Run it once a week until the draft.
      </p>

      <ul className="espn-sync-now">
        <li>
          <span>Players</span>
          <span>
            {pool
              ? `${pool.players.length}, ${pool.source === 'committed-dataset' ? 'built-in list' : `from ESPN ${shortDate(pool.fetchedAt)}`}`
              : '…'}
            {state.draft.playerPoolSnapshotId && ', locked for the draft'}
          </span>
        </li>
        <li>
          <span>Ranks and projections</span>
          <span>
            {ranks
              ? `${ranks.players.filter((player) => player.projection !== null).length} projected, from ESPN ${shortDate(ranks.fetchedAt)}`
              : rankingsQuery.isLoading ? '…' : 'never fetched'}
          </span>
        </li>
      </ul>

      {inSandbox && <div className="espn-sync-warn">Exit test mode before saving anything from ESPN.</div>}

      {saved && (
        <ul className="espn-sync-results">
          {SYNC_PARTS.filter((part) => saved[part]).map((part) => {
            const outcome = saved[part]!;
            return (
              <li key={part} className={outcome.ok ? 'is-ok' : 'is-bad'}>
                {SYNC_LABELS[part]}: {outcome.ok ? 'saved.' : outcome.error}
              </li>
            );
          })}
          {Object.keys(saved).length === 0 && <li>Nothing to save.</li>}
        </ul>
      )}

      <button type="button" className="tap-btn espn-sync-btn" disabled={busy !== null || inSandbox} onClick={() => void runCheck()}>
        {busy === 'check' ? 'ASKING ESPN…' : check ? 'CHECK AGAIN' : 'CHECK ESPN'}
      </button>

      {check && (
        <div className="espn-sync-check">
          {SYNC_PARTS.map((part) => {
            const summary = summaries[part];
            const error = check.errors[part];
            return (
              <div key={part} className="espn-sync-part">
                <div className="espn-sync-part-head">
                  <span className="espn-sync-part-label">{SYNC_LABELS[part]}</span>
                  {error
                    ? <span className="espn-sync-tag is-bad">FAILED</span>
                    : summary?.changed
                      ? <span className="espn-sync-tag is-new">WILL SAVE</span>
                      : <span className="espn-sync-tag">NO CHANGE</span>}
                </div>
                {error ? (
                  <div className="espn-sync-line is-bad">
                    <NavIcon name="warning" size={13} className="icon-in-heading" />
                    {error}
                  </div>
                ) : summary && (
                  <>
                    <div className="espn-sync-line">{summary.headline}</div>
                    {summary.details.map((line) => <div key={line} className="espn-sync-detail">{line}</div>)}
                    {summary.warnings.map((line) => <div key={line} className="espn-sync-detail is-warn">{line}</div>)}
                  </>
                )}
              </div>
            );
          })}

          {toSave.length > 0 && (!armed ? (
            <button type="button" className="tap-btn espn-sync-btn is-save" disabled={busy !== null || inSandbox} onClick={() => setArmed(true)}>
              SAVE {toSave.length} {toSave.length === 1 ? 'UPDATE' : 'UPDATES'}
            </button>
          ) : (
            <button type="button" className="tap-btn espn-sync-btn is-confirm" disabled={busy !== null || inSandbox} onClick={() => void save()}>
              {busy === 'save' ? 'SAVING…' : 'CONFIRM: MAKE THESE LIVE'}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

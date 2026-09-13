import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptDraftRankings,
  apiErrorMessage,
  fetchDraftRankings,
  fetchEspnDraftRankingPreview,
  sandboxActive,
  type FetchedDraftRankingPreviewResponse,
} from '../../lib/league/api.js';
import {
  rankBoard,
  rankSourceLabel,
  type BoardRank,
  type DraftRankingPlayer,
} from '../../lib/league/draftRankings.js';
import { useApplyStateResponse, useDraftData, useIdentity } from '../../hooks/useLeague.js';
import NavIcon from './NavIcon.js';

function formatTime(value: string): string {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The number a board entry was ordered on, with its unit. */
function describeValue(entry: BoardRank): string {
  if (entry.value === null) return 'no data';
  if (entry.source === 'espn-rank') {
    return entry.espnBasis === 'adp' ? `ADP ${entry.value.toFixed(1)}` : `#${entry.value}`;
  }
  return `${entry.value.toFixed(1)} FPPG`;
}

function Chip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className="rank-admin-chip" style={{ '--chip-color': color } as React.CSSProperties}>
      {label} {count}
    </span>
  );
}

function EspnTopTen({ players }: { players: DraftRankingPlayer[] }) {
  const top = players.filter((player) => player.standard !== null).slice(0, 10);
  if (top.length === 0) return null;
  return (
    <ul className="rank-admin-list">
      {top.map((player) => (
        <li key={player.espnId}>
          <span className="rank-admin-pos">{player.standard?.rank}</span>
          <span className="rank-admin-name">
            {player.fullName}
            <small>{player.proTeam}</small>
          </span>
          <span className="rank-admin-num">
            {player.adp !== null ? `ADP ${player.adp.toFixed(1)}` : 'no ADP'}
            {player.standard?.auctionValue !== null && player.standard?.auctionValue !== undefined && (
              <small>${player.standard.auctionValue}</small>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Commissioner tool: freeze ESPN's draft numbers into an immutable snapshot,
 * and show what the board orders on today.
 */
export default function DraftRankingAdmin() {
  const { identity } = useIdentity();
  const { state, dataset } = useDraftData();
  const applyState = useApplyStateResponse();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<FetchedDraftRankingPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentQuery = useQuery({
    queryKey: ['admin-draft-rankings', state.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchDraftRankings(identity as NonNullable<typeof identity>),
    enabled: identity?.isCommissioner === true,
    staleTime: 30_000,
  });
  const current = currentQuery.data?.snapshot ?? null;

  const board = useMemo(
    () => rankBoard(dataset.players, current),
    [dataset.players, current],
  );

  if (!identity?.isCommissioner) return null;
  const inSandbox = sandboxActive();
  const disabled = busy || inSandbox;
  const season = current?.season ?? state.season;
  const projectedCount = current?.players.filter((player) => player.projection !== null).length ?? 0;
  const rankedCount = current?.players.filter((player) => player.standard !== null).length ?? 0;

  const fetchPreview = async () => {
    setBusy(true);
    setError(null);
    setArmed(false);
    try {
      setPreview(await fetchEspnDraftRankingPreview(identity));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await acceptDraftRankings(identity, preview.candidate, preview);
      applyState(accepted);
      setPreview(null);
      setArmed(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-draft-rankings'] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  const diff = preview?.preview;

  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-blue)', marginBottom: 6 }}>
        DRAFT RANKINGS
      </div>
      <div style={{ color: 'var(--text-mid)', fontSize: '0.74rem', marginBottom: 10 }}>
        Fetches ESPN's draft numbers for every player: average draft position, draft rank, auction
        value, percent owned, and the season projection once ESPN publishes one. Shows every change,
        then stores an immutable snapshot. The mock draft reads from it.
      </div>

      {currentQuery.isLoading ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Loading current rankings…</div>
      ) : current ? (
        <div
          style={{
            padding: 10,
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            background: 'var(--input-bg)',
            fontSize: '0.76rem',
          }}
        >
          {current.source === 'none' ? (
            <div style={{ color: 'var(--text-hi)', fontWeight: 800 }}>No ESPN rankings accepted yet</div>
          ) : (
            <>
              <div style={{ color: 'var(--text-hi)', fontWeight: 800 }}>
                {rankedCount} ranked · {current.players.length} players ·{' '}
                {current.source === 'manual' ? 'loaded by hand' : 'ESPN'}
              </div>
              <div style={{ color: 'var(--text-dim)', marginTop: 3 }}>
                {current.id} · {current.source === 'manual' ? 'captured' : 'fetched'}{' '}
                {formatTime(current.fetchedAt)}
                {current.sourceUrl ? ` · from ${current.sourceUrl}` : ''}
              </div>
            </>
          )}
          <div style={{ color: projectedCount > 0 ? 'var(--neon-teal)' : 'var(--text-mid)', marginTop: 4 }}>
            {projectedCount > 0
              ? `ESPN projections in hand for ${projectedCount} players.`
              : `ESPN has not published ${rankSourceLabel('projection', season)}s yet. That is expected before the season; the board orders on the next best source until they land.`}
          </div>
        </div>
      ) : (
        <div style={{ color: 'var(--neon-red)', fontSize: '0.75rem' }}>
          {apiErrorMessage(currentQuery.error)}
        </div>
      )}

      <div className="rank-admin-source">
        <NavIcon name="target" size={13} />
        Board order today: {rankSourceLabel(board.primary, season)}
      </div>
      <ul className="rank-admin-list">
        {board.entries.slice(0, 10).map((entry) => (
          <li key={entry.player.key}>
            <span className="rank-admin-pos">{entry.position}</span>
            <span className="rank-admin-name">
              {entry.player.fullName ?? entry.player.name}
              <small>{entry.player.proTeam}</small>
            </span>
            <span className="rank-admin-num">{describeValue(entry)}</span>
          </li>
        ))}
      </ul>
      <div className="rank-admin-note">
        {board.counts.projection > 0 && `${board.counts.projection} on ${rankSourceLabel('projection', season)} · `}
        {board.counts['espn-rank'] > 0 && `${board.counts['espn-rank']} on ${rankSourceLabel('espn-rank', season)} · `}
        {board.counts['last-season'] > 0 && `${board.counts['last-season']} on ${rankSourceLabel('last-season', season)} · `}
        {board.counts.none} with no data, sorted last
      </div>

      {inSandbox && (
        <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginTop: 10 }}>
          Exit test mode before changing the live rankings.
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: 'var(--neon-red)', fontSize: '0.78rem', marginTop: 10 }}>
          <NavIcon name="warning" size={14} className="icon-in-heading" />
          {error}
        </div>
      )}

      <button
        className="tap-btn"
        type="button"
        disabled={disabled}
        onClick={fetchPreview}
        style={{
          minHeight: 44,
          marginTop: 12,
          padding: '0 16px',
          borderRadius: 8,
          border: '2px solid var(--neon-blue)',
          background: 'rgba(0,153,255,0.08)',
          color: 'var(--neon-blue)',
          fontWeight: 800,
        }}
      >
        {busy ? 'WORKING…' : 'FETCH RANKINGS FROM ESPN'}
      </button>

      {diff && preview && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
          <div className="rank-admin-chips">
            <Chip label="RANKED" count={diff.counts.ranked} color="var(--neon-blue)" />
            <Chip label="WITH ADP" count={diff.counts.withAdp} color="var(--neon-blue)" />
            <Chip label="PROJECTED" count={diff.counts.projected} color="var(--neon-teal)" />
            <Chip label="NEW" count={diff.added.length} color="var(--neon-teal)" />
            <Chip label="GONE" count={diff.removed.length} color="var(--neon-red)" />
            <Chip label="MOVED" count={diff.moved.length} color="var(--neon-yellow)" />
          </div>

          {diff.projectionArrived && (
            <div style={{ color: 'var(--neon-teal)', fontSize: '0.76rem', fontWeight: 800, marginTop: 10 }}>
              ESPN projections have arrived for {diff.counts.projected} players. Accepting this
              switches the board to {rankSourceLabel('projection', season)}.
            </div>
          )}
          {diff.scoringChanged && diff.previousCounts.players > 0 && (
            <div style={{ color: 'var(--neon-yellow)', fontSize: '0.74rem', marginTop: 8 }}>
              The league's scoring items differ from the current snapshot. Projected points will
              be figured on the new ones.
            </div>
          )}
          {diff.nextScoringItems.length === 0 && (
            <div style={{ color: 'var(--neon-yellow)', fontSize: '0.74rem', marginTop: 8 }}>
              ESPN sent no scoring items, so projections cannot be turned into points until it does.
            </div>
          )}

          <div style={{ color: 'var(--text-hi)', fontSize: '0.72rem', fontWeight: 800, marginTop: 12 }}>
            ESPN'S TOP TEN
          </div>
          <EspnTopTen players={diff.nextPlayers} />

          {diff.moved.length > 0 && (
            <>
              <div style={{ color: 'var(--text-hi)', fontSize: '0.72rem', fontWeight: 800, marginTop: 12 }}>
                BIGGEST MOVES
              </div>
              <ul className="rank-admin-list">
                {diff.moved.slice(0, 8).map((move) => (
                  <li key={move.espnId}>
                    <span className={move.delta > 0 ? 'rank-admin-pos rank-admin-up' : 'rank-admin-pos rank-admin-down'}>
                      {move.delta > 0 ? `+${move.delta}` : move.delta}
                    </span>
                    <span className="rank-admin-name">{move.fullName}</span>
                    <span className="rank-admin-num">#{move.before} to #{move.after}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="rank-admin-note">
            Candidate {preview.candidateSnapshotId} · {diff.nextPlayers.length} players · read{' '}
            {formatTime(preview.candidate.fetchedAt)}
          </div>

          {!armed ? (
            <button
              className="tap-btn"
              type="button"
              disabled={disabled}
              onClick={() => setArmed(true)}
              style={{
                minHeight: 44,
                marginTop: 12,
                padding: '0 16px',
                borderRadius: 8,
                border: '2px solid var(--neon-teal)',
                background: 'transparent',
                color: 'var(--neon-teal)',
                fontWeight: 800,
              }}
            >
              ACCEPT THIS SNAPSHOT
            </button>
          ) : (
            <button
              className="tap-btn"
              type="button"
              disabled={disabled}
              onClick={accept}
              style={{
                minHeight: 44,
                marginTop: 12,
                padding: '0 16px',
                borderRadius: 8,
                border: '2px solid var(--neon-yellow)',
                background: 'rgba(255,230,0,0.1)',
                color: 'var(--neon-yellow)',
                fontWeight: 800,
              }}
            >
              CONFIRM: MAKE THESE THE LIVE RANKINGS
            </button>
          )}
        </div>
      )}
    </section>
  );
}

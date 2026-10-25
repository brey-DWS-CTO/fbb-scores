import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity, type Identity } from '../../hooks/useLeague.js';
import { apiErrorMessage, sandboxActive } from '../../lib/league/api.js';
import { validateMove, type MoveRequest } from '../../lib/league/lineup.js';
import { fetchMyTeam, fetchLineupOperation, submitLineupMove, lineupMoveWasNotSubmitted, type LineupOperation, type MoveResponse } from '../../lib/league/lineupApi.js';
import './myTeam.css';

const inProgress = (operation: LineupOperation | null | undefined) => operation != null &&
  ['REQUESTED', 'VALIDATING', 'EXECUTING', 'VERIFYING'].includes(operation.status);

export default function MyTeamPage() {
  const { identity } = useIdentity();
  return <MyTeamSession key={[identity?.owner, identity?.session, identity?.pin].join(':')} identity={identity} />;
}

function MyTeamSession({ identity }: { identity: Identity | null }) {
  const client = useQueryClient();
  const sandbox = sandboxActive();
  const [selected, setSelected] = useState<{ playerId: number; revision: string } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [submission, setSubmission] = useState<MoveResponse | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const key = ['my-team', identity?.owner, identity?.session];
  const team = useQuery({ queryKey: key, queryFn: () => fetchMyTeam(identity!),
    enabled: identity != null && !identity.isGuest && !sandbox, refetchInterval: 15_000 });
  const operationQuery = useQuery({ queryKey: ['lineup-operation', identity?.owner, pendingId],
    queryFn: () => fetchLineupOperation(identity!, pendingId!),
    enabled: pendingId != null && identity != null && !sandbox,
    refetchInterval: query => {
      const operation = query.state.data?.operation;
      return !operation || inProgress(operation) || operation.status === 'UNKNOWN' ? 3000 : false;
    }, retry: false });
  const result = operationQuery.data ?? submission;
  const operation = result?.operation ?? team.data?.operation;
  const confirmed = result?.snapshot;
  const latest = team.data?.snapshot;
  const snapshot = confirmed && (!latest || Date.parse(confirmed.fetchedAt) > Date.parse(latest.fetchedAt)) ? confirmed : latest;
  const uncertain = pendingId != null && (!result || operationQuery.isError) || operation?.status === 'UNKNOWN';
  const waiting = busy || inProgress(operation);
  const enabled = team.data?.enabled === true && team.data.executionEnabled === true && !waiting && !uncertain;
  const cutoff = team.data?.safetyCutoffMinutes ?? 10;
  const groupedSlots = snapshot ? [
    { kind: 'starter', title: 'Starting lineup', slots: snapshot.slots.filter(slot => slot.kind === 'starter') },
    { kind: 'bench', title: 'Bench', slots: snapshot.slots.filter(slot => slot.kind === 'bench') },
    { kind: 'reserve', title: 'Reserves', slots: snapshot.slots.filter(slot => slot.kind === 'reserve') },
    { kind: 'unknown', title: 'Roster', slots: snapshot.slots.filter(slot => !slot.kind) },
  ].filter(group => group.slots.length > 0) : [];

  const move = async (request: MoveRequest) => {
    if (!identity || !enabled || submitting.current) return;
    submitting.current = true;
    setBusy(true); setMessage(''); setSelected(null);
    const id = crypto.randomUUID();
    setPendingId(id); setSubmission(null);
    try {
      const response = await submitLineupMove(identity, { ...request, id });
      setSubmission(response);
      client.setQueryData(['lineup-operation', identity.owner, id], response);
      await client.invalidateQueries({ queryKey: key });
    } catch (error) {
      if (lineupMoveWasNotSubmitted(error)) {
        setPendingId(null);
        setSubmission(null);
        setMessage(apiErrorMessage(error));
        return;
      }
      // A lost response can follow a saved ESPN move. Keep the id and reconcile.
      setMessage('The response was lost. Checking the saved move before allowing another.');
    } finally { submitting.current = false; setBusy(false); }
  };
  const status = waiting ? 'Moving…' : uncertain ? 'Move outcome unknown. Waiting for ESPN verification.'
    : message || (operation?.status === 'SUCCEEDED' ? 'ESPN confirmed your lineup.'
      : operation?.status === 'FAILED' ? operation.message ?? 'The move was not saved.' : '');

  return <main className={`my-team-page${team.data?.executionEnabled ? '' : ' my-team-readonly'}`}>
    <header><div className="hub-heading">SCORES</div><h1>My Team</h1>
      <p>{team.data?.executionEnabled ? 'Tap a player, then an eligible roster row. ESPN must confirm each change.' : 'View your ESPN roster. Live lineup execution is unverified and remains off.'}</p></header>
    {!identity ? <p className="panel my-team-notice">Sign in to view your team.</p> : identity.isGuest
      ? <p className="panel my-team-notice">Lineup management is available to authorized team owners.</p> : sandbox
        ? <p className="panel my-team-notice">Lineup management is unavailable in test mode.</p> : <>
          {team.isLoading && <p role="status">Loading your team…</p>}
          {team.isError && <p role="alert">{apiErrorMessage(team.error)} <button type="button" className="tap-btn" onClick={() => void team.refetch()}>Retry</button></p>}
          {team.data && !team.data.executionEnabled && <div className="panel my-team-notice"><h2>Lineup changes are off</h2><p>{team.data.reason || 'The ESPN lineup connection has not been verified.'}</p></div>}
          {team.data?.readError && <p role="alert">{team.data.readError}</p>}
          {team.data?.readEnabled && <div className="my-team-read-toolbar"><span>ESPN roster · Read only</span><button type="button" className="tap-btn" disabled={team.isFetching} onClick={() => void team.refetch()}>{team.isFetching ? 'Refreshing…' : 'Refresh roster'}</button></div>}
          <p role="status" aria-live="polite" className="my-team-status">{status}</p>
          {snapshot && <>
            <div className="my-team-meta"><span>Scoring period {snapshot.scoringPeriodId}</span>{team.data?.executionEnabled && <span>{cutoff}-minute safety cutoff</span>}</div>
            <p id="lineup-help">{!team.data?.executionEnabled ? 'This roster comes from ESPN. Rows are disabled while live execution is unverified.' : selected?.revision === snapshot.revision ? 'Choose a highlighted destination. Tap the selected player to cancel.' : 'Choose a player to see eligible destinations.'}</p>
            {groupedSlots.map(group => <section className="my-team-group" key={group.kind} aria-labelledby={`lineup-${group.kind}`}><h2 id={`lineup-${group.kind}`}>{group.title}</h2><div className="my-team-roster" aria-describedby="lineup-help">
              {group.slots.map(slot => {
                const player = snapshot.players.find(candidate => candidate.id === slot.playerId);
                const activeSelection = selected?.revision === snapshot.revision ? selected : null;
                const isSelected = activeSelection != null && player != null && activeSelection.playerId === player.id;
                let eligible = false;
                if (activeSelection && !isSelected && enabled && team.data?.destinations?.[String(activeSelection.playerId)]?.includes(slot.id)) {
                  try { validateMove(snapshot, { playerId: activeSelection.playerId, destinationSlotId: slot.id, revision: activeSelection.revision }, new Date(), cutoff); eligible = true; }
                  catch { /* Both players and the applicable locks must pass. */ }
                }
                const disabled = !enabled || (activeSelection != null ? !eligible && !isSelected : !player || player.locked);
                return <button type="button" key={slot.id} disabled={disabled} aria-pressed={isSelected}
                  className={`my-team-row${eligible ? ' eligible' : ''}${isSelected ? ' selected' : ''}`}
                  onClick={() => {
                    if (isSelected) { setSelected(null); return; }
                    if (activeSelection && eligible) { void move({ playerId: activeSelection.playerId, destinationSlotId: slot.id, revision: activeSelection.revision }); return; }
                    if (player) setSelected({ playerId: player.id, revision: snapshot.revision });
                  }}>
                  <span className="my-team-slot">{slot.label}</span><span className="my-team-player">{player?.name ?? 'Empty slot'}</span>
                  <span className="my-team-row-state">{player?.locked ? 'Locked' : isSelected ? 'Selected' : eligible ? 'Eligible destination' : ''}{player && <span className="my-team-lock-detail">{player.lockAt ? `Lock: ${new Date(player.lockAt).toLocaleString()}` : 'Lock details unavailable'}</span>}</span>
                </button>;
              })}
            </div></section>)}
            <p className="my-team-footnote">Last roster check: {new Date(snapshot.fetchedAt).toLocaleString()}. {team.data?.executionEnabled ? 'Eligibility and locks are checked again before execution.' : 'Unavailable lock details do not imply that a player is unlocked.'}</p>
          </>}
          {operation?.status === 'SUCCEEDED' && operation.undo && enabled && <button type="button" className="tap-btn" onClick={() => void move(operation.undo!)}>Undo, if still eligible</button>}
        </>}
  </main>;
}

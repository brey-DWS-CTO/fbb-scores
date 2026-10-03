import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DatasetPlayer, KeeperSelection, PickTradeProposal } from '../../lib/keeper/types.js';
import { deleteMockResult, fetchMockResults, fetchPickTrades, saveMockResult } from '../../lib/league/api.js';
import { gradeSummary, mockResultId } from '../../lib/league/mockGrade.js';
import MockGradeCard from './MockGradeCard.js';
import { useProjectionData } from '../../hooks/useProjectionData.js';
import { rankSourceLabel } from '../../lib/league/draftRankings.js';
import { valueBoard } from '../../lib/league/draftValue.js';
import {
  defaultMockSettings,
  keepersForMock,
  prepareMock,
  type MockMode,
} from '../../lib/league/mockDraft.js';
import { describeTrade } from '../../lib/league/pickTrades.js';
import { buildProjections, type PlayerProjection } from '../../lib/league/projections.js';
import { mockSaveKey, parseMockSave, type MockSave } from '../../lib/league/draftRoom.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import { buildWorld, privateTrades, switchableTrades, tradeConflicts } from '../../lib/league/whatIf.js';
import { useDraftData, useIdentity, useKeeperScenario } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';
import DraftRoom, { type RoomProgress } from './DraftRoom.js';
import type { MockGrade } from '../../lib/league/mockGrade.js';
import NavIcon from './NavIcon.js';

/** This person's saved mock draft, or null. Storage can be off; that is no save. */
function readSave(owner: string | null): MockSave | null {
  if (!owner) return null;
  try {
    return parseMockSave(window.localStorage.getItem(mockSaveKey(owner)));
  } catch {
    return null;
  }
}

/** What a room is called on screen. The stored name stays `realistic` so saved drafts still load. */
const roomLabel = (mode: MockMode) => (mode === 'sharp' ? 'sharp' : 'normal');

function KeeperTag({ status }: { status: 'known' | 'assumed' }) {
  return (
    <span className={`mock-tag ${status === 'known' ? 'mock-tag-known' : 'mock-tag-assumed'}`}>
      {status === 'known' ? 'keeper' : 'projected'}
    </span>
  );
}

/**
 * The mock draft: you draft live against nine computer teams, with your
 * projections of other teams' keepers and your pending trades as switches.
 *
 * One mock per person: switching who you are (Act As, or back) starts the
 * page over with that person's own draft.
 */
export default function MockDraftPage() {
  const { identity } = useIdentity();
  return <MockDraftScreen key={identity?.owner ?? 'anon'} />;
}

function MockDraftScreen() {
  const { identity } = useIdentity();
  const { state, dataset, meta } = useDraftData();
  const scenarioQuery = useKeeperScenario();
  const viewer = identity?.owner ?? null;
  const isCommish = identity?.isCommissioner === true;
  const signedIn = viewer !== null;

  // ESPN's numbers with the commissioner's projection edits laid over them.
  const { snapshot, original, edits } = useProjectionData();
  const tradesQuery = useQuery({
    queryKey: ['pick-trades', viewer ?? 'anon'],
    queryFn: () => fetchPickTrades(identity as NonNullable<typeof identity>),
    enabled: signedIn,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  // Each person's mock draft is kept on their own device, so leaving the page
  // and coming back finds it where it was.
  // A mock run while acting as someone is never saved: it ends when you switch back.
  const acting = Boolean(identity?.impersonatedBy);
  const [saved] = useState(() => (acting ? null : readSave(viewer)));
  const [mode, setMode] = useState<MockMode>(saved?.mode ?? 'sharp');
  const [seed, setSeed] = useState(saved?.seed ?? 7);
  const [tradesOn, setTradesOn] = useState<string[]>(saved?.tradesOn ?? []);
  const [tryKeepers, setTryKeepers] = useState(saved?.tryKeepers ?? false);
  const [tryPicks, setTryPicks] = useState<[string, string]>(saved?.tryPicks ?? ['', '']);
  const [useEntered, setUseEntered] = useState(saved?.useEntered ?? true);
  const [guessInstead, setGuessInstead] = useState<string[]>(saved?.guessInstead ?? []);
  const [progress, setProgress] = useState<RoomProgress | null>(() => (saved
    ? { started: saved.started, choices: saved.choices, queue: saved.queue, clockLeft: saved.clockLeft }
    : null));
  const onProgress = useCallback((next: RoomProgress) => setProgress(next), []);

  // Finished mocks, graded and kept on the server for this person.
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ['mock-results', viewer ?? 'anon'],
    queryFn: () => fetchMockResults(identity as NonNullable<typeof identity>),
    enabled: identity !== null,
    staleTime: 30_000,
  });
  const onFinished = useCallback((finished: { choices: Record<number, string>; grade: MockGrade }) => {
    if (!identity) return;
    const id = mockResultId(identity.owner, seed, mode, finished.choices);
    void saveMockResult(identity, { id, seed, mode, grade: finished.grade })
      .then(() => queryClient.invalidateQueries({ queryKey: ['mock-results'] }))
      .catch(() => { /* the grade still shows; it just is not kept */ });
  }, [identity, seed, mode, queryClient]);
  const forget = (id: string) => {
    if (!identity) return;
    void deleteMockResult(identity, id).then(() => queryClient.invalidateQueries({ queryKey: ['mock-results'] }));
  };
  const [openResult, setOpenResult] = useState<string | null>(null);
  useEffect(() => {
    if (!viewer || acting) return;
    const save: MockSave = {
      version: 1,
      seed,
      mode,
      started: progress?.started ?? false,
      choices: progress?.choices ?? {},
      queue: progress?.queue ?? [],
      clockLeft: progress?.clockLeft ?? null,
      tradesOn,
      tryKeepers,
      tryPicks,
      useEntered,
      guessInstead,
    };
    try {
      window.localStorage.setItem(mockSaveKey(viewer), JSON.stringify(save));
    } catch {
      /* no storage: the draft just does not survive leaving */
    }
  }, [viewer, acting, seed, mode, progress, tradesOn, tryKeepers, tryPicks, useEntered, guessInstead]);
  const toggleGuessInstead = (owner: string) =>
    setGuessInstead((current) => (current.includes(owner) ? current.filter((entry) => entry !== owner) : [...current, owner]));

  const fetchedProposals = tradesQuery.data?.proposals;
  const proposals = useMemo((): PickTradeProposal[] => fetchedProposals ?? [], [fetchedProposals]);
  const scenario = scenarioQuery.scenario;

  const values = useMemo(
    () => valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027, projectionsOnly: true }),
    [dataset.players, snapshot],
  );

  // Every player's projected line, for the room's player list and card.
  const projections = useMemo((): ReadonlyMap<string, PlayerProjection> => {
    const kept = keepersForMock(dataset, { viewer, state, scenario: scenarioQuery.scenario, useEntered: true });
    return new Map(buildProjections(values, snapshot, kept, edits, original).map((row) => [row.key, row]));
  }, [dataset, viewer, state, scenarioQuery.scenario, values, snapshot, edits, original]);

  const ownCandidates = useMemo(
    () => viewer
      ? dataset.players
        .filter((player) => player.fantasyTeam === viewer && player.keeper.eligible)
        .sort((a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1))
      : [],
    [dataset.players, viewer],
  );
  const ownKeepers = useMemo((): KeeperSelection[] | null => {
    if (!tryKeepers) return null;
    const byKey = new Map(ownCandidates.map((player) => [player.key, player]));
    return tryPicks
      .filter((key, index) => key !== '' && tryPicks.indexOf(key) === index)
      .map((key) => byKey.get(key))
      .filter((player): player is DatasetPlayer => player !== undefined)
      .map((player) => ({ playerKey: player.key, playerName: player.name }));
  }, [ownCandidates, tryKeepers, tryPicks]);

  const now = useMemo(
    () => buildWorld(dataset, { viewer, state, scenario, proposals, tradesOn: [], useEntered, guessInstead }),
    [dataset, viewer, state, scenario, proposals, useEntered, guessInstead],
  );
  const whatIf = useMemo(
    () => buildWorld(dataset, { viewer, state, scenario, proposals, tradesOn, ownKeepers, useEntered, guessInstead }),
    [dataset, viewer, state, scenario, proposals, tradesOn, ownKeepers, useEntered, guessInstead],
  );

  const owners = useMemo(() => dataset.teams.map((team) => team.owner), [dataset.teams]);
  const settings = useMemo(() => defaultMockSettings(mode, owners, seed), [mode, owners, seed]);
  const canRun = values.entries.length > 0;
  const livePrepared = useMemo(
    () => (canRun ? prepareMock({ board: whatIf.board, values, settings }) : null),
    [canRun, whatIf.board, values, settings],
  );
  // A different board, room or seed is a different draft: remount the live one.
  const liveKey = useMemo(
    () => `${seed}:${mode}:${whatIf.board.slots.map((slot) =>
      `${slot.pick.currentOwner}${slot.keeper ? '=' + slot.keeper.playerKey : slot.made ? '+' + slot.made.playerKey : ''}`).join(',')}`,
    [seed, mode, whatIf.board],
  );

  if (!viewer) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>SIGN IN</div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Sign in to run a mock draft.
          </div>
        </div>
      </div>
    );
  }

  const switchable = switchableTrades(proposals);
  const hidden = privateTrades(proposals);
  const conflicts = tradeConflicts(proposals);
  const revealed = meta?.revealed === true || state.keepersRevealed === true;
  const guessRows = owners
    .filter((owner) => owner !== viewer)
    .map((owner) => ({
      owner,
      keepers: now.board.slots.filter((slot) => slot.pick.currentOwner === owner && slot.keeper).map((slot) => slot.keeper!),
      entered: (state.keepers[owner]?.length ?? 0) > 0,
      guess: scenario[owner] ?? [],
      rejected: now.board.rejected.find((entry) => entry.owner === owner) ?? null,
    }));
  const enteredCount = guessRows.filter((row) => row.entered).length;

  const toggleTrade = (id: string) =>
    setTradesOn((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const keptCounts = guessRows.reduce(
    (sum, row) => {
      for (const keeper of row.keepers) sum[keeper.status] += 1;
      return sum;
    },
    { known: 0, assumed: 0 },
  );
  const setupSummary = [
    `Their keepers: ${keptCounts.known} real, ${keptCounts.assumed} projected`,
    whatIf.applied.length > 0 ? `${whatIf.applied.length} trade${whatIf.applied.length === 1 ? '' : 's'} on` : 'no trades on',
    ownKeepers !== null ? 'trying a different pair of your own' : null,
  ].filter(Boolean).join(' · ');

  // Before a live draft starts, the setup sits on top and open: keepers and
  // trades change the board, and changing them later restarts the draft.
  const setupFirst = !progress?.started;
  const setup = (
      <details key={setupFirst ? 'before' : 'after'} className={`commish-fold mock-setup${setupFirst ? ' is-before' : ''}`} open={setupFirst}>
        <summary className="hub-heading">
          DRAFT SETUP
          <small>{setupSummary}</small>
        </summary>
        <section className="panel mock-assumptions">
        <div className="hub-heading mock-sub">THEIR KEEPERS</div>
        {/* Members never see others' entered keepers before the reveal. */}
        {!revealed && isCommish && (
          <>
            <label className="mock-use-entered">
              <input type="checkbox" checked={useEntered} onChange={(event) => setUseEntered(event.target.checked)} />
              <span>
                Use what teams have already entered ({enteredCount} of {guessRows.length} so far). Your projections cover the rest.
              </span>
            </label>
            <div className="mock-note mock-note-dim">
              {useEntered
                ? 'Entered picks are tagged KEEPER, your projections PROJECTED. Only you can see the entered ones before the reveal. PROJECT opens the projection screen for that team.'
                : 'Both worlds use your projections only, never what anyone has entered. PROJECT opens the projection screen for that team.'}
            </div>
          </>
        )}
        <ul className="mock-guesses">
          {guessRows.map((row) => (
            <li key={row.owner}>
              <div className="mock-guess-head">
                <span className="mock-guess-owner">{row.owner}</span>
                {!revealed && (
                  <Link className="mock-edit" to={`/keepers/${encodeURIComponent(row.owner)}`} state={{ from: 'mock' }}>
                    {row.guess.length > 0 ? 'edit projection' : 'project'}
                  </Link>
                )}
              </div>
              <span className="mock-guess-players">
                {row.keepers.length === 0
                  ? <span className="mock-live">{revealed ? 'none' : row.entered && useEntered ? 'entered, but the picks stay live' : 'not projected'}</span>
                  : row.keepers.map((keeper) => (
                    <span key={keeper.playerKey}>{keeper.playerName} <KeeperTag status={keeper.status} /></span>
                  ))}
                {row.rejected && <small className="mock-note-bad">{row.rejected.errors.join(' ')}</small>}
                {!revealed && useEntered && row.entered && (
                  <label className="mock-guess-instead">
                    <input
                      type="checkbox"
                      checked={guessInstead.includes(row.owner)}
                      onChange={() => toggleGuessInstead(row.owner)}
                    />
                    <span>
                      use my projection instead
                      {guessInstead.includes(row.owner)
                        ? ' (entered picks set aside)'
                        : row.guess.length > 0 ? ` (${row.guess.map((k) => k.playerName).join(', ')})` : ''}
                    </span>
                  </label>
                )}
              </span>
            </li>
          ))}
        </ul>
          <div className="hub-heading mock-sub">PENDING TRADES</div>
          {switchable.length === 0 && (
            <div className="mock-note">
              No pending offer of yours to try. <Link to="/trades">Send one</Link> and it shows up here as a switch.
            </div>
          )}
          <ul className="mock-switches">
            {switchable.map((proposal) => {
              const on = tradesOn.includes(proposal.id);
              const blockedBy = (conflicts.get(proposal.id) ?? []).find((other) => tradesOn.includes(other));
              const blocker = blockedBy ? proposals.find((entry) => entry.id === blockedBy) : null;
              return (
                <li key={proposal.id} className={blockedBy && !on ? 'is-blocked' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!!blockedBy && !on}
                      onChange={() => toggleTrade(proposal.id)}
                    />
                    <span>
                      <strong>{proposal.proposer} to {proposal.recipient}:</strong> {describeTrade(proposal, dataset)}
                      {blockedBy && !on && blocker && (
                        <small> Moves a pick the {blocker.proposer} to {blocker.recipient} offer already moves. Only one can be on.</small>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {hidden.length > 0 && (
            <div className="mock-note mock-note-dim">
              {hidden.map((proposal) => `${proposal.proposer} and ${proposal.recipient}`).join('; ')} have an offer open. The picks are private to them, so it cannot be switched here.
            </div>
          )}

          <div className="hub-heading mock-sub">YOUR KEEPERS</div>
          <div className="mock-own">
            <label>
              <input type="radio" name="mock-own" checked={!tryKeepers} onChange={() => setTryKeepers(false)} />
              <span>My real picks{state.keepers[viewer]?.length ? ` (${state.keepers[viewer].map((k) => k.playerName).join(', ')})` : ' (none yet)'}</span>
            </label>
            <label>
              <input type="radio" name="mock-own" checked={tryKeepers} onChange={() => setTryKeepers(true)} />
              <span>Try a different pair</span>
            </label>
            {tryKeepers && (
              <div className="mock-own-picks">
                {[0, 1].map((index) => (
                  <select
                    key={index}
                    className="hub-input mock-select"
                    aria-label={`Keeper ${index + 1}`}
                    value={tryPicks[index]}
                    onChange={(event) => {
                      const next: [string, string] = [...tryPicks] as [string, string];
                      next[index] = event.target.value;
                      setTryPicks(next);
                    }}
                  >
                    <option value="">Nobody</option>
                    {ownCandidates.map((player) => (
                      <option key={player.key} value={player.key}>
                        {player.name} · R{player.keeper.round ?? '?'} · {player.keeper.effectiveAvg?.toFixed(1) ?? '–'}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            )}
          </div>
        </section>
      </details>
  );

  return (
    <div className="mock-page">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
          <NavIcon name="target" size={16} className="icon-in-heading" />
          MOCK DRAFT
        </h1>
        <IdentityChip />
      </div>
      <div className="mock-intro">
        Draft against nine teams valued on ESPN&apos;s {rankSourceLabel('projection', dataset.season)}s in our scoring.
        {values.counts.projection === 0 && (
          <> ESPN projections are not saved yet, so nobody can be valued.{' '}
            {isCommish ? <Link to="/admin">Update from ESPN in Commish Mode.</Link> : 'The commish will load them soon.'}</>
        )}
      </div>

      {/* Once a draft is under way the switch only gets in the way. */}
      {!progress?.started && (
      <section className="panel mock-controls">
        <div className="mock-control">
          <span className="hub-heading mock-control-label">ROOM</span>
          <div className="mock-seg" role="radiogroup" aria-label="How the room drafts">
            {(['sharp', 'realistic'] as MockMode[]).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={mode === choice}
                className={`tap-btn mock-seg-btn${mode === choice ? ' is-on' : ''}`}
                title={choice === 'realistic'
                  ? 'Teams draft mostly by ADP, the way most rooms do.'
                  : 'Teams draft by our projections, and mark down a little the players whose numbers swing.'}
                onClick={() => setMode(choice)}
              >
                {roomLabel(choice).toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>
      )}

      {setupFirst && setup}

      {livePrepared ? (
        <DraftRoom
          key={liveKey}
          prepared={livePrepared}
          values={values}
          projections={projections}
          person={viewer}
          seed={seed}
          saved={progress}
          onProgress={onProgress}
          onFinished={onFinished}
          onNewDraft={() => {
            setProgress(null);
            setSeed(Math.floor(Math.random() * 100_000));
          }}
        />
      ) : (
        <div className="mock-note">No players to draft yet.</div>
      )}

      {!setupFirst && setup}

      <details className="commish-fold mock-history">
        <summary className="hub-heading">
          PAST MOCKS ({historyQuery.data?.length ?? 0})
          <small>{isCommish ? 'Every mock you finish is kept.' : 'Your last ten finished mocks.'}</small>
        </summary>
        {(historyQuery.data ?? []).length === 0 ? (
          <div className="mock-note">Finish a mock draft and its grade lands here.</div>
        ) : (
          <ol className="mock-history-list">
            {(historyQuery.data ?? []).map((record) => (
              <li key={record.id} className="panel">
                <button type="button" className="mock-history-row" aria-expanded={openResult === record.id} onClick={() => setOpenResult(openResult === record.id ? null : record.id)}>
                  <span className={`mock-grade-letter grade-${record.grade.grade[0].toLowerCase()}`}>{record.grade.grade}</span>
                  <span className="mock-history-line">
                    {gradeSummary(record.grade)}
                    <small>{new Date(record.finishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {roomLabel(record.mode)} room</small>
                  </span>
                </button>
                {openResult === record.id && (
                  <>
                    <MockGradeCard grade={record.grade} person={record.owner} />
                    <button type="button" className="tap-btn mock-mini-btn" onClick={() => forget(record.id)}>FORGET THIS ONE</button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

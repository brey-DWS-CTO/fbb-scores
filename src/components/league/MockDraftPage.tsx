import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DatasetPlayer, KeeperSelection, PickTradeProposal } from '../../lib/keeper/types.js';
import { fetchDraftRankings, fetchPickTrades } from '../../lib/league/api.js';
import { rankSourceLabel } from '../../lib/league/draftRankings.js';
import { valueBoard } from '../../lib/league/draftValue.js';
import {
  availabilityAt,
  defaultMockSettings,
  simulateMany,
  type MockDraftResult,
  type MockMode,
  type MockSlot,
} from '../../lib/league/mockDraft.js';
import { describeTrade } from '../../lib/league/pickTrades.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import { buildWorld, privateTrades, switchableTrades, tradeConflicts, type World } from '../../lib/league/whatIf.js';
import { useDraftData, useIdentity, useKeeperScenario } from '../../hooks/useLeague.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';

const RUN_CHOICES = [100, 200, 500] as const;
const ROWS_SHOWN = 12;

const pct = (share: number) => `${Math.round(share * 100)}%`;
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** The viewer's picks in a world, best first. */
function ownPicks(world: World, viewer: string): MockSlot[] {
  return world.board.slots
    .filter((slot) => slot.pick.currentOwner === viewer)
    .sort((a, b) => a.pick.overall - b.pick.overall);
}

/** Who a run took at a pick, or null when the slot was a keeper or empty. */
function sampleTake(run: MockDraftResult | null, overall: number): string | null {
  const pick = run?.picks.find((entry) => entry.overall === overall);
  return pick && pick.how === 'pick' ? pick.playerName : null;
}

function KeeperTag({ status }: { status: 'known' | 'assumed' }) {
  return (
    <span className={`mock-tag ${status === 'known' ? 'mock-tag-known' : 'mock-tag-assumed'}`}>
      {status === 'known' ? 'keeper' : 'guess'}
    </span>
  );
}

interface WorldColumnProps {
  title: string;
  color: string;
  world: World;
  results: MockDraftResult[] | null;
  viewer: string;
  watchIndex: number;
  children?: React.ReactNode;
}

function WorldColumn({ title, color, world, results, viewer, watchIndex, children }: WorldColumnProps) {
  const mine = ownPicks(world, viewer);
  const live = mine.filter((slot) => !slot.keeper && !slot.made);
  const watched = live[Math.min(watchIndex, Math.max(live.length - 1, 0))] ?? mine[0] ?? null;
  const report = useMemo(
    () => (results && results.length > 0 && watched ? availabilityAt(results, watched.pick.overall) : null),
    [results, watched],
  );
  const sample = results?.[0] ?? null;
  const roundOne = world.board.slots.filter((slot) => slot.pick.round === 1);
  const rows = report?.rows.filter((row) => row.availableShare >= 0.005).slice(0, ROWS_SHOWN) ?? [];
  const takes = report
    ? [...report.rows].filter((row) => row.takenHere > 0).sort((a, b) => b.takenHere - a.takenHere).slice(0, 3)
    : [];
  const warnings = results ? results.reduce((sum, run) => sum + run.warnings.length, 0) : 0;

  return (
    <section className="panel mock-world" style={{ '--world-color': color } as React.CSSProperties}>
      <div className="hub-heading mock-world-title">{title}</div>
      {children}

      {world.resets.length > 0 && (
        <div className="mock-note mock-note-warn">
          {world.resets.map((reset) => (
            <div key={`${reset.proposalId}-${reset.owner}`}>
              <NavIcon name="warning" size={13} className="icon-in-heading" />
              {reset.owner}&apos;s {reset.status === 'known' ? 'keepers' : 'guessed keepers'} reset
              {reset.players.length > 0 ? ` (${reset.players.join(', ')})` : ''}: the trade moves the pick paying for them.
            </div>
          ))}
        </div>
      )}
      {world.skipped.filter((entry) => entry.reason !== 'private').map((entry) => (
        <div key={entry.id} className="mock-note mock-note-warn">{entry.message}</div>
      ))}
      {world.board.rejected.map((rejected) => (
        <div key={rejected.owner} className="mock-note mock-note-bad">
          {rejected.owner}&apos;s {rejected.status === 'known' ? 'keepers' : 'guessed keepers'} do not fit the rules, so the picks stay live: {rejected.errors.join(' ')}
        </div>
      ))}

      <div className="hub-heading mock-sub">ROUND ONE</div>
      <ol className="mock-slots">
        {roundOne.map((slot) => {
          const isMine = slot.pick.currentOwner === viewer;
          const took = sampleTake(sample, slot.pick.overall);
          return (
            <li key={slot.pick.overall} className={isMine ? 'mock-slot mock-slot-mine' : 'mock-slot'}>
              <span className="mock-slot-label">{slot.pick.round}.{slot.pick.slot}</span>
              <span className="mock-slot-owner">
                {slot.pick.currentOwner}
                {slot.pick.viaTradeFrom && <small> via {slot.pick.viaTradeFrom}</small>}
              </span>
              <span className="mock-slot-player">
                {slot.keeper ? (
                  <>
                    {slot.keeper.playerName} <KeeperTag status={slot.keeper.status} />
                  </>
                ) : slot.made ? (
                  <>{slot.made.playerName} <span className="mock-tag mock-tag-known">picked</span></>
                ) : (
                  <>
                    <span className="mock-live">live</span>
                    {took && <small className="mock-sample"> one run: {took}</small>}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {watched && (
        <>
          <div className="hub-heading mock-sub">
            LIKELY THERE AT {watched.pick.round}.{watched.pick.slot}
            <small>your {ordinal(Math.min(watchIndex, Math.max(live.length - 1, 0)) + 1)} live pick{watched.keeper ? ', a keeper slot' : ''}</small>
          </div>
          {!results && <div className="mock-note">No players to draft yet.</div>}
          {report && (
            <>
              <ul className="mock-odds">
                {rows.map((row) => (
                  <li key={row.playerKey}>
                    <span className="mock-odds-rank">{row.valueRank}</span>
                    <span className="mock-odds-name">
                      {row.playerName}
                      <small>{row.positions.join('/')}</small>
                    </span>
                    <span className="mock-odds-bar" aria-hidden="true">
                      <span style={{ width: pct(row.availableShare) }} />
                    </span>
                    <span className="mock-odds-pct">{pct(row.availableShare)}</span>
                  </li>
                ))}
              </ul>
              {takes.length > 0 && (
                <div className="mock-note">
                  You most often take {takes.map((row) => `${row.playerName} ${pct(row.takenHereShare)}`).join(', ')}.
                </div>
              )}
              <div className="mock-note mock-note-dim">
                {report.runs} drafts. A number is how often the player was still on the board when this pick came up.
                {warnings > 0 && ` ${warnings} lineup warnings across the runs.`}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Commissioner tool: the mock draft. Round one as it stands, your guesses at
 * other teams' keepers, pending trades as switches, and how often each player
 * is still there at your pick across many seeded drafts. Two worlds side by
 * side, so "if I keep Cade" can sit next to "if I make this trade".
 */
export default function MockDraftPage() {
  const { identity } = useIdentity();
  const { state, dataset, meta } = useDraftData();
  const scenarioQuery = useKeeperScenario();
  const viewer = identity?.owner ?? null;
  const isCommish = identity?.isCommissioner === true;

  const rankingsQuery = useQuery({
    queryKey: ['mock-draft-rankings', viewer ?? 'anon', meta?.draftRankings?.activeSnapshotId ?? 'none'],
    queryFn: () => fetchDraftRankings(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 30_000,
  });
  const tradesQuery = useQuery({
    queryKey: ['pick-trades', viewer ?? 'anon'],
    queryFn: () => fetchPickTrades(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const [mode, setMode] = useState<MockMode>('realistic');
  const [runs, setRuns] = useState<number>(200);
  const [seed, setSeed] = useState(7);
  const [watchIndex, setWatchIndex] = useState(0);
  const [tradesOn, setTradesOn] = useState<string[]>([]);
  const [tryKeepers, setTryKeepers] = useState(false);
  const [tryPicks, setTryPicks] = useState<[string, string]>(['', '']);

  const snapshot = rankingsQuery.data?.snapshot ?? null;
  const fetchedProposals = tradesQuery.data?.proposals;
  const proposals = useMemo((): PickTradeProposal[] => fetchedProposals ?? [], [fetchedProposals]);
  const scenario = scenarioQuery.scenario;

  const values = useMemo(
    () => valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027 }),
    [dataset.players, snapshot],
  );

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
    () => buildWorld(dataset, { viewer, state, scenario, proposals, tradesOn: [] }),
    [dataset, viewer, state, scenario, proposals],
  );
  const whatIf = useMemo(
    () => buildWorld(dataset, { viewer, state, scenario, proposals, tradesOn, ownKeepers }),
    [dataset, viewer, state, scenario, proposals, tradesOn, ownKeepers],
  );

  const owners = useMemo(() => dataset.teams.map((team) => team.owner), [dataset.teams]);
  const settings = useMemo(() => defaultMockSettings(mode, owners, seed), [mode, owners, seed]);
  const canRun = values.entries.length > 0;
  const nowRuns = useMemo(
    () => (canRun ? simulateMany({ board: now.board, values, settings }, runs) : null),
    [canRun, now.board, values, settings, runs],
  );
  const whatIfRuns = useMemo(
    () => (canRun ? simulateMany({ board: whatIf.board, values, settings }, runs) : null),
    [canRun, whatIf.board, values, settings, runs],
  );

  if (!isCommish || !viewer) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>COMMISH ONLY</div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            The mock draft is the commish&apos;s for now.
          </div>
        </div>
      </div>
    );
  }

  const switchable = switchableTrades(proposals);
  const hidden = privateTrades(proposals);
  const conflicts = tradeConflicts(proposals);
  const revealed = meta?.revealed === true || state.keepersRevealed === true;
  const myLivePicks = ownPicks(now, viewer).filter((slot) => !slot.keeper && !slot.made);
  const guessRows = owners
    .filter((owner) => owner !== viewer)
    .map((owner) => ({
      owner,
      keepers: now.board.slots.filter((slot) => slot.pick.currentOwner === owner && slot.keeper).map((slot) => slot.keeper!),
    }));

  const toggleTrade = (id: string) =>
    setTradesOn((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const whatIfLabel = [
    whatIf.applied.length > 0 ? `${whatIf.applied.length} trade${whatIf.applied.length === 1 ? '' : 's'} on` : null,
    ownKeepers !== null ? (ownKeepers.length > 0 ? `you keep ${ownKeepers.map((k) => k.playerName).join(' and ')}` : 'you keep nobody') : null,
  ].filter(Boolean).join(', ');

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
        Nine other teams draft against you on {mode === 'sharp' ? 'our value model' : 'ESPN’s draft position, the way a real room reaches'}.
        Values come from {rankSourceLabel(values.primary, dataset.season)} in this league&apos;s scoring.
        {!snapshot?.players.length && (
          <> No ESPN numbers are accepted yet, so everyone is valued on last season. <Link to="/admin">Fetch them in Commish Mode.</Link></>
        )}
        {' '}Nothing on this page is saved.
      </div>

      <section className="panel mock-controls">
        <div className="mock-control">
          <span className="hub-heading mock-control-label">ROOM</span>
          <div className="mock-seg" role="radiogroup" aria-label="How the room drafts">
            {(['realistic', 'sharp'] as MockMode[]).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={mode === choice}
                className={`tap-btn mock-seg-btn${mode === choice ? ' is-on' : ''}`}
                onClick={() => setMode(choice)}
              >
                {choice === 'realistic' ? 'REALISTIC' : 'SHARP'}
              </button>
            ))}
          </div>
        </div>
        <div className="mock-control">
          <label className="hub-heading mock-control-label" htmlFor="mock-runs">DRAFTS</label>
          <select id="mock-runs" className="hub-input mock-select" value={runs} onChange={(event) => setRuns(Number(event.target.value))}>
            {RUN_CHOICES.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </div>
        <div className="mock-control">
          <label className="hub-heading mock-control-label" htmlFor="mock-seed">SEED</label>
          <input
            id="mock-seed"
            className="hub-input mock-select"
            type="number"
            inputMode="numeric"
            value={seed}
            onChange={(event) => setSeed(Number(event.target.value) || 0)}
          />
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => setSeed(Math.floor(Math.random() * 100_000))}>
            NEW
          </button>
        </div>
        <div className="mock-control">
          <label className="hub-heading mock-control-label" htmlFor="mock-watch">WATCH</label>
          <select id="mock-watch" className="hub-input mock-select" value={watchIndex} onChange={(event) => setWatchIndex(Number(event.target.value))}>
            {(myLivePicks.length > 0 ? myLivePicks : ownPicks(now, viewer)).slice(0, 6).map((slot, index) => (
              <option key={slot.pick.overall} value={index}>
                Your {ordinal(index + 1)} live pick ({slot.pick.round}.{slot.pick.slot} now)
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel mock-assumptions">
        <div className="hub-heading mock-sub" style={{ marginTop: 0 }}>
          {revealed ? 'KEEPERS' : 'YOUR GUESSES AT THEIR KEEPERS'}
        </div>
        {!revealed && (
          <div className="mock-note mock-note-dim">
            Keepers are secret until the reveal. Both worlds use your private guesses, never anyone&apos;s real picks.
            Edit a guess on that team&apos;s keeper page.
          </div>
        )}
        <ul className="mock-guesses">
          {guessRows.map((row) => (
            <li key={row.owner}>
              <span className="mock-guess-owner">{row.owner}</span>
              <span className="mock-guess-players">
                {row.keepers.length === 0
                  ? <span className="mock-live">{revealed ? 'none' : 'no guess'}</span>
                  : row.keepers.map((keeper) => (
                    <span key={keeper.playerKey}>{keeper.playerName} <KeeperTag status={keeper.status} /></span>
                  ))}
              </span>
              {!revealed && <Link className="mock-edit" to={`/keepers/${encodeURIComponent(row.owner)}`}>edit</Link>}
            </li>
          ))}
        </ul>
      </section>

      <div className="mock-worlds">
        <WorldColumn title="AS THINGS STAND" color="var(--neon-teal)" world={now} results={nowRuns} viewer={viewer} watchIndex={watchIndex}>
          <div className="mock-note mock-note-dim">
            Your real keepers{state.keepers[viewer]?.length ? ` (${state.keepers[viewer].map((k) => k.playerName).join(', ')})` : ' (none yet)'}, no pending trades.
          </div>
        </WorldColumn>

        <WorldColumn title="WHAT IF" color="var(--neon-purple)" world={whatIf} results={whatIfRuns} viewer={viewer} watchIndex={watchIndex}>
          <div className="mock-note mock-note-dim">{whatIfLabel || 'Same as the left until you switch something on.'}</div>

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

          <div className="hub-heading mock-sub">YOUR KEEPERS IN THIS WORLD</div>
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
        </WorldColumn>
      </div>
    </div>
  );
}

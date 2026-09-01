import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DatasetPlayer, KeeperSelection, ResolvedKeeper } from '../../lib/keeper/types.js';
import { keeperCandidateError, pickLabel, resolveTeamKeepers } from '../../lib/keeper/engine.js';
import { OWNERS, teamByOwner } from '../../lib/league/data.js';
import {
  apiErrorMessage,
  resetKeeperScenarioTarget,
  saveKeeperScenarioTarget,
  saveKeepers,
} from '../../lib/league/api.js';
import { fmt1 } from '../../lib/league/format.js';
import {
  useApplyStateResponse,
  useIdentity,
  useKeeperScenario,
  useLeagueData,
} from '../../hooks/useLeague.js';
import IdentityChip from '../league/IdentityChip.js';
import PlayerCombobox from '../league/PlayerCombobox.js';
import { CapBar, LockBanner, RoundChip, SourceBadge } from './keeperUi.js';

const selKey = (sels: KeeperSelection[]) => sels.map((s) => `${s.playerKey}~${s.playerName}`).join('|');

/** One tappable roster row — mobile-first, no horizontal scroll. */
function RosterRow({
  p,
  season,
  selected,
  canEdit,
  reason,
  tapThrough,
  onTap,
}: {
  p: DatasetPlayer;
  season: number;
  selected: boolean;
  canEdit: boolean;
  reason: string | null;
  /** Blocked only by the cap: keep the greyed look but let the tap land. */
  tapThrough?: boolean;
  onTap: () => void;
}) {
  const s = p.stats2026 ?? p.api2026;
  const apiFallback = !p.stats2026 && !!p.api2026;
  const eff = p.keeper.effectiveAvg;
  const effDiff = eff != null && (!s || Math.abs(eff - s.avg) > 0.05);
  const c = p.keeper.contract;
  const expired = !!c && (c.expired || c.lastKeepableSeason < season);
  const tappable = canEdit && (selected || reason === null || !!tapThrough);
  // Keep the pre-tap look of a blocked row: no plus sign, dimmed, no pointer.
  const looksBlocked = !selected && reason !== null;
  return (
    <button
      className={tappable ? 'tap-btn' : undefined}
      onClick={() => tappable && onTap()}
      disabled={!tappable}
      aria-pressed={selected}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 14px',
        background: selected ? 'rgba(0,255,204,0.07)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--panel-border)',
        boxShadow: selected ? 'inset 3px 0 0 var(--neon-teal)' : undefined,
        cursor: tappable && !looksBlocked ? 'pointer' : 'default',
        opacity: looksBlocked ? 0.45 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: selected ? 'var(--neon-teal)' : 'var(--text-hi)' }}>
          {selected && '✓ '}
          {p.name}
        </div>
        <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{p.positions.join('/')}</span>
          {s && (
            <span>
              {s.avg.toFixed(1)}
              {apiFallback ? '°' : ''} avg · {s.gp}gp
            </span>
          )}
          {effDiff && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--neon-yellow)', fontWeight: 700 }}>keeps at {fmt1(eff)}</span>
              <SourceBadge info={p.keeper} compact />
            </span>
          )}
        </div>
        {!selected && reason && (
          <div style={{ color: 'var(--neon-red)', fontSize: '0.68rem', marginTop: 2 }}>{reason}</div>
        )}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        {p.keeper.round !== null && <RoundChip round={p.keeper.round} />}
        {c && (
          <span style={{ fontSize: '0.65rem', color: expired ? 'var(--neon-red)' : 'var(--text-mid)', fontWeight: expired ? 700 : 400 }}>
            {expired ? 'EXPIRED' : `thru ${c.lastKeepableSeason}`}
          </span>
        )}
      </div>
      {tappable && !looksBlocked && (
        <span
          style={{
            flexShrink: 0,
            width: 28,
            textAlign: 'center',
            color: selected ? 'var(--neon-red)' : 'var(--neon-teal)',
            fontSize: '1.15rem',
            fontWeight: 700,
          }}
        >
          {selected ? '−' : '＋'}
        </span>
      )}
    </button>
  );
}

/** One selected-keeper card with pick cost, contract projection and errors. */
function KeeperCard({
  k,
  canEdit,
  projected = false,
  onRemove,
}: {
  k: ResolvedKeeper;
  canEdit: boolean;
  projected?: boolean;
  onRemove: () => void;
}) {
  const p = k.player;
  const name = p?.name ?? k.selection.playerName;
  return (
    <div
      className="panel"
      style={{
        padding: '9px 12px 10px',
        borderRadius: 10,
        borderStyle: projected ? 'dashed' : 'solid',
        borderColor: k.errors.length > 0 ? 'var(--neon-red)' : projected ? 'var(--neon-purple)' : 'var(--panel-border)',
        opacity: projected ? 0.82 : 1,
      }}
    >
      {projected && (
        <div
          className="hub-heading"
          style={{ color: 'var(--neon-purple)', fontSize: '0.58rem', marginBottom: 5 }}
        >
          PROJECTED · PRIVATE TO YOU
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-max)' }}>{name}</div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2, color: 'var(--text-mid)', fontSize: '0.72rem' }}>
            {p && (
              <span>
                {p.proTeam} · {p.positions.join('/')}
              </span>
            )}
            <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--neon-teal)' }}>
              {fmt1(k.effectiveAvg)}
            </span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>FPPG</span>
            {p && <SourceBadge info={p.keeper} compact />}
          </div>
        </div>
        {canEdit && (
          <button
            className="tap-btn"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              background: 'rgba(255,34,34,0.08)',
              border: '2px solid rgba(255,34,34,0.5)',
              borderRadius: 10,
              color: 'var(--neon-red)',
              fontSize: '0.95rem',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* the price tag — the single most important number on the card */}
      {k.round !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 8,
            padding: '6px 12px',
            background: 'rgba(255,230,0,0.07)',
            border: '1px solid rgba(255,230,0,0.4)',
            borderRadius: 8,
            flexWrap: 'wrap',
          }}
        >
          <span className="hub-heading" style={{ fontSize: '0.6rem', color: 'var(--neon-yellow)', opacity: 0.75 }}>
            COSTS
          </span>
          <span
            style={{ fontSize: '1.15rem', color: 'var(--neon-yellow)', fontWeight: 800, lineHeight: 1, letterSpacing: '0.02em' }}
          >
            {k.pick ? `PICK ${pickLabel(k.pick)}` : `A ROUND ${k.round} PICK`}
          </span>
          {k.pick?.viaTradeFrom && (
            <span style={{ color: 'var(--text-mid)', fontWeight: 500, fontSize: '0.72rem' }}>
              (from {k.pick.viaTradeFrom})
            </span>
          )}
        </div>
      )}

      <div
        style={{
          borderTop: '1px solid var(--panel-border)',
          marginTop: 8,
          paddingTop: 6,
          display: 'grid',
          gap: 3,
          fontSize: '0.75rem',
        }}
      >
        {k.bumped && (
          <div style={{ color: 'var(--neon-red)', fontSize: '0.75rem' }}>
            {k.bumpReason === 'traded'
              ? 'LOSER! You traded this pick and must use the next highest pick.'
              : 'Same tier twice — this one burns your next-better pick.'}
          </div>
        )}
        {k.contract && (
          <div style={{ color: 'var(--text-body)' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem', letterSpacing: '0.08em' }}>CONTRACT </span>
            {k.contract.isNew ? (
              <>
                NEW contract · R{k.contract.originalRound} tier · max through {k.contract.lastKeepableSeason}
              </>
            ) : (
              <>
                Contract year {k.contract.yearsUsedThrough2027} · keepable through{' '}
                {k.contract.lastKeepableSeason}
              </>
            )}
          </div>
        )}
        {k.errors.map((e) => (
          <div key={e} style={{ color: 'var(--neon-red)', fontSize: '0.78rem' }}>
            ⚠ {e}
          </div>
        ))}
      </div>
    </div>
  );
}

/** /keepers/:owner — one team's keeper worksheet (the old Excel sheet, but alive). */
export default function TeamKeeperPage() {
  const params = useParams();
  const owner = params.owner ?? '';
  const team = teamByOwner.get(owner);

  const { state, isLoading, meta, dataset } = useLeagueData();
  const { identity } = useIdentity();
  const scenarioQuery = useKeeperScenario();
  const applyState = useApplyStateResponse();

  const serverSelections = useMemo(() => state.keepers[owner] ?? [], [state.keepers, owner]);
  const isCommish = identity?.isCommissioner ?? false;
  const [commissionerRealEdit, setCommissionerRealEdit] = useState(false);
  const projectionMode = !!identity
    && identity.owner !== owner
    && meta?.revealed !== true
    && (!isCommish || !commissionerRealEdit);
  const projectedSelections = useMemo(
    () => scenarioQuery.scenario[owner] ?? [],
    [owner, scenarioQuery.scenario],
  );
  const [browseBannerOpen, setBrowseBannerOpen] = useState(true);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);

  // null = mirror the server; non-null = local unsaved edits (dirty)
  const [draftSel, setDraftSel] = useState<KeeperSelection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [leaguePool, setLeaguePool] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const flashTimer = useRef<number | null>(null);

  // Reset local edits when navigating between teams
  useEffect(() => {
    setDraftSel(null);
    setSaveError(null);
    setLeaguePool(false);
    setBrowseBannerOpen(true);
    setOwnerPickerOpen(false);
    setCommissionerRealEdit(false);
  }, [owner]);

  useEffect(() => {
    if (meta?.revealed) setDraftSel(null);
  }, [meta?.revealed]);

  // Local edits that exactly match the server are no longer "unsaved"
  useEffect(() => {
    const savedSelections = projectionMode ? projectedSelections : serverSelections;
    if (draftSel !== null && selKey(draftSel) === selKey(savedSelections)) setDraftSel(null);
  }, [draftSel, projectedSelections, projectionMode, serverSelections]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const savedSelections = projectionMode ? projectedSelections : serverSelections;
  const selections = draftSel ?? savedSelections;
  const dirty = draftSel !== null;

  const locked = state.locks.keepersLocked;
  const canEdit = !!identity && (
    (projectionMode && scenarioQuery.isSuccess)
    || ((identity.owner === owner || isCommish) && (!locked || isCommish))
  );
  const hiddenSelectionCount =
    !canEdit && meta && !meta.revealed && serverSelections.length === 0
      ? (meta.keeperStatus[owner] ?? 0)
      : 0;
  const selectionsHidden = !projectionMode && hiddenSelectionCount > 0;

  // Every derived number comes from the engine, recomputed each render
  const result = useMemo(() => resolveTeamKeepers(dataset, owner, selections), [owner, selections, dataset]);

  const rosterPlayers = useMemo(
    () =>
      dataset.players
        .filter((p) => p.fantasyTeam === owner)
        .sort((a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1)),
    [owner, dataset],
  );
  const allPlayers = useMemo(
    () =>
      [...dataset.players].sort(
        (a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1),
      ),
    [dataset],
  );

  const addKeeper = (p: DatasetPlayer) => {
    if (keeperCandidateError(dataset, owner, selections, p, { allowOverCap: true })) return;
    setDraftSel([...selections, { playerKey: p.key, playerName: p.name }]);
    if (selections.length + 1 >= dataset.maxKeepersPerTeam) setPickerOpen(false);
  };
  const removeKeeper = (playerKey: string) => {
    setDraftSel(selections.filter((s) => s.playerKey !== playerKey));
  };
  /** Tap a roster row: toggle the player in/out of the keeper selections. */
  const toggleKeeper = (p: DatasetPlayer) => {
    if (!canEdit) return;
    if (selections.some((s) => s.playerKey === p.key)) {
      removeKeeper(p.key);
      return;
    }
    if (keeperCandidateError(dataset, owner, selections, p, { allowOverCap: true })) return;
    addKeeper(p);
  };

  const disabledReason = (p: DatasetPlayer): string | null => {
    return keeperCandidateError(dataset, owner, selections, p);
  };
  // A row blocked ONLY by the cap keeps its greyed look and reason, but the
  // tap still lands, so the league gets to see the YA FIRED banner. Saving
  // stays blocked until the set is legal.
  const overCapTapThrough = (p: DatasetPlayer): boolean =>
    disabledReason(p) !== null
    && keeperCandidateError(dataset, owner, selections, p, { allowOverCap: true }) === null;

  const comboMeta = (p: DatasetPlayer) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-hi)' }}>
        {fmt1(p.keeper.effectiveAvg)}
      </span>
      {p.keeper.round !== null && <RoundChip round={p.keeper.round} />}
    </span>
  );

  const doSave = async () => {
    if (!identity || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (projectionMode) {
        const response = await saveKeeperScenarioTarget(identity, owner, selections);
        scenarioQuery.setScenario(response.scenario);
        setDraftSel(null);
        setFlash(true);
        if (flashTimer.current) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(false), 2500);
        return;
      }
      const res = await saveKeepers(identity, owner, selections);
      applyState(res);
      setDraftSel(null);
      setFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 2500);
    } catch (e) {
      setSaveError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const resetProjection = async () => {
    if (!identity || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await resetKeeperScenarioTarget(identity, owner);
      scenarioQuery.setScenario(response.scenario);
      setDraftSel(null);
    } catch (error) {
      setSaveError(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (!team) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px' }}>
        <div className="panel" style={{ padding: 24, textAlign: 'center', borderRadius: 10 }}>
          <div className="hub-heading glow-red" style={{ fontSize: '0.8rem', color: 'var(--neon-red)' }}>
            NO SUCH TEAM
          </div>
          <div style={{ color: 'var(--text-mid)', margin: '12px 0' }}>
            "{owner}" isn't in this league.
          </div>
          <Link to="/keepers" style={{ color: 'var(--neon-teal)', fontWeight: 700 }}>
            ← Back to all teams
          </Link>
        </div>
      </div>
    );
  }

  const statusColor =
    result.keepers.length === 0
      ? 'var(--neon-yellow)'
      : result.capOk
        ? 'var(--neon-teal)'
        : 'var(--neon-red)';
  const anyBump = result.keepers.some((k) => k.bumped);
  const pickColor =
    result.keepers.length === 0 ? 'var(--text-mid)' : anyBump ? 'var(--neon-orange)' : 'var(--neon-blue)';
  const emptySlots = Math.max(0, dataset.maxKeepersPerTeam - result.keepers.length);
  const hasApiFallback = rosterPlayers.some((p) => !p.stats2026 && p.api2026);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 8px' }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {isCommish && (
            <Link
              to="/admin"
              style={{
                color: 'var(--text-mid)',
                fontSize: '0.72rem',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 40,
                paddingRight: 12,
              }}
            >
              ← COMMISH
            </Link>
          )}
          <h1
            className="hub-heading glow-teal"
            style={{ fontSize: '1rem', color: 'var(--neon-teal)', margin: '6px 0 2px', lineHeight: 1.5 }}
          >
            {owner.toUpperCase()}
          </h1>
          <div style={{ color: 'var(--text-mid)', fontSize: '0.85rem' }}>{team.espnTeamName}</div>
        </div>
        <div style={{ flexShrink: 0, paddingTop: 4 }}>
          <IdentityChip />
        </div>
      </div>

      {identity && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="tap-btn"
            type="button"
            aria-expanded={ownerPickerOpen}
            aria-controls="keeper-owner-picker"
            onClick={() => setOwnerPickerOpen((open) => !open)}
            style={{
              width: '100%',
              minHeight: 48,
              padding: '0 14px',
              borderRadius: 9,
              border: '2px solid var(--neon-purple)',
              background: 'rgba(170,0,255,0.08)',
              color: 'var(--neon-purple)',
              fontWeight: 900,
              fontSize: '0.76rem',
              letterSpacing: '0.04em',
            }}
          >
            {ownerPickerOpen
              ? 'CLOSE TEAM PICKER'
              : projectionMode
                ? '⇄ SWITCH PROJECTED TEAM'
                : meta?.revealed
                  ? 'VIEW ANOTHER TEAM'
                  : '＋ PROJECT ANOTHER TEAM'}
          </button>

          {ownerPickerOpen && (
            <section
              id="keeper-owner-picker"
              className="panel"
              style={{
                padding: 12,
                marginTop: 8,
                border: '2px solid var(--neon-purple)',
                borderRadius: 9,
              }}
            >
              <div className="hub-heading" style={{ color: 'var(--neon-purple)', fontSize: '0.66rem' }}>
                CHOOSE AN OWNER
              </div>
              <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', lineHeight: 1.4, margin: '5px 0 10px' }}>
                {meta?.revealed
                  ? 'Open any keeper worksheet.'
                  : 'Your projected picks stay private and never change that owner’s real submission.'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
                {OWNERS.map((candidateOwner) => {
                  const isMine = candidateOwner === identity.owner;
                  const isCurrent = candidateOwner === owner;
                  return (
                    <Link
                      key={candidateOwner}
                      to={`/keepers/${encodeURIComponent(candidateOwner)}`}
                      aria-current={isCurrent ? 'page' : undefined}
                      className="tap-btn"
                      style={{
                        minHeight: 46,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: `1px solid ${isCurrent ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                        background: isCurrent ? 'rgba(0,255,204,0.06)' : 'var(--input-bg)',
                        color: isCurrent ? 'var(--neon-teal)' : 'var(--text-hi)',
                        textDecoration: 'none',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                      }}
                    >
                      <span>{candidateOwner}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.58rem' }}>
                        {isCurrent ? 'OPEN' : isMine ? 'MY TEAM' : meta?.revealed ? 'VIEW →' : 'PROJECT →'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── Access banners ─────────────────────────────────────── */}
      {projectionMode && browseBannerOpen && (
        <div
          className="panel keeper-browse-banner"
          style={{
            zIndex: 45,
            border: '2px dashed var(--neon-purple)',
            borderRadius: 10,
            padding: '11px 12px',
            marginBottom: 12,
            background: 'var(--panel-bg)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.72)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hub-heading" style={{ color: 'var(--neon-purple)', fontSize: '0.68rem' }}>
                PROJECTING {owner.toUpperCase()}'S KEEPERS
              </div>
              <div style={{ color: 'var(--text-body)', fontSize: '0.76rem', marginTop: 5, lineHeight: 1.45 }}>
                These picks are private to {identity?.owner}. They do not change {owner}'s real submission.
              </div>
            </div>
            <button
              className="tap-btn"
              type="button"
              aria-label="Dismiss projection banner"
              onClick={() => setBrowseBannerOpen(false)}
              style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--text-mid)' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <Link
              to={`/keepers/${encodeURIComponent(identity?.owner ?? '')}`}
              className="tap-btn"
              style={{ minHeight: 42, display: 'inline-flex', alignItems: 'center', padding: '0 13px', border: '2px solid var(--neon-teal)', borderRadius: 8, color: 'var(--neon-teal)', textDecoration: 'none', fontWeight: 800, fontSize: '0.72rem' }}
            >
              ← BACK TO MY KEEPERS
            </Link>
            <button
              className="tap-btn"
              type="button"
              disabled={saving}
              onClick={resetProjection}
              style={{ minHeight: 42, padding: '0 13px', border: '2px solid var(--panel-border)', borderRadius: 8, background: 'transparent', color: 'var(--text-mid)', fontWeight: 700, fontSize: '0.7rem' }}
            >
              RESET {owner.toUpperCase()}
            </button>
            {isCommish && (
              <button
                className="tap-btn"
                type="button"
                onClick={() => {
                  setCommissionerRealEdit(true);
                  setDraftSel(null);
                }}
                style={{ minHeight: 42, padding: '0 13px', border: '2px solid var(--neon-yellow)', borderRadius: 8, background: 'transparent', color: 'var(--neon-yellow)', fontWeight: 800, fontSize: '0.68rem' }}
              >
                EDIT REAL AS COMMISH
              </button>
            )}
          </div>
        </div>
      )}
      {projectionMode && !browseBannerOpen && (
        <Link
          to={`/keepers/${encodeURIComponent(identity?.owner ?? '')}`}
          className="tap-btn"
          style={{ minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, border: '2px solid var(--neon-teal)', borderRadius: 9, color: 'var(--neon-teal)', textDecoration: 'none', fontWeight: 800, fontSize: '0.76rem' }}
        >
          ← BACK TO MY KEEPERS
        </Link>
      )}
      {projectionMode && scenarioQuery.isPending && (
        <div style={{ color: 'var(--text-mid)', fontSize: '0.75rem', marginBottom: 12 }}>
          Loading your private scenario…
        </div>
      )}
      {projectionMode && scenarioQuery.isError && (
        <div style={{ color: 'var(--neon-red)', fontSize: '0.75rem', marginBottom: 12 }}>
          Could not load your private scenario. Sign out and back in, then try again.
        </div>
      )}
      {locked && !isCommish && !projectionMode && <LockBanner />}
      {locked && isCommish && (
        <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginBottom: 12 }}>
          🔒 Keepers are locked league-wide. Commish override lets you still edit.
        </div>
      )}
      {!identity && (
        <div
          className="panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 8,
            borderColor: 'var(--neon-yellow)',
            marginBottom: 12,
          }}
        >
          <span style={{ color: 'var(--neon-yellow)', fontSize: '0.85rem' }}>
            Read-only. Sign in to edit your team.
          </span>
          <IdentityChip />
        </div>
      )}
      {identity && !canEdit && !locked && (
        <div style={{ color: 'var(--text-mid)', fontSize: '0.75rem', marginBottom: 12 }}>
          Browsing {owner}'s keeper options. Their saved choices stay private until the commish reveals them.
        </div>
      )}
      {!canEdit &&
        meta &&
        !meta.revealed &&
        hiddenSelectionCount > 0 && (
          <div
            className="panel"
            style={{
              borderColor: 'var(--neon-purple)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 12,
              color: 'var(--neon-purple)',
              fontSize: '0.85rem',
              fontWeight: 700,
            }}
          >
            🔒 {owner} has submitted {hiddenSelectionCount} keeper
            {hiddenSelectionCount > 1 ? 's' : ''}. Names stay hidden until the commish reveals them.
          </div>
        )}

      {/* ── Cap meter — one thin strip, like the COSTS pills ───── */}
      <section className="panel" style={{ padding: '9px 12px 10px', borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
          <span className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--text-mid)' }}>
            SALARY CAP
          </span>
          <span
            className={selectionsHidden ? undefined : result.capOk ? 'glow-teal' : 'glow-red'}
            style={{
              fontSize: '1.4rem',
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: selectionsHidden ? 'var(--text-mid)' : result.capOk ? 'var(--neon-teal)' : 'var(--neon-red)',
            }}
          >
            {selectionsHidden ? '—' : result.capUsed.toFixed(1)}
          </span>
          <span style={{ color: 'var(--text-mid)', fontSize: '0.85rem', fontWeight: 600 }}>
            / {result.capLimit} FPPG
          </span>
          {dirty && (
            <span
              style={{
                marginLeft: 'auto',
                padding: '3px 8px',
                borderRadius: 999,
                border: '1px solid var(--neon-yellow)',
                color: 'var(--neon-yellow)',
                fontSize: '0.6rem',
                fontWeight: 800,
                letterSpacing: '0.08em',
                whiteSpace: 'nowrap',
              }}
            >
              ● UNSAVED
            </span>
          )}
        </div>
        <CapBar used={selectionsHidden ? 0 : result.capUsed} limit={result.capLimit} height={10} />
        <div
          className={result.keepers.length > 0 && !result.capOk ? 'blink' : undefined}
          style={{
            marginTop: 8,
            fontSize: '0.85rem',
            fontWeight: 700,
            fontStyle: 'italic',
            lineHeight: 1.4,
            textAlign: 'center',
            color: statusColor,
          }}
        >
          {selectionsHidden ? 'Saved keeper total is private.' : result.statusLine}
        </div>
      </section>

      {/* ── Selected keepers ───────────────────────────────────── */}
      <section style={{ marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.6rem', color: 'var(--neon-purple)', marginBottom: 8 }}>
          {selectionsHidden
            ? `KEEPER PICKS (${hiddenSelectionCount} HIDDEN)`
            : `SELECTED KEEPERS (${result.keepers.length}/${dataset.maxKeepersPerTeam})`}
        </div>
        {isLoading && result.keepers.length === 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 8 }}>Loading league state…</div>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {selectionsHidden &&
            Array.from({ length: hiddenSelectionCount }).map((_, index) => (
              <div
                key={`hidden-${index}`}
                className="panel"
                style={{
                  padding: '18px 14px',
                  borderRadius: 10,
                  borderColor: 'var(--neon-purple)',
                  color: 'var(--neon-purple)',
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                🔒 Keeper {index + 1} is hidden
              </div>
            ))}
          {result.keepers.map((k) => (
            <KeeperCard
              key={k.selection.playerKey}
              k={k}
              canEdit={canEdit}
              projected={projectionMode}
              onRemove={() => removeKeeper(k.selection.playerKey)}
            />
          ))}
          {!selectionsHidden && Array.from({ length: emptySlots }).map((_, i) =>
            i === 0 && pickerOpen && canEdit ? (
              <div
                key="inline-picker"
                className="panel"
                style={{ padding: '12px 14px 6px', borderRadius: 10, overflow: 'visible' }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PlayerCombobox
                      autoFocus
                      players={leaguePool ? allPlayers : rosterPlayers}
                      placeholder={leaguePool ? 'Search every 2026 roster…' : `Search ${owner}'s roster…`}
                      onSelect={(p) => {
                        addKeeper(p);
                        setPickerOpen(false);
                      }}
                      renderMeta={comboMeta}
                      disabledReason={disabledReason}
                    />
                  </div>
                  <button
                    className="tap-btn"
                    onClick={() => setPickerOpen(false)}
                    aria-label="Cancel"
                    style={{
                      width: 44,
                      height: 44,
                      flexShrink: 0,
                      borderRadius: 8,
                      border: '2px solid var(--panel-border)',
                      background: 'transparent',
                      color: 'var(--text-mid)',
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>
                <button
                  className="tap-btn"
                  onClick={() => setLeaguePool((v) => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '8px 0',
                    minHeight: 32,
                    color: leaguePool ? 'var(--neon-purple)' : 'var(--text-dim)',
                    fontSize: '0.75rem',
                    textDecoration: 'underline',
                  }}
                >
                  {leaguePool ? '← back to my roster only' : 'search the whole league pool'}
                </button>
              </div>
            ) : (
              <button
                key={`empty-${i}`}
                className={canEdit ? 'tap-btn' : undefined}
                onClick={() => canEdit && setPickerOpen(true)}
                disabled={!canEdit}
                style={{
                  border: `2px dashed ${canEdit ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                  background: 'transparent',
                  borderRadius: 10,
                  padding: '18px 14px',
                  color: canEdit ? 'var(--neon-teal)' : 'var(--text-faint)',
                  fontSize: '0.85rem',
                  fontWeight: canEdit ? 700 : 400,
                  textAlign: 'center',
                  cursor: canEdit ? 'pointer' : 'default',
                  width: '100%',
                }}
              >
                {canEdit ? '＋ TAP TO ADD A KEEPER' : 'Empty keeper slot'}
              </button>
            ),
          )}
        </div>
      </section>

      {/* ── Full roster (tap a player to keep them) ────────────── */}
      <section className="panel" style={{ padding: '12px 0 4px', borderRadius: 10, marginBottom: 14 }}>
        <div
          className="hub-heading"
          style={{ fontSize: '0.62rem', color: 'var(--neon-blue)', margin: '0 14px 4px' }}
        >
          FULL ROSTER ({rosterPlayers.length})
        </div>
        {canEdit && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', margin: '0 14px 8px' }}>
            {projectionMode
              ? `Tap players to project ${owner}'s keepers. Only you can see these picks.`
              : 'Tap a player to keep them. Choices that break the cap or another rule are greyed out.'}
          </div>
        )}
        {!canEdit && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', margin: '0 14px 8px' }}>
            Their final 2026 roster, with keeper value, price, and contract status. This does not show saved picks.
          </div>
        )}
        <div>
          {rosterPlayers.map((p) => (
            <RosterRow
              key={p.key}
              p={p}
              season={dataset.season}
              selected={selections.some((x) => x.playerKey === p.key)}
              canEdit={canEdit}
              reason={disabledReason(p)}
              tapThrough={overCapTapThrough(p)}
              onTap={() => toggleKeeper(p)}
            />
          ))}
        </div>
        {hasApiFallback && (
          <div style={{ color: 'var(--text-faint)', fontSize: '0.65rem', margin: '8px 14px' }}>
            ° season line from the ESPN API (player missing from the league-official sheet)
          </div>
        )}
      </section>

      {/* ── League status: who has keepers in (names only) ─────── */}
      <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', marginBottom: 6 }}>
          WHO'S IN
        </div>
        {meta && !meta.revealed && (
          <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', marginBottom: 10 }}>
            🕵️ Saved keeper names stay private until the commish reveals them.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {OWNERS.map((o) => {
            const n = meta?.keeperStatus[o] ?? 0;
            const inYet = n > 0;
            const isMine = o === identity?.owner;
            const row = (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--panel-border)',
                  background: inYet ? 'rgba(0,255,204,0.05)' : 'transparent',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: o === owner ? 800 : 600, color: o === owner ? 'var(--neon-teal)' : 'var(--text-hi)', fontSize: '0.85rem' }}>
                    {o}
                  </span>
                  <span style={{ display: 'block', marginTop: 2, color: 'var(--text-dim)', fontSize: '0.58rem', fontWeight: 800 }}>
                    {o === owner ? 'OPEN' : isMine ? 'MY TEAM' : meta?.revealed ? 'VIEW →' : 'PROJECT →'}
                  </span>
                </span>
                <span style={{ color: inYet ? 'var(--neon-teal)' : 'var(--text-faint)', fontSize: '0.78rem', fontWeight: 700 }}>
                  {inYet ? `✓ ${n} in` : '—'}
                </span>
              </span>
            );
            return (
              <Link
                key={o}
                to={`/keepers/${encodeURIComponent(o)}`}
                aria-label={isMine
                  ? 'Open my keeper options'
                  : meta?.revealed
                    ? `View ${o}'s keeper options`
                    : `Project ${o}'s keepers`}
                style={{ textDecoration: 'none' }}
              >
                {row}
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── The pick-status one-liner closes out the page ──────── */}
      <section style={{ margin: '4px 0 14px' }}>
        <div
          style={{
            fontSize: '0.9rem',
            fontWeight: 700,
            fontStyle: 'italic',
            lineHeight: 1.5,
            textAlign: 'center',
            color: pickColor,
          }}
        >
          {selectionsHidden ? 'Browse the roster below to see every legal option.' : result.pickStatusLine}
        </div>
      </section>

      {/* ── Sticky save bar ────────────────────────────────────── */}
      {canEdit && (
        <div className="keeper-save-dock" style={{ zIndex: 30 }}>
          <div
            className="panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 12,
              borderColor: saveError
                ? 'var(--neon-red)'
                : dirty
                  ? 'var(--neon-yellow)'
                  : 'var(--panel-border)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, fontSize: '0.78rem' }}>
              {saveError ? (
                <span style={{ color: 'var(--neon-red)' }}>{saveError}</span>
              ) : flash ? (
                <span style={{ color: 'var(--neon-teal)' }}>✓ {projectionMode ? 'Projection saved' : 'Keepers saved'}</span>
              ) : dirty ? (
                <span style={{ color: result.valid ? 'var(--neon-yellow)' : 'var(--neon-red)' }}>
                  {result.valid
                    ? '● Unsaved changes'
                    : !result.capOk
                      ? 'Over the cap. Drop someone to save.'
                      : 'Fix the blocked keeper choice'}
                </span>
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>{projectionMode ? 'Private projection saved' : 'In sync with the league'}</span>
              )}
            </div>
            <button
              className="tap-btn"
              onClick={doSave}
              disabled={!dirty || saving || !result.valid}
              style={{
                minHeight: 44,
                padding: '0 18px',
                borderRadius: 10,
                border: 'none',
                fontWeight: 800,
                letterSpacing: '0.05em',
                background: !dirty || saving || !result.valid ? 'var(--panel-border)' : 'var(--neon-teal)',
                color: !dirty || saving || !result.valid ? 'var(--text-dim)' : '#001a14',
                flexShrink: 0,
              }}
            >
              {saving ? 'SAVING…' : projectionMode ? 'SAVE PROJECTION' : 'SAVE KEEPERS'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

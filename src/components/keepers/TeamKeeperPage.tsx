import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { DatasetPlayer, KeeperSelection, ResolvedKeeper } from '../../lib/keeper/types.js';
import { pickLabel, resolveTeamKeepers } from '../../lib/keeper/engine.js';
import { leagueDataset, teamByOwner } from '../../lib/league/data.js';
import { apiErrorMessage, saveKeepers } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import IdentityChip from '../league/IdentityChip.js';
import PlayerCombobox from '../league/PlayerCombobox.js';
import { CapBar, LockBanner, RoundChip, SourceBadge, fmt1 } from './keeperUi.js';

const selKey = (sels: KeeperSelection[]) => sels.map((s) => `${s.playerKey}~${s.playerName}`).join('|');

const th: CSSProperties = {
  padding: '4px 8px',
  color: '#666688',
  fontSize: '0.62rem',
  letterSpacing: '0.08em',
  fontWeight: 700,
  borderBottom: '1px solid var(--panel-border)',
  textAlign: 'left',
};
const td: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--panel-border)',
  color: '#b0b0cc',
};
const right: CSSProperties = { textAlign: 'right' };

/** One selected-keeper card with pick cost, contract projection and errors. */
function KeeperCard({
  k,
  canEdit,
  onRemove,
}: {
  k: ResolvedKeeper;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const p = k.player;
  const name = p?.name ?? k.selection.playerName;
  return (
    <div
      className="panel"
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        borderColor: k.errors.length > 0 ? 'var(--neon-red)' : 'var(--panel-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#fff' }}>{name}</div>
          {p && (
            <div style={{ color: '#8888aa', fontSize: '0.75rem' }}>
              {p.proTeam} · {p.positions.join('/')}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--neon-teal)' }}>
              {fmt1(k.effectiveAvg)}
            </span>
            <span style={{ color: '#666688', fontSize: '0.7rem' }}>FPPG</span>
            {p && <SourceBadge info={p.keeper} />}
            {k.round !== null && <RoundChip round={k.round} long />}
          </div>
        </div>
        {canEdit && (
          <button
            className="tap-btn"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              background: 'rgba(255,34,34,0.08)',
              border: '2px solid rgba(255,34,34,0.5)',
              borderRadius: 10,
              color: 'var(--neon-red)',
              fontSize: '1.05rem',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--panel-border)',
          marginTop: 10,
          paddingTop: 8,
          display: 'grid',
          gap: 4,
          fontSize: '0.8rem',
        }}
      >
        {k.pick && (
          <div style={{ color: '#e0e0e0' }}>
            <span style={{ color: '#666688', fontSize: '0.68rem', letterSpacing: '0.08em' }}>PICK </span>
            Costs pick <strong style={{ color: 'var(--neon-yellow)' }}>{pickLabel(k.pick)}</strong>
            {k.pick.viaTradeFrom && (
              <span style={{ color: '#8888aa' }}> (acquired from {k.pick.viaTradeFrom})</span>
            )}
          </div>
        )}
        {k.bumped && (
          <div style={{ color: 'var(--neon-red)', fontSize: '0.75rem' }}>
            {k.bumpReason === 'traded'
              ? 'LOSER! You traded this pick and must use the next highest pick.'
              : 'Same tier twice — this one burns your next-better pick.'}
          </div>
        )}
        {k.contract && (
          <div style={{ color: '#b0b0cc' }}>
            <span style={{ color: '#666688', fontSize: '0.68rem', letterSpacing: '0.08em' }}>CONTRACT </span>
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

  const { state, isLoading } = useLeagueState();
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();

  const serverSelections = useMemo(() => state.keepers[owner] ?? [], [state.keepers, owner]);

  // null = mirror the server; non-null = local unsaved edits (dirty)
  const [draftSel, setDraftSel] = useState<KeeperSelection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [leaguePool, setLeaguePool] = useState(false);
  const flashTimer = useRef<number | null>(null);

  // Reset local edits when navigating between teams
  useEffect(() => {
    setDraftSel(null);
    setSaveError(null);
    setLeaguePool(false);
  }, [owner]);

  // Local edits that exactly match the server are no longer "unsaved"
  useEffect(() => {
    if (draftSel !== null && selKey(draftSel) === selKey(serverSelections)) setDraftSel(null);
  }, [draftSel, serverSelections]);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const selections = draftSel ?? serverSelections;
  const dirty = draftSel !== null;

  const locked = state.locks.keepersLocked;
  const isCommish = identity?.isCommissioner ?? false;
  const canEdit = !!identity && (identity.owner === owner || isCommish) && (!locked || isCommish);

  // Every derived number comes from the engine, recomputed each render
  const result = useMemo(() => resolveTeamKeepers(leagueDataset, owner, selections), [owner, selections]);

  const rosterPlayers = useMemo(
    () =>
      leagueDataset.players
        .filter((p) => p.fantasyTeam === owner)
        .sort((a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1)),
    [owner],
  );
  const allPlayers = useMemo(
    () =>
      [...leagueDataset.players].sort(
        (a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1),
      ),
    [],
  );

  const addKeeper = (p: DatasetPlayer) => {
    if (selections.length >= leagueDataset.maxKeepersPerTeam) return;
    setDraftSel([...selections, { playerKey: p.key, playerName: p.name }]);
  };
  const removeKeeper = (playerKey: string) => {
    setDraftSel(selections.filter((s) => s.playerKey !== playerKey));
  };

  const disabledReason = (p: DatasetPlayer): string | null => {
    if (selections.some((s) => s.playerKey === p.key)) return 'Already picked';
    if (p.fantasyTeam !== owner) {
      return p.fantasyTeam ? `On ${p.fantasyTeam}'s roster` : "Not on a 2026 roster — can't be kept";
    }
    const c = p.keeper.contract;
    if (c && (c.expired || c.lastKeepableSeason < leagueDataset.season)) {
      return 'Contract EXPIRED — must re-enter the draft';
    }
    if (p.keeper.round === null) return 'No usable stats';
    return null;
  };

  const comboMeta = (p: DatasetPlayer) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e0e0e0' }}>
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

  if (!team) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px' }}>
        <div className="panel" style={{ padding: 24, textAlign: 'center', borderRadius: 10 }}>
          <div className="hub-heading glow-red" style={{ fontSize: '0.8rem', color: 'var(--neon-red)' }}>
            NO SUCH TEAM
          </div>
          <div style={{ color: '#8888aa', margin: '12px 0' }}>
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
    result.keepers.length === 0 ? '#8888aa' : anyBump ? 'var(--neon-orange)' : 'var(--neon-blue)';
  const emptySlots = Math.max(0, leagueDataset.maxKeepersPerTeam - result.keepers.length);
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
          <Link
            to="/keepers"
            style={{
              color: '#8888aa',
              fontSize: '0.72rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 40,
              paddingRight: 12,
            }}
          >
            ← ALL TEAMS
          </Link>
          <h1
            className="hub-heading glow-teal"
            style={{ fontSize: '1rem', color: 'var(--neon-teal)', margin: '6px 0 2px', lineHeight: 1.5 }}
          >
            {owner.toUpperCase()}
          </h1>
          <div style={{ color: '#8888aa', fontSize: '0.85rem' }}>{team.espnTeamName}</div>
        </div>
        <div style={{ flexShrink: 0, paddingTop: 4 }}>
          <IdentityChip />
        </div>
      </div>

      {/* ── Access banners ─────────────────────────────────────── */}
      {locked && !isCommish && <LockBanner />}
      {locked && isCommish && (
        <div style={{ color: 'var(--neon-yellow)', fontSize: '0.75rem', marginBottom: 12 }}>
          🔒 Keepers are locked league-wide — commissioner override lets you still edit.
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
            Read-only — sign in to edit these keepers.
          </span>
          <IdentityChip />
        </div>
      )}
      {identity && !canEdit && !locked && (
        <div style={{ color: '#8888aa', fontSize: '0.75rem', marginBottom: 12 }}>
          Read-only — only {owner} (or the commissioner) can edit this page.
        </div>
      )}

      {/* ── Cap meter ──────────────────────────────────────────── */}
      <section className="panel" style={{ padding: '14px 14px 12px', borderRadius: 10, marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: '#8888aa', marginBottom: 8 }}>
          SALARY CAP
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span
            className={result.capOk ? 'glow-teal' : 'glow-red'}
            style={{
              fontSize: '2.6rem',
              lineHeight: 1,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: result.capOk ? 'var(--neon-teal)' : 'var(--neon-red)',
            }}
          >
            {result.capUsed.toFixed(1)}
          </span>
          <span style={{ color: '#8888aa', fontSize: '1.05rem', fontWeight: 600 }}>
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
        <CapBar used={result.capUsed} limit={result.capLimit} height={12} />
        <div
          style={{
            borderTop: '1px dashed var(--panel-border)',
            marginTop: 12,
            paddingTop: 10,
            display: 'grid',
            gap: 6,
          }}
        >
          <div
            className={result.keepers.length > 0 && !result.capOk ? 'blink' : undefined}
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              fontStyle: 'italic',
              lineHeight: 1.5,
              textAlign: 'center',
              color: statusColor,
              textShadow: `0 0 8px ${statusColor}`,
            }}
          >
            {result.statusLine}
          </div>
          <div
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              fontStyle: 'italic',
              lineHeight: 1.5,
              textAlign: 'center',
              color: pickColor,
              textShadow: `0 0 8px ${pickColor}`,
            }}
          >
            {result.pickStatusLine}
          </div>
        </div>
      </section>

      {/* ── Selected keepers ───────────────────────────────────── */}
      <section style={{ marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.6rem', color: 'var(--neon-purple)', marginBottom: 8 }}>
          SELECTED KEEPERS ({result.keepers.length}/{leagueDataset.maxKeepersPerTeam})
        </div>
        {isLoading && result.keepers.length === 0 && (
          <div style={{ color: '#666688', fontSize: '0.8rem', marginBottom: 8 }}>Loading league state…</div>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {result.keepers.map((k) => (
            <KeeperCard
              key={k.selection.playerKey}
              k={k}
              canEdit={canEdit}
              onRemove={() => removeKeeper(k.selection.playerKey)}
            />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div
              key={`empty-${i}`}
              style={{
                border: '2px dashed var(--panel-border)',
                borderRadius: 10,
                padding: '16px 14px',
                color: '#555577',
                fontSize: '0.8rem',
                textAlign: 'center',
              }}
            >
              Empty keeper slot
            </div>
          ))}
        </div>
      </section>

      {/* ── Add keeper ─────────────────────────────────────────── */}
      {canEdit && selections.length < leagueDataset.maxKeepersPerTeam && (
        <section
          className="panel"
          style={{ padding: '12px 14px 6px', borderRadius: 10, marginBottom: 14, overflow: 'visible' }}
        >
          <div className="hub-heading" style={{ fontSize: '0.6rem', color: 'var(--neon-teal)', marginBottom: 10 }}>
            ADD KEEPER
          </div>
          <PlayerCombobox
            players={leaguePool ? allPlayers : rosterPlayers}
            placeholder={leaguePool ? 'Search every 2026 roster…' : `Search ${owner}'s roster…`}
            onSelect={addKeeper}
            renderMeta={comboMeta}
            disabledReason={disabledReason}
          />
          <button
            className="tap-btn"
            onClick={() => setLeaguePool((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: '10px 0',
              minHeight: 36,
              color: leaguePool ? 'var(--neon-purple)' : '#666688',
              fontSize: '0.75rem',
              textDecoration: 'underline',
            }}
          >
            {leaguePool ? '← back to my roster only' : 'search the whole league pool'}
          </button>
        </section>
      )}

      {/* ── Full roster reference ──────────────────────────────── */}
      <section className="panel" style={{ padding: '12px 0 4px', borderRadius: 10, marginBottom: 14 }}>
        <div
          className="hub-heading"
          style={{ fontSize: '0.6rem', color: 'var(--neon-blue)', margin: '0 14px 10px' }}
        >
          FULL ROSTER ({rosterPlayers.length})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={th}>PLAYER</th>
                <th style={th}>POS</th>
                <th style={{ ...th, ...right }}>2026</th>
                <th style={{ ...th, ...right }}>KEEP AVG</th>
                <th style={{ ...th, ...right }}>RD</th>
                <th style={{ ...th, ...right }}>CONTRACT</th>
              </tr>
            </thead>
            <tbody>
              {rosterPlayers.map((p) => {
                const s = p.stats2026 ?? p.api2026;
                const apiFallback = !p.stats2026 && !!p.api2026;
                const eff = p.keeper.effectiveAvg;
                const effDiff = eff != null && (!s || Math.abs(eff - s.avg) > 0.05);
                const c = p.keeper.contract;
                const expired = !!c && (c.expired || c.lastKeepableSeason < leagueDataset.season);
                const isSel = selections.some((x) => x.playerKey === p.key);
                return (
                  <tr key={p.key} style={{ background: isSel ? 'rgba(0,255,204,0.06)' : undefined }}>
                    <td style={{ ...td, color: '#e0e0e0', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ ...td, color: '#8888aa' }}>{p.positions.join('/')}</td>
                    <td style={{ ...td, ...right }}>
                      {s ? `${s.avg.toFixed(1)}${apiFallback ? '°' : ''} · ${s.gp}gp` : '—'}
                    </td>
                    <td style={{ ...td, ...right }}>
                      {effDiff ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--neon-yellow)', fontWeight: 700 }}>{fmt1(eff)}</span>
                          <SourceBadge info={p.keeper} compact />
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ ...td, ...right }}>
                      {p.keeper.round !== null ? <RoundChip round={p.keeper.round} /> : '—'}
                    </td>
                    <td style={{ ...td, ...right }}>
                      {c ? (
                        expired ? (
                          <span style={{ color: 'var(--neon-red)', fontWeight: 700 }}>EXPIRED</span>
                        ) : (
                          `thru ${c.lastKeepableSeason}`
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasApiFallback && (
          <div style={{ color: '#555577', fontSize: '0.65rem', margin: '8px 14px' }}>
            ° season line from the ESPN API (player missing from the league-official sheet)
          </div>
        )}
      </section>

      {/* ── Sticky save bar ────────────────────────────────────── */}
      {canEdit && (
        <div style={{ position: 'sticky', bottom: 'calc(64px + env(safe-area-inset-bottom))', zIndex: 30 }}>
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
                <span style={{ color: 'var(--neon-teal)' }}>✓ Keepers saved</span>
              ) : dirty ? (
                <span style={{ color: 'var(--neon-yellow)' }}>● Unsaved changes</span>
              ) : (
                <span style={{ color: '#666688' }}>In sync with the league</span>
              )}
            </div>
            <button
              className="tap-btn"
              onClick={doSave}
              disabled={!dirty || saving}
              style={{
                minHeight: 44,
                padding: '0 18px',
                borderRadius: 10,
                border: 'none',
                fontWeight: 800,
                letterSpacing: '0.05em',
                background: !dirty || saving ? '#1a1a33' : 'var(--neon-teal)',
                color: !dirty || saving ? '#666688' : '#001a14',
                flexShrink: 0,
              }}
            >
              {saving ? 'SAVING…' : 'SAVE KEEPERS'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

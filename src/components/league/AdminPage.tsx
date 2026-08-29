import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DatasetPlayer } from '../../lib/keeper/types.js';
import { OWNERS, leagueDataset } from '../../lib/league/data.js';
import { apiErrorMessage, enterSandbox, exitSandbox, sandboxActive, setOverrides } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import PlayerCombobox from './PlayerCombobox.js';
import CommissionerPanel from './CommissionerPanel.js';
import IdentityChip from './IdentityChip.js';
import PlayerPoolAdmin from './PlayerPoolAdmin.js';
import ScheduleAdmin from './ScheduleAdmin.js';
import { RoundChip } from '../keepers/keeperUi.js';

const baseRound = new Map(leagueDataset.players.map((p) => [p.key, p.keeper.round]));
const baseByKey = new Map(leagueDataset.players.map((p) => [p.key, p]));

/** /admin — commissioner tier & cap controls (the "tweak the sheet" page). */
export default function AdminPage() {
  const { state, dataset } = useLeagueData();
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();

  const [capInput, setCapInput] = useState('');
  const [target, setTarget] = useState<DatasetPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overrides = state.overrides ?? {};
  const roundOverrides = overrides.playerRounds ?? {};
  const capOverridden = overrides.cap != null;

  const searchPool = useMemo(
    () =>
      [...dataset.players].sort(
        (a, b) => (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1),
      ),
    [dataset],
  );

  const assignments = useMemo(() => {
    const ranked = dataset.players
      .filter((p) => p.keeper.round !== null && (p.keeper.rank !== null || p.fantasyTeam || p.stats2026))
      .sort(
        (a, b) =>
          (a.keeper.round ?? 99) - (b.keeper.round ?? 99) ||
          (b.keeper.effectiveAvg ?? -1) - (a.keeper.effectiveAvg ?? -1),
      );
    const byRound = new Map<number, DatasetPlayer[]>();
    for (const p of ranked) {
      const r = p.keeper.round!;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(p);
    }
    return byRound;
  }, [dataset]);

  if (!identity?.isCommissioner) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>
            COMMISH ONLY
          </div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Nice try. Sign in as the commish to tweak tiers and the cap.
          </div>
        </div>
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCap = (value: number | null) =>
    run(async () => {
      applyState(await setOverrides(identity, { cap: value }));
      setCapInput('');
    });

  const setPlayerRound = (playerKey: string, round: number | null) =>
    run(async () => {
      applyState(await setOverrides(identity, { playerRounds: { [playerKey]: round } }));
    });

  const activeOverrides = Object.entries(roundOverrides);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <h1
          className="hub-heading glow-yellow"
          style={{ fontSize: '0.85rem', color: 'var(--neon-yellow)', margin: 0, lineHeight: 1.6 }}
        >
          👑 COMMISH MODE
        </h1>
        <IdentityChip />
      </div>
      <div style={{ color: 'var(--text-mid)', fontSize: '0.78rem', marginBottom: 14 }}>
        Tier + cap tweaks live here. Changes apply league-wide instantly and are audit-logged.
      </div>
      {error && (
        <div style={{ color: 'var(--neon-red)', fontSize: '0.82rem', marginBottom: 12 }}>⚠ {error}</div>
      )}

      <CommissionerPanel />

      <PlayerPoolAdmin />

      <ScheduleAdmin />

      {/* ── Test mode ──────────────────────────────────────────── */}
      <section
        className="panel"
        style={{
          padding: 14,
          borderRadius: 10,
          marginBottom: 14,
          borderColor: sandboxActive() ? 'var(--neon-yellow)' : 'var(--panel-border)',
        }}
      >
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-yellow)', marginBottom: 6 }}>
          🧪 TEST MODE
        </div>
        <div style={{ color: 'var(--text-mid)', fontSize: '0.75rem', marginBottom: 10 }}>
          A sandbox copy of the league, only on this device: fill in anyone's keepers, start the
          draft, make picks — nothing saves to real profiles. Secrecy is off so the whole board
          populates.
        </div>
        {sandboxActive() ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: 'var(--neon-yellow)', fontWeight: 800, fontSize: '0.85rem' }}>
              ● ACTIVE — you're in the sandbox
            </span>
            <button
              className="tap-btn"
              onClick={() => {
                exitSandbox();
                window.location.reload();
              }}
              style={{
                minHeight: 44,
                padding: '0 16px',
                borderRadius: 8,
                border: '2px solid var(--neon-red)',
                background: 'transparent',
                color: 'var(--neon-red)',
                fontWeight: 800,
              }}
            >
              EXIT & DISCARD
            </button>
          </div>
        ) : (
          <button
            className="tap-btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await enterSandbox(identity);
                window.location.assign('/draft');
              })
            }
            style={{
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 8,
              border: '2px solid var(--neon-yellow)',
              background: 'rgba(255,230,0,0.08)',
              color: 'var(--neon-yellow)',
              fontWeight: 800,
            }}
          >
            ENTER TEST MODE
          </button>
        )}
      </section>

      {/* ── Team worksheets (commissioner view/edit) ───────────── */}
      <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', marginBottom: 6 }}>
          TEAM WORKSHEETS
        </div>
        <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', marginBottom: 10 }}>
          Open any team in Commish Mode. You see their keepers, cap math, and every rule check
          (e.g. Dustin trying to keep SGA shows the EXPIRED block). You can edit on their behalf.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {OWNERS.map((o) => (
            <Link
              key={o}
              to={`/keepers/${encodeURIComponent(o)}`}
              className="tap-btn"
              style={{
                minHeight: 40,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 14px',
                borderRadius: 999,
                border: '2px solid var(--panel-border)',
                color: 'var(--text-hi)',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
              }}
            >
              {o}
            </Link>
          ))}
        </div>
      </section>

      {/* ── Salary cap ─────────────────────────────────────────── */}
      <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-teal)', marginBottom: 10 }}>
          SALARY CAP
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="glow-teal" style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--neon-teal)' }}>
            {dataset.cap}
          </span>
          <span style={{ color: 'var(--text-mid)', fontSize: '0.78rem' }}>
            {capOverridden
              ? `commish override (computed: ${leagueDataset.cap})`
              : `computed: R3 max ${dataset.capRule.round3Max} + R3 min ${dataset.capRule.round3Min}`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            className="hub-input"
            type="number"
            inputMode="decimal"
            step="0.1"
            placeholder={String(dataset.cap)}
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            style={{ width: 120, padding: '10px 12px', fontSize: '1rem' }}
          />
          <button
            className="tap-btn"
            disabled={busy || capInput === '' || isNaN(Number(capInput))}
            onClick={() => saveCap(Number(capInput))}
            style={{
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 8,
              border: '2px solid var(--neon-teal)',
              background: 'transparent',
              color: 'var(--neon-teal)',
              fontWeight: 800,
            }}
          >
            SET CAP
          </button>
          {capOverridden && (
            <button
              className="tap-btn"
              disabled={busy}
              onClick={() => saveCap(null)}
              style={{
                minHeight: 44,
                padding: '0 16px',
                borderRadius: 8,
                border: '2px solid var(--panel-border)',
                background: 'transparent',
                color: 'var(--text-mid)',
                fontWeight: 700,
              }}
            >
              RESET TO {leagueDataset.cap}
            </button>
          )}
        </div>
      </section>

      {/* ── Tier bands ─────────────────────────────────────────── */}
      <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-blue)', marginBottom: 10 }}>
          TIER BANDS (COMPUTED)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                {['RD', 'FPPG BAND', 'MAX YRS', 'PLAYERS'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '4px 8px',
                      color: 'var(--text-dim)',
                      fontSize: '0.62rem',
                      borderBottom: '1px solid var(--panel-border)',
                      textAlign: i === 0 ? 'left' : 'right',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataset.tiers.map((t) => (
                <tr key={t.round}>
                  <td style={{ padding: '5px 8px', color: 'var(--neon-blue)', fontWeight: 700, borderBottom: '1px solid var(--panel-border)' }}>
                    R{t.round}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-hi)', borderBottom: '1px solid var(--panel-border)' }}>
                    {t.max.toFixed(1)} – {t.min.toFixed(1)}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-body)', borderBottom: '1px solid var(--panel-border)' }}>
                    {t.maxYears}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-mid)', borderBottom: '1px solid var(--panel-border)' }}>
                    {assignments.get(t.round)?.length ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: 8 }}>
          Bands come from the ranked list (decile boundaries). To move an individual player, use
          the round override below — same as the manual tweaks on the old sheet.
        </div>
      </section>

      {/* ── Player round overrides ─────────────────────────────── */}
      <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-yellow)', marginBottom: 10 }}>
          PLAYER ROUND OVERRIDES
        </div>
        <PlayerCombobox
          players={searchPool}
          placeholder="Find a player to tweak…"
          onSelect={setTarget}
          renderMeta={(p) => (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-mid)', fontSize: '0.8rem' }}>{p.keeper.effectiveAvg ?? '—'}</span>
              {p.keeper.round !== null && <RoundChip round={p.keeper.round} />}
            </span>
          )}
        />
        {target && (
          <div style={{ marginTop: 12, borderTop: '1px dashed var(--panel-border)', paddingTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>
              {target.name}{' '}
              <span style={{ color: 'var(--text-mid)', fontSize: '0.75rem' }}>
                {target.proTeam} · avg {target.keeper.effectiveAvg ?? '—'} · computed R
                {baseRound.get(target.key) ?? '—'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => {
                const current = (dataset.players.find((p) => p.key === target.key)?.keeper.round) ?? null;
                const active = current === r;
                return (
                  <button
                    key={r}
                    className="tap-btn"
                    disabled={busy}
                    onClick={() => setPlayerRound(target.key, r)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      border: `2px solid ${active ? 'var(--neon-yellow)' : 'var(--panel-border)'}`,
                      background: active ? 'rgba(255,230,0,0.12)' : 'transparent',
                      color: active ? 'var(--neon-yellow)' : 'var(--text-body)',
                      fontWeight: 800,
                    }}
                  >
                    {r}
                  </button>
                );
              })}
              {roundOverrides[target.key] !== undefined && (
                <button
                  className="tap-btn"
                  disabled={busy}
                  onClick={() => setPlayerRound(target.key, null)}
                  style={{
                    height: 44,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: '2px solid var(--neon-red)',
                    background: 'transparent',
                    color: 'var(--neon-red)',
                    fontWeight: 700,
                  }}
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        )}

        {activeOverrides.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', marginBottom: 6 }}>ACTIVE OVERRIDES</div>
            {activeOverrides.map(([key, round]) => {
              const p = baseByKey.get(key);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--panel-border)' }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{p?.name ?? key}</span>
                  <span style={{ color: 'var(--text-mid)', fontSize: '0.78rem' }}>
                    R{baseRound.get(key) ?? '—'} → <strong style={{ color: 'var(--neon-yellow)' }}>R{round}</strong>
                  </span>
                  <button
                    className="tap-btn"
                    disabled={busy}
                    onClick={() => setPlayerRound(key, null)}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      border: '2px solid var(--panel-border)',
                      background: 'transparent',
                      color: 'var(--neon-red)',
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 2026 player averages (the tier list) ───────────────── */}
      <section className="panel" style={{ padding: '14px 0 6px', borderRadius: 10 }}>
        <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-purple)', margin: '0 14px 4px' }}>
          2026 PLAYER AVERAGES
        </div>
        <div style={{ color: 'var(--text-mid)', fontSize: '0.72rem', margin: '0 14px 10px' }}>
          The list behind the tiers. Tap any player to override their round.{' '}
          <span
            style={{
              border: '1px solid rgba(255,230,0,0.5)',
              color: 'var(--neon-yellow)',
              borderRadius: 4,
              padding: '0 4px',
              fontSize: '0.62rem',
              fontWeight: 800,
            }}
          >
            '25
          </span>{' '}
          = number comes from their 2025 season (≤25 GP or 0 GP rule).
        </div>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((r) => (
          <div key={r}>
            <div
              style={{
                color: 'var(--neon-blue)',
                fontWeight: 800,
                fontSize: '0.75rem',
                letterSpacing: '0.08em',
                padding: '8px 14px 4px',
                borderBottom: '1px solid var(--panel-border)',
              }}
            >
              ROUND {r}
              <span style={{ color: 'var(--text-dim)', fontWeight: 600, marginLeft: 8 }}>
                {dataset.tiers[r - 1]?.max.toFixed(1)} – {dataset.tiers[r - 1]?.min.toFixed(1)}
              </span>
            </div>
            {(assignments.get(r) ?? []).slice(0, r === 10 ? 40 : 99).map((p) => {
              const overridden = roundOverrides[p.key] !== undefined;
              const priorYear = p.keeper.usesPriorYear || p.keeper.zeroGp2026;
              return (
                <button
                  key={p.key}
                  className="tap-btn"
                  onClick={() => {
                    setTarget(p);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--panel-border)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        color: overridden ? 'var(--neon-yellow)' : 'var(--text-hi)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </span>
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', flexShrink: 0 }}>
                      {p.positions[0] ?? ''} · {p.proTeam}
                    </span>
                    {priorYear && (
                      <span
                        title={p.keeper.zeroGp2026 ? "Didn't play in 2026 — 3rd-round rule" : '≤25 GP in 2026 — 2025 average used'}
                        style={{
                          border: '1px solid rgba(255,230,0,0.5)',
                          color: 'var(--neon-yellow)',
                          borderRadius: 4,
                          padding: '0 4px',
                          fontSize: '0.62rem',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        '25
                      </span>
                    )}
                    {overridden && (
                      <span style={{ color: 'var(--neon-yellow)', fontSize: '0.65rem', flexShrink: 0 }}>✎ override</span>
                    )}
                  </span>
                  <span style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-body)', flexShrink: 0 }}>
                    {p.keeper.effectiveAvg ?? '—'}
                  </span>
                  <RoundChip round={r} />
                </button>
              );
            })}
            {r === 10 && (assignments.get(10)?.length ?? 0) > 40 && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', padding: '6px 14px' }}>
                +{(assignments.get(10)?.length ?? 0) - 40} more — everyone else is R10 (search above to
                find them)
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

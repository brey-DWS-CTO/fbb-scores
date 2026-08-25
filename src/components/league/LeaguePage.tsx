import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PickTrade } from '../../lib/keeper/types.js';
import { leagueDataset } from '../../lib/league/data.js';
import { apiErrorMessage, fetchPins, resetDraft, setLocks, setPin } from '../../lib/league/api.js';
import { useApplyStateResponse, useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import { useSettings } from '../../hooks/useSettings.js';
import IdentityChip from './IdentityChip.js';

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

const btnOutline = (color: string): CSSProperties => ({
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 8,
  border: `2px solid ${color}`,
  background: 'transparent',
  color,
  fontWeight: 800,
  letterSpacing: '0.05em',
});

function Section({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color, marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** /league — rules reference (tiers, contracts, trades), settings + commissioner tools. */
export default function LeaguePage() {
  const { state } = useLeagueState();
  const { identity, signOut } = useIdentity();
  const { fontMode, setFontMode } = useSettings();
  const applyState = useApplyStateResponse();

  const [pins, setPins] = useState<Array<{ owner: string; pin: string }> | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pinArm, setPinArm] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [commishError, setCommishError] = useState<string | null>(null);

  const locked = state.locks.keepersLocked;
  const isCommish = identity?.isCommissioner ?? false;

  const contractPlayers = useMemo(
    () => leagueDataset.players.filter((p) => p.keeper.contract != null),
    [],
  );
  const activeContracts = useMemo(
    () =>
      contractPlayers
        .filter((p) => {
          const c = p.keeper.contract!;
          return !c.expired && c.lastKeepableSeason >= leagueDataset.season;
        })
        .sort((a, b) => {
          // unrostered holders sink to the bottom, otherwise sort by holder then player
          if ((a.fantasyTeam === null) !== (b.fantasyTeam === null)) {
            return a.fantasyTeam === null ? 1 : -1;
          }
          return (
            (a.fantasyTeam ?? '').localeCompare(b.fantasyTeam ?? '') || a.name.localeCompare(b.name)
          );
        }),
    [contractPlayers],
  );
  const expiredContracts = useMemo(
    () =>
      contractPlayers.filter((p) => {
        const c = p.keeper.contract!;
        return c.expired === true || c.lastKeepableSeason < leagueDataset.season;
      }),
    [contractPlayers],
  );

  const trades = useMemo(() => {
    const map = new Map<string, PickTrade[]>();
    for (const t of leagueDataset.pickTrades) {
      const key = t.tradeNote ?? `${t.date} ${t.from}→${t.to} R${t.round}`;
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].map(([key, picks]) => ({ key, picks }));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setCommishError(null);
    try {
      await fn();
    } catch (e) {
      setCommishError(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleLock = () => {
    if (!identity) return;
    void run('lock', async () => {
      applyState(await setLocks(identity, !locked));
    });
  };

  const openPins = () => {
    if (!identity) return;
    void run('pins', async () => {
      setPins(await fetchPins(identity));
      setPinsOpen(true);
    });
  };

  const resetOwnerPin = (owner: string) => {
    if (!identity) return;
    setPinArm(null);
    void run(`pin-${owner}`, async () => {
      const newPin = String(Math.floor(1000 + Math.random() * 9000));
      await setPin(identity, owner, newPin);
      setPins(await fetchPins(identity));
    });
  };

  const doResetDraft = () => {
    if (!identity) return;
    setResetArmed(false);
    void run('reset', async () => {
      applyState(await resetDraft(identity));
    });
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 24px' }}>
      <h1
        className="hub-heading glow-purple"
        style={{ fontSize: '0.85rem', color: 'var(--neon-purple)', margin: '0 0 14px', lineHeight: 1.6 }}
      >
        LEAGUE HQ
      </h1>

      {/* ── a. Keeper tiers ────────────────────────────────────── */}
      <Section title={`${leagueDataset.season} KEEPER TIERS`} color="var(--neon-teal)">
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div className="hub-heading" style={{ fontSize: '0.55rem', color: '#8888aa' }}>
            SALARY CAP
          </div>
          <div
            className="glow-teal"
            style={{ fontSize: '2.6rem', fontWeight: 800, color: 'var(--neon-teal)', lineHeight: 1.2 }}
          >
            {leagueDataset.cap}
          </div>
          <div style={{ color: '#8888aa', fontSize: '0.75rem' }}>
            R3 max {leagueDataset.capRule.round3Max} + R3 min {leagueDataset.capRule.round3Min}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={th}>ROUND</th>
                <th style={{ ...th, ...right }}>FPPG BAND</th>
                <th style={{ ...th, ...right }}>MAX YEARS</th>
              </tr>
            </thead>
            <tbody>
              {leagueDataset.tiers.map((t) => (
                <tr key={t.round}>
                  <td style={{ ...td, color: 'var(--neon-blue)', fontWeight: 700 }}>R{t.round}</td>
                  <td style={{ ...td, ...right, color: '#e0e0e0' }}>
                    {t.max.toFixed(1)} – {t.min.toFixed(1)}
                  </td>
                  <td style={{ ...td, ...right }}>{t.maxYears}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── b. Keeper contracts ────────────────────────────────── */}
      <Section title="KEEPER CONTRACTS" color="var(--neon-blue)">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={th}>PLAYER</th>
                <th style={th}>HOLDER</th>
                <th style={{ ...th, ...right }}>ORIG RD</th>
                <th style={{ ...th, ...right }}>THRU</th>
              </tr>
            </thead>
            <tbody>
              {activeContracts.map((p) => {
                const c = p.keeper.contract!;
                return (
                  <tr key={p.key}>
                    <td style={{ ...td, color: '#e0e0e0', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ ...td, color: p.fantasyTeam ? '#b0b0cc' : '#666688' }}>
                      {p.fantasyTeam ?? 'unrostered'}
                    </td>
                    <td style={{ ...td, ...right }}>R{c.originalRound}</td>
                    <td style={{ ...td, ...right, color: 'var(--neon-teal)', fontWeight: 700 }}>
                      {c.lastKeepableSeason}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {expiredContracts.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--panel-border)' }}>
            <div
              style={{
                color: 'var(--neon-red)',
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}
            >
              EXPIRED — must re-enter the draft
            </div>
            <div style={{ display: 'grid', gap: 3 }}>
              {expiredContracts.map((p) => (
                <div key={p.key} style={{ color: '#666688', fontSize: '0.85rem' }}>
                  <span style={{ textDecoration: 'line-through' }}>{p.name}</span>{' '}
                  <span style={{ fontSize: '0.7rem' }}>
                    (R{p.keeper.contract!.originalRound} · {p.fantasyTeam ?? 'unrostered'})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── c. Draft pick trades ───────────────────────────────── */}
      <Section title="DRAFT PICK TRADES" color="var(--neon-orange)">
        {trades.length === 0 ? (
          <div style={{ color: '#555577' }}>No pick trades this season.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {trades.map(({ key, picks }) => (
              <div
                key={key}
                style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: '10px 12px' }}
              >
                <div style={{ color: '#666688', fontSize: '0.68rem', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {formatDate(picks[0].date)}
                </div>
                {picks[0].tradeNote && (
                  <div style={{ color: '#b0b0cc', fontSize: '0.8rem', marginBottom: 8 }}>
                    {picks[0].tradeNote}
                  </div>
                )}
                <div style={{ display: 'grid', gap: 3 }}>
                  {picks.map((t, i) => (
                    <div key={i} style={{ fontSize: '0.82rem', color: '#e0e0e0' }}>
                      <span style={{ fontWeight: 700 }}>{t.from}</span>
                      <span style={{ color: '#8888aa' }}>'s R{t.round}</span>
                      <span style={{ color: 'var(--neon-orange)', fontWeight: 700 }}> → </span>
                      <span style={{ fontWeight: 700 }}>{t.to}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── d. Settings ────────────────────────────────────────── */}
      <Section title="SETTINGS" color="var(--neon-yellow)">
        <div style={{ marginBottom: 8, color: '#8888aa', fontSize: '0.78rem' }}>
          Font mode: retro CRT vs readable
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['retro', 'modern'] as const).map((m) => {
            const active = fontMode === m;
            return (
              <button
                key={m}
                className="tap-btn"
                onClick={() => setFontMode(m)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 8,
                  border: `2px solid ${active ? 'var(--neon-teal)' : 'var(--panel-border)'}`,
                  background: active ? 'rgba(0,255,204,0.1)' : 'transparent',
                  color: active ? 'var(--neon-teal)' : '#8888aa',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                }}
              >
                {m === 'retro' ? 'RETRO' : 'MODERN'}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px dashed var(--panel-border)',
          }}
        >
          <IdentityChip />
          {identity && (
            <button
              className="tap-btn"
              onClick={signOut}
              style={{
                minHeight: 44,
                padding: '0 14px',
                background: 'transparent',
                border: '2px solid var(--panel-border)',
                borderRadius: 8,
                color: '#8888aa',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              sign out
            </button>
          )}
        </div>
      </Section>

      {/* ── e. Commissioner panel ──────────────────────────────── */}
      {isCommish && identity && (
        <Section title="COMMISSIONER PANEL" color="var(--neon-purple)">
          {/* Lock toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: locked ? 'var(--neon-red)' : 'var(--neon-teal)' }}>
                Keepers are {locked ? 'LOCKED 🔒' : 'OPEN 🔓'}
              </div>
              <div style={{ color: '#666688', fontSize: '0.7rem' }}>
                {locked ? 'Only you can still edit keepers.' : 'Owners can edit + save their keepers.'}
              </div>
            </div>
            <button
              className="tap-btn"
              onClick={toggleLock}
              disabled={busy !== null}
              style={{ ...btnOutline(locked ? 'var(--neon-teal)' : 'var(--neon-red)'), flexShrink: 0 }}
            >
              {busy === 'lock' ? '…' : locked ? 'UNLOCK' : 'LOCK'}
            </button>
          </div>

          {/* PINs */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
            {!pinsOpen ? (
              <button
                className="tap-btn"
                onClick={openPins}
                disabled={busy !== null}
                style={btnOutline('var(--neon-yellow)')}
              >
                {busy === 'pins' ? 'LOADING…' : 'VIEW PINS'}
              </button>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ color: 'var(--neon-yellow)', fontSize: '0.72rem' }}>
                    ⚠ Don't screen-share with these on screen.
                  </span>
                  <button
                    className="tap-btn"
                    onClick={() => {
                      setPinsOpen(false);
                      setPinArm(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#8888aa',
                      fontSize: '0.75rem',
                      textDecoration: 'underline',
                      minHeight: 32,
                    }}
                  >
                    hide
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {(pins ?? []).map(({ owner: o, pin }) => (
                    <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, fontWeight: 600, color: '#e0e0e0' }}>{o}</span>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          letterSpacing: '0.2em',
                          color: 'var(--neon-teal)',
                          fontSize: '0.95rem',
                        }}
                      >
                        {pin}
                      </span>
                      <button
                        className="tap-btn"
                        onClick={() => (pinArm === o ? resetOwnerPin(o) : setPinArm(o))}
                        disabled={busy !== null}
                        style={{
                          minHeight: 40,
                          padding: '0 12px',
                          borderRadius: 8,
                          border: `2px solid ${pinArm === o ? 'var(--neon-red)' : 'var(--panel-border)'}`,
                          background: 'transparent',
                          color: pinArm === o ? 'var(--neon-red)' : '#8888aa',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                        }}
                      >
                        {busy === `pin-${o}` ? '…' : pinArm === o ? 'SURE?' : 'reset'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Reset draft */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
            {!resetArmed ? (
              <button
                className="tap-btn"
                onClick={() => setResetArmed(true)}
                disabled={busy !== null}
                style={btnOutline('var(--neon-red)')}
              >
                RESET DRAFT
              </button>
            ) : (
              <div>
                <div style={{ color: 'var(--neon-red)', fontSize: '0.8rem', marginBottom: 8 }}>
                  This wipes every recorded draft pick. No undo. For real?
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="tap-btn"
                    onClick={doResetDraft}
                    disabled={busy !== null}
                    style={{
                      minHeight: 44,
                      padding: '0 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--neon-red)',
                      color: '#fff',
                      fontWeight: 800,
                      letterSpacing: '0.05em',
                    }}
                  >
                    {busy === 'reset' ? 'RESETTING…' : 'YES — WIPE IT'}
                  </button>
                  <button
                    className="tap-btn"
                    onClick={() => setResetArmed(false)}
                    style={btnOutline('var(--panel-border)')}
                  >
                    <span style={{ color: '#8888aa' }}>CANCEL</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {commishError && (
            <div style={{ color: 'var(--neon-red)', marginTop: 10, fontSize: '0.78rem' }}>{commishError}</div>
          )}

          {/* TV mode */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--panel-border)' }}>
            <Link
              to="/draft/tv"
              style={{ color: 'var(--neon-blue)', fontSize: '0.85rem', textDecoration: 'none', fontWeight: 700 }}
            >
              📺 TV mode
            </Link>
          </div>
        </Section>
      )}
    </div>
  );
}

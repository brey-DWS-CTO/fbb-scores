import { useMemo, type CSSProperties, type ReactNode } from 'react';



import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';

import IdentityChip from './IdentityChip.js';

const th: CSSProperties = {
  padding: '4px 8px',
  color: 'var(--text-dim)',
  fontSize: '0.62rem',
  letterSpacing: '0.08em',
  fontWeight: 700,
  borderBottom: '1px solid var(--panel-border)',
  textAlign: 'left',
};
const td: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--panel-border)',
  color: 'var(--text-body)',
};
const right: CSSProperties = { textAlign: 'right' };

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

/** /league — rules reference (tiers, contracts, trades) + identity. */
export default function LeaguePage() {
  const { dataset } = useLeagueData();
  const { identity, signOut } = useIdentity();

  const contractPlayers = useMemo(
    () => dataset.players.filter((p) => p.keeper.contract != null),
    [dataset],
  );
  const activeContracts = useMemo(
    () =>
      contractPlayers
        .filter((p) => {
          const c = p.keeper.contract!;
          return !c.expired && c.lastKeepableSeason >= dataset.season;
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
    [contractPlayers, dataset.season],
  );
  const expiredContracts = useMemo(
    () =>
      contractPlayers.filter((p) => {
        const c = p.keeper.contract!;
        return c.expired === true || c.lastKeepableSeason < dataset.season;
      }),
    [contractPlayers, dataset.season],
  );

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <h1
          className="hub-heading glow-purple"
          style={{ fontSize: '0.85rem', color: 'var(--neon-purple)', margin: 0, lineHeight: 1.6 }}
        >
          LEAGUE HQ
        </h1>
        <IdentityChip />
      </div>

      {/* ── a. Keeper tiers ────────────────────────────────────── */}
      <Section title={`${dataset.season} KEEPER TIERS`} color="var(--neon-teal)">
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--text-mid)' }}>
            SALARY CAP
          </div>
          <div
            className="glow-teal"
            style={{ fontSize: '2.6rem', fontWeight: 800, color: 'var(--neon-teal)', lineHeight: 1.2 }}
          >
            {dataset.cap}
          </div>
          <div style={{ color: 'var(--text-mid)', fontSize: '0.75rem' }}>
            R3 max {dataset.capRule.round3Max} + R3 min {dataset.capRule.round3Min}
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
              {dataset.tiers.map((t) => (
                <tr key={t.round}>
                  <td style={{ ...td, color: 'var(--neon-blue)', fontWeight: 700 }}>R{t.round}</td>
                  <td style={{ ...td, ...right, color: 'var(--text-hi)' }}>
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
                    <td style={{ ...td, color: 'var(--text-hi)', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ ...td, color: p.fantasyTeam ? 'var(--text-body)' : 'var(--text-dim)' }}>
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
                <div key={p.key} style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
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
      <Section title="TRADES" color="var(--neon-orange)">
        {(dataset.tradeDetails ?? []).length === 0 ? (
          <div style={{ color: 'var(--text-faint)' }}>No trades this season.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {(dataset.tradeDetails ?? []).map((t) => (
              <div
                key={`${t.date}-${t.teams.join('-')}`}
                style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: '10px 12px' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-orange)' }}>
                    {t.teams[0].toUpperCase()} ⇄ {t.teams[1].toUpperCase()}
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem', marginLeft: 'auto' }}>
                    {formatDate(t.date)}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {t.teams.map((teamName) => (
                    <div key={teamName}>
                      <div style={{ color: 'var(--neon-teal)', fontWeight: 800, fontSize: '0.8rem', marginBottom: 2 }}>
                        {teamName} got:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(t.received[teamName] ?? []).map((item) => {
                          const isPick = item.toLowerCase().includes('pick');
                          return (
                            <span
                              key={item}
                              style={{
                                border: `1px solid ${isPick ? 'rgba(255,230,0,0.4)' : 'var(--panel-border)'}`,
                                background: isPick ? 'rgba(255,230,0,0.07)' : 'var(--chip-bg)',
                                color: isPick ? 'var(--neon-yellow)' : 'var(--text-hi)',
                                borderRadius: 999,
                                padding: '3px 10px',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                              }}
                            >
                              {isPick ? '🎯 ' : ''}
                              {item}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── d. Account ─────────────────────────────────────────── */}
      <Section title="ACCOUNT" color="var(--neon-yellow)">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
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
                color: 'var(--text-mid)',
                fontSize: '0.8rem',
                fontWeight: 700,
              }}
            >
              sign out
            </button>
          )}
        </div>
      </Section>

    </div>
  );
}

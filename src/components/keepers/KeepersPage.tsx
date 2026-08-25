import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { pickLabel, resolveTeamKeepers } from '../../lib/keeper/engine.js';
import { leagueDataset, OWNERS, teamByOwner } from '../../lib/league/data.js';
import { useIdentity, useLeagueState } from '../../hooks/useLeague.js';
import IdentityChip from '../league/IdentityChip.js';
import { CapBar, LockBanner, RoundChip, fmt1 } from './keeperUi.js';

/** /keepers — league-wide keeper overview, one card per team. */
export default function KeepersPage() {
  const { state } = useLeagueState();
  const { identity } = useIdentity();

  const cards = useMemo(
    () =>
      OWNERS.map((owner) => {
        const selections = state.keepers[owner] ?? [];
        return {
          owner,
          team: teamByOwner.get(owner),
          selections,
          result: resolveTeamKeepers(leagueDataset, owner, selections),
        };
      }),
    [state.keepers],
  );
  const submitted = cards.filter((c) => c.selections.length > 0).length;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 12px 24px' }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 6,
        }}
      >
        <div>
          <h1
            className="hub-heading glow-teal"
            style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}
          >
            KEEPER WORKSHEET
          </h1>
          <div style={{ color: '#8888aa', fontSize: '0.75rem', marginTop: 4 }}>
            Season {leagueDataset.season}
          </div>
        </div>
        <IdentityChip />
      </div>
      <div style={{ color: '#8888aa', fontSize: '0.78rem', marginBottom: 14 }}>
        Cap: {leagueDataset.cap} combined FPPG · {leagueDataset.maxKeepersPerTeam} keepers max
      </div>

      {state.locks.keepersLocked && <LockBanner />}

      {/* ── My team quick link ─────────────────────────────────── */}
      {identity && (
        <Link
          to={`/keepers/${encodeURIComponent(identity.owner)}`}
          className="panel tap-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '12px 14px',
            minHeight: 44,
            borderRadius: 10,
            borderColor: 'var(--neon-teal)',
            textDecoration: 'none',
            marginBottom: 14,
          }}
        >
          <span className="hub-heading" style={{ fontSize: '0.6rem', color: 'var(--neon-teal)' }}>
            MY TEAM → {identity.owner.toUpperCase()}
          </span>
          <span style={{ color: 'var(--neon-teal)', fontSize: '1.1rem', lineHeight: 1 }}>▶</span>
        </Link>
      )}

      {/* ── Team cards ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
        {cards.map(({ owner, team, selections, result }) => {
          const problem = selections.length > 0 && !result.valid ? result.errors[0] : null;
          return (
            <Link
              key={owner}
              to={`/keepers/${encodeURIComponent(owner)}`}
              className="panel tap-btn"
              style={{
                display: 'block',
                padding: '12px 14px',
                borderRadius: 10,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>{owner}</span>
                <span
                  style={{
                    color: '#666688',
                    fontSize: '0.7rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {team?.espnTeamName}
                </span>
              </div>

              <div style={{ display: 'grid', gap: 4, margin: '10px 0' }}>
                {selections.length === 0 ? (
                  <div style={{ color: '#555577', fontSize: '0.8rem' }}>No keepers yet</div>
                ) : (
                  result.keepers.map((k) => (
                    <div
                      key={k.selection.playerKey}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: '0.82rem',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span
                          style={{
                            color: '#e0e0e0',
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {k.player?.name ?? k.selection.playerName}
                        </span>
                        {k.round !== null && <RoundChip round={k.round} />}
                      </span>
                      <span style={{ color: '#8888aa', flexShrink: 0 }}>
                        {k.pick ? `pick ${pickLabel(k.pick)}` : '—'} · {fmt1(k.effectiveAvg)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <CapBar used={result.capUsed} limit={result.capLimit} height={6} />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 4,
                  fontSize: '0.65rem',
                  color: '#666688',
                }}
              >
                <span>
                  {result.capUsed.toFixed(1)} / {result.capLimit} cap
                </span>
                {selections.length > 0 && (
                  <span>
                    {selections.length} keeper{selections.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {problem && (
                <div style={{ color: 'var(--neon-red)', fontSize: '0.7rem', marginTop: 6 }}>⚠ {problem}</div>
              )}
            </Link>
          );
        })}
      </div>

      {/* ── Footer stat ────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', color: '#8888aa', fontSize: '0.78rem', marginTop: 16 }}>
        {submitted}/{OWNERS.length} teams have submitted keepers
      </div>
    </div>
  );
}

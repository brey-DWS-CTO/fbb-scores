import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { fetchNbaWatch } from '../../lib/league/api.js';
import { shortName } from '../../lib/league/draftRoom.js';
import {
  DEPTH_POSITIONS,
  awardBadges,
  depthSpots,
  nameKey,
  type AwardBadge,
  type DepthPlayer,
  type NbaWatch,
} from '../../lib/league/nbaWatch.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';

/** Rows shown for each award. DPOY is one man's to lose, so it shows fewer. */
const AWARD_ROWS = 10;
const rowsFor = (awardId: string) => (awardId === 'dpoy' ? 5 : AWARD_ROWS);
/** Depth shown for each position: starter, second, third. */
const DEPTH = 3;

const pct = (chance: number) => `${Math.round(chance * 100)}%`;

export type NbaWatchView = 'awards' | 'depth';

/**
 * Commish only. /awards: award odds from Kalshi. /depth: every team's depth
 * chart from ESPN. One read feeds both: each page uses the other's data for
 * its tags.
 */
export default function NbaWatchPage({ view }: { view: NbaWatchView }) {
  const { identity } = useIdentity();
  const isCommish = identity?.isCommissioner === true;
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [team, setTeam] = useState('ALL');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['nba-watch'],
    queryFn: () => fetchNbaWatch(identity as NonNullable<typeof identity>),
    enabled: isCommish,
    staleTime: 10 * 60_000,
  });
  const refresh = async () => {
    if (!identity) return;
    setRefreshing(true);
    try {
      queryClient.setQueryData(['nba-watch'], await fetchNbaWatch(identity, true));
    } finally {
      setRefreshing(false);
    }
  };

  const data: NbaWatch | undefined = query.data;
  const spots = useMemo(() => depthSpots(data?.teams ?? []), [data]);
  const badges = useMemo(() => awardBadges(data?.awards ?? []), [data]);

  if (!isCommish) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 12px' }}>
        <div className="panel" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>COMMISH ONLY</div>
          <div style={{ color: 'var(--text-mid)', marginTop: 10, fontSize: '0.85rem' }}>
            Sign in as the commish to see {view === 'awards' ? 'award odds' : 'depth charts'}.
          </div>
        </div>
      </div>
    );
  }

  const needle = nameKey(search);
  const shownTeams = (data?.teams ?? [])
    .filter((entry) => team === 'ALL' || entry.abbrev === team)
    .filter((entry) => !needle || DEPTH_POSITIONS.some((position) => entry.slots[position].some((player) => nameKey(player.name).includes(needle))));

  return (
    <main className="schedule-page nba-watch">
      <header className="schedule-page-header">
        <div>
          <Link className="schedule-back-link" to="/admin">← COMMISH MODE</Link>
          <h1 className="hub-heading glow-orange">
            <NavIcon name={view === 'awards' ? 'trophy' : 'people'} size={18} className="icon-in-heading" />
            {view === 'awards' ? 'AWARDS' : 'DEPTH CHARTS'}
          </h1>
          <p>
            {view === 'awards' ? 'Award odds from Kalshi. Team and depth spot from ESPN.' : 'Depth charts from ESPN. Award badges from Kalshi.'}
            {data && <> Read {new Date(data.fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</>}
          </p>
        </div>
        <div className="nba-watch-actions">
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => void refresh()} disabled={refreshing || query.isFetching}>
            {refreshing ? 'READING…' : 'REFRESH'}
          </button>
          <IdentityChip />
        </div>
      </header>

      {query.isLoading && <div className="mock-note">Reading Kalshi and ESPN…</div>}
      {query.isError && <div className="mock-note mock-note-bad">Could not read the odds or depth charts. Try REFRESH.</div>}

      {data && (
        <>
          {view === 'awards' && <section className="nba-awards">
            {data.awards.map(({ award, rows, error }) => {
              const shown = rows.slice(0, rowsFor(award.id));
              const thin = shown.some((row) => row.thin);
              return (
                <div key={award.id} className="panel nba-award">
                  <div className="hub-heading nba-award-head">
                    {award.label}
                    <small>{award.title}</small>
                  </div>
                  {error ? <div className="mock-note mock-note-bad">{error}</div>
                    : rows.length === 0 ? <div className="mock-note mock-note-dim">No open market yet.</div>
                      : (
                        <ol className="nba-award-list">
                          {shown.map((row, index) => {
                            const spot = spots.get(nameKey(row.name));
                            return (
                              <li key={row.name}>
                                <span className="nba-award-rank">{index + 1}</span>
                                <span className="nba-award-name">
                                  {row.name}
                                  {spot && <small>{spot.abbrev} · {spot.spots.slice(0, 2).join(', ')}</small>}
                                </span>
                                <span className="nba-award-odds">
                                  <strong>{pct(row.chance)}</strong>
                                  {row.thin && <small title="Buy and sell prices">{Math.round(row.bid * 100)}–{pct(row.ask)}</small>}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                  {thin && <div className="mock-note mock-note-dim nba-award-thin">Few bets so far on the rows with a range under them. Those show the best offer, not the middle.</div>}
                </div>
              );
            })}
          </section>}

          {view === 'depth' && <section className="nba-depth">
            <div className="hub-heading nba-depth-head">
              <small>Starter first. OUT marks an injury, with ESPN's note on hover. Badges show a 10% or better shot at an award.</small>
            </div>
            <div className="nba-depth-filters">
              <select className="hub-input mock-select" aria-label="Team" value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="ALL">All teams</option>
                {data.teams.map((entry) => <option key={entry.abbrev} value={entry.abbrev}>{entry.name}</option>)}
              </select>
              <input className="hub-input" type="search" placeholder="Find a player" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            {data.errors.length > 0 && <div className="mock-note mock-note-bad">ESPN missed {data.errors.length} team{data.errors.length === 1 ? '' : 's'}. Try REFRESH.</div>}
            {shownTeams.length === 0 && <div className="mock-note">No team matches.</div>}
            <div className="nba-depth-grid">
              {shownTeams.map((entry) => (
                <div key={entry.teamId} className="panel nba-team">
                  <div className="nba-team-head"><strong>{entry.abbrev}</strong> {entry.name}</div>
                  <table className="nba-team-table">
                    <thead>
                      <tr><th aria-label="Position" /><th>1</th><th>2</th><th>3</th></tr>
                    </thead>
                    <tbody>
                      {DEPTH_POSITIONS.map((position) => (
                        <tr key={position}>
                          <th>{position}</th>
                          {Array.from({ length: DEPTH }, (_, index) => {
                            const player = entry.slots[position][index];
                            return (
                              <td key={index}>
                                {player && (
                                  <DepthName
                                    player={player}
                                    badges={badges.get(nameKey(player.name)) ?? []}
                                    match={needle !== '' && nameKey(player.name).includes(needle)}
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>}
        </>
      )}
    </main>
  );
}

/** A name in a depth chart, with an injury mark and any award badges. */
function DepthName({ player, badges, match }: { player: DepthPlayer; badges: readonly AwardBadge[]; match: boolean }) {
  // Preseason fills day-to-day with rest nights, so only OUT is marked.
  const out = player.injury?.status.toLowerCase() === 'out';
  return (
    <span className={`nba-depth-name${match ? ' is-match' : ''}`}>
      <span className="nba-name-full">{player.name}</span>
      <span className="nba-name-short">{shortName(player.name)}</span>
      {out && <span className="nba-injury is-out" title={player.injury?.note || 'Out'}>OUT</span>}
      {badges.map((badge) => (
        <span key={badge.label} className="nba-badge" title={`${badge.label} ${pct(badge.chance)}`}>
          {badge.label} {pct(badge.chance)}
        </span>
      ))}
    </span>
  );
}

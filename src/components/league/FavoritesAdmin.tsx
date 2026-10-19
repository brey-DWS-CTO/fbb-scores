import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OWNERS } from '../../lib/league/data.js';
import { useIdentity } from '../../hooks/useLeague.js';
import { apiErrorMessage, fetchFavorites, saveFavoritesFor } from '../../lib/league/api.js';
import { NBA_TEAM_INFO, type FavoritesByOwner } from '../../lib/league/houseParty.js';
import TeamLogo from './TeamLogo.js';

const OWNERS_A_TO_Z = [...OWNERS].sort((a, b) => a.localeCompare(b));

/** Commish only: set or fix anyone's favorite teams, one row an owner. */
export default function FavoritesAdmin() {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery<FavoritesByOwner>({
    queryKey: ['favorites'],
    queryFn: () => fetchFavorites(identity as NonNullable<typeof identity>),
    enabled: identity !== null,
    staleTime: 60_000,
  });
  const favorites = query.data ?? {};

  const set = async (owner: string, first: string, second: string) => {
    if (!identity) return;
    setBusy(owner);
    setError(null);
    try {
      const next = await saveFavoritesFor(identity, owner, first || null, second || null);
      queryClient.setQueryData(['favorites'], next);
      queryClient.invalidateQueries({ queryKey: ['watch'] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel" style={{ padding: 14, borderRadius: 10, marginBottom: 14 }}>
      <div className="hub-heading" style={{ fontSize: '0.62rem', color: 'var(--neon-teal)', marginBottom: 6 }}>
        FAVORITE TEAMS
      </div>
      <div style={{ color: 'var(--text-mid)', fontSize: '0.75rem', marginBottom: 10 }}>
        Who roots for whom. Each member can change their own from the account menu; fix one here if they ask.
      </div>
      {error && <div className="mock-note mock-note-bad">{error}</div>}
      <div className="favorites-admin">
        {OWNERS_A_TO_Z.map((owner) => {
          const mine = favorites[owner];
          return (
            <div key={owner} className="favorites-admin-row">
              <strong>{owner}</strong>
              <TeamLogo code={mine?.first ?? null} size={24} />
              <select
                className="hub-input"
                aria-label={`${owner}'s first team`}
                value={mine?.first ?? ''}
                disabled={busy === owner}
                onChange={(event) => void set(owner, event.target.value, event.target.value ? mine?.second ?? '' : '')}
              >
                <option value="">None</option>
                {NBA_TEAM_INFO.map((team) => <option key={team.code} value={team.code}>{team.name}</option>)}
              </select>
              <TeamLogo code={mine?.second ?? null} size={24} />
              <select
                className="hub-input"
                aria-label={`${owner}'s second team`}
                value={mine?.second ?? ''}
                disabled={busy === owner || !mine?.first}
                onChange={(event) => void set(owner, mine?.first ?? '', event.target.value)}
              >
                <option value="">None</option>
                {NBA_TEAM_INFO.filter((team) => team.code !== mine?.first).map((team) => <option key={team.code} value={team.code}>{team.name}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

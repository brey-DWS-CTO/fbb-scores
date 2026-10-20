import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { fetchFavorites } from '../../lib/league/api.js';
import { teamNickname, type FavoritesByOwner } from '../../lib/league/houseParty.js';
import FavoritesSheet from './FavoritesSheet.js';
import TeamLogo from './TeamLogo.js';

/** The FAVORITE TEAMS row in the account menu: your logos, and CHANGE. */
export default function AccountFavorites() {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery<FavoritesByOwner>({
    queryKey: ['favorites'],
    queryFn: () => fetchFavorites(identity as NonNullable<typeof identity>),
    enabled: identity !== null,
    staleTime: 5 * 60_000,
  });
  if (!identity) return null;
  const mine = query.data?.[identity.owner] ?? null;
  return (
    <div className="account-favorites">
      {open ? (
        <FavoritesSheet
          compact
          current={mine}
          onSaved={(favorites) => {
            queryClient.setQueryData(['favorites'], favorites);
            queryClient.invalidateQueries({ queryKey: ['watch'] });
            setOpen(false);
          }}
          onSkip={() => setOpen(false)}
        />
      ) : (
        <div className="account-favorites-line">
          <span className="identity-label">FAVORITE TEAMS</span>
          <span className="account-favorites-teams">
            <TeamLogo code={mine?.first ?? null} size={26} />
            {mine?.second && <TeamLogo code={mine.second} size={26} />}
            <span>{mine ? `${teamNickname(mine.first)}${mine.second ? `, ${teamNickname(mine.second)}` : ''}` : query.isLoading ? '…' : 'None yet'}</span>
          </span>
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => setOpen(true)}>{mine ? 'CHANGE' : 'PICK'}</button>
        </div>
      )}
    </div>
  );
}

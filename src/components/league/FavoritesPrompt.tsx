import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { fetchFavorites } from '../../lib/league/api.js';
import { readFavoritesSkips, writeFavoritesSkips, MAX_FAVORITES_SKIPS } from '../../lib/league/favoritesPrompt.js';
import type { FavoritesByOwner } from '../../lib/league/houseParty.js';
import FavoritesSheet from './FavoritesSheet.js';

/**
 * Asks once, after sign-in, which NBA team you root for. Goes away for good
 * after a pick, or after two skips. Nothing else in the app waits on it.
 */
export default function FavoritesPrompt() {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const owner = identity?.owner ?? null;
  const [skipsThisSession, setSkips] = useState(0);
  const query = useQuery<FavoritesByOwner>({
    queryKey: ['favorites'],
    queryFn: () => fetchFavorites(identity as NonNullable<typeof identity>),
    enabled: identity !== null,
    staleTime: 5 * 60_000,
  });
  if (!identity || !owner || !query.isSuccess) return null;
  if (query.data[owner]) return null;
  const storage = typeof window === 'undefined' ? undefined : window.localStorage;
  if (readFavoritesSkips(storage, owner) >= MAX_FAVORITES_SKIPS || skipsThisSession > 0) return null;

  const skip = () => {
    writeFavoritesSkips(storage, owner, readFavoritesSkips(storage, owner) + 1);
    setSkips((count) => count + 1);
  };
  const saved = (favorites: FavoritesByOwner) => {
    queryClient.setQueryData(['favorites'], favorites);
    queryClient.invalidateQueries({ queryKey: ['watch'] });
  };

  return createPortal(
    <div className="account-backdrop" onClick={skip}>
      <div className="panel account-sheet favorites-prompt" role="dialog" aria-modal="true" aria-labelledby="favorites-prompt-title" onClick={(event) => event.stopPropagation()}>
        <div className="account-sheet-header">
          <div>
            <div className="splash-step">ONE QUICK THING</div>
            <h2 id="favorites-prompt-title">Who do you root for?</h2>
            <p>Your team's games go to the top of WATCH, and the league sees your colors.</p>
          </div>
        </div>
        <FavoritesSheet current={null} onSaved={saved} onSkip={skip} title="YOUR TEAM" />
      </div>
    </div>,
    document.body,
  );
}

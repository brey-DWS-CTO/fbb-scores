import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { useWatch } from '../../hooks/useWatch.js';
import { fetchPublicParty, type PublicParty } from '../../lib/league/api.js';
import { dayLabel, matchupLabel, tipLabel } from '../../lib/league/houseParty.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import PartyCard, { PartyGameLine } from './PartyCard.js';
import SignInPanel from './SignInPanel.js';

/**
 * A party at its share link. Anyone can open it and see the games, the
 * night, the host, the note and who is in. Signed in, it is the full card:
 * say you are in, see what everyone brings, share it on.
 */
export default function PartyPage() {
  const { id = '' } = useParams();
  const { identity } = useIdentity();
  const watch = useWatch(identity !== null);
  const query = useQuery<PublicParty>({
    queryKey: ['party-public', id],
    queryFn: () => fetchPublicParty(id),
    staleTime: 30_000,
    retry: false,
  });
  // The server's clock when it answered; until it does, the moment the page opened.
  const [opened] = useState(() => new Date());
  const serverNow = query.data?.now;
  const now = useMemo(() => (serverNow ? new Date(serverNow) : opened), [serverNow, opened]);
  const full = watch.data?.parties.find((party) => party.id === id) ?? null;

  return (
    <main className="schedule-page watch-page party-page">
      <header className="schedule-page-header">
        <div>
          <Link className="schedule-back-link" to="/watch">← WATCH</Link>
          <h1 className="hub-heading glow-orange">
            <NavIcon name="home" size={18} className="icon-in-heading" />
            HOUSE PARTY
          </h1>
          {query.data && <p>{query.data.headline}</p>}
        </div>
        <IdentityChip />
      </header>

      {query.isLoading && <div className="mock-note">Finding the party…</div>}
      {query.isError && (
        <div className="panel party-card">
          <div className="party-host hub-heading">NO SUCH PARTY</div>
          <p className="party-note">That link is wrong or the party is from another season.</p>
        </div>
      )}

      {query.data && full && (
        <PartyCard party={full} rosters={watch.data?.rosters ?? {}} now={now} onChange={watch.putParty} linkToPage={false} />
      )}

      {query.data && !full && (
        <article className={`panel party-card${query.data.party.cancelledAt ? ' is-off' : ''}`}>
          <header className="party-head">
            <div>
              <div className="party-host hub-heading">
                {query.data.party.cancelledAt ? 'CALLED OFF' : query.data.party.host ? `${query.data.party.host} IS HOSTING` : 'NOBODY HAS THE HOUSE YET'}
              </div>
              <div className="party-when">
                {query.data.party.games[0] && <>{dayLabel(query.data.party.games[0].tipoff)}, {tipLabel(query.data.party.games[0].tipoff)} · </>}
                {query.data.party.guests.length} in
              </div>
            </div>
          </header>
          <div className="party-games">
            {query.data.party.games.map((game, index) => (
              <PartyGameLine key={game.id} game={game} rosters={{}} main={index === 0 && query.data!.party.games.length > 1} />
            ))}
          </div>
          {query.data.party.note && <p className="party-note">{query.data.party.note}</p>}
          <div className="party-guests">
            {query.data.party.guests.length === 0 && <div className="mock-note mock-note-dim">Nobody is in yet.</div>}
            {query.data.party.guests.map((guest) => (
              <div key={guest} className="party-guest">
                <span className="party-guest-name">{guest}{guest === query.data!.party.host && <small>host</small>}</span>
              </div>
            ))}
          </div>
          {!identity && <div className="mock-note">{matchupLabel(query.data.party.games[0] ?? { home: '', away: '' })}: sign in below to say you are in.</div>}
        </article>
      )}

      {query.data && !identity && <SignInPanel reason="Sign in to say you're in and see whose players are playing." />}
    </main>
  );
}

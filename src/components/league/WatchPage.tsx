import { useMemo, useState } from 'react';
import { useIdentity } from '../../hooks/useLeague.js';
import { useWatch } from '../../hooks/useWatch.js';
import { OWNERS } from '../../lib/league/data.js';
import { apiErrorMessage, fetchWatch, openHouseParty } from '../../lib/league/api.js';
import {
  byNight,
  dayLabel,
  fansOf,
  lastName,
  liveParties,
  matchupLabel,
  partiesForGame,
  partyTally,
  pastParties,
  rankGames,
  teamNickname,
  tipLabel,
  whoIsIn,
  type HouseParty,
  type NbaGame,
  type WatchGame,
} from '../../lib/league/houseParty.js';
import FavoritesSheet from './FavoritesSheet.js';
import HostSheet from './HostSheet.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import PartyCard from './PartyCard.js';
import SignInPanel from './SignInPanel.js';
import TeamLogo from './TeamLogo.js';

type View = 'for-you' | 'nights' | 'parties';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'for-you', label: 'FOR YOU' },
  { id: 'nights', label: 'BY NIGHT' },
  { id: 'parties', label: 'PARTIES' },
];

/** Games already over for more than half a day are off the list. */
const stale = (game: NbaGame, now: Date) => game.state === 'post' && now.getTime() - Date.parse(game.tipoff) > 12 * 60 * 60 * 1000;

/**
 * WATCH: the next two weeks of NBA games ranked for you, and the house
 * parties around them. Tap HOST on a game to throw one, UP FOR IT to say you
 * would come to one, I'M IN on a party to join it.
 */
export default function WatchPage() {
  const { identity } = useIdentity();
  const watch = useWatch();
  const [view, setView] = useState<View>('for-you');
  const [hosting, setHosting] = useState<{ main: NbaGame; editing: HouseParty | null } | null>(null);
  const [pickingTeams, setPickingTeams] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyGame, setBusyGame] = useState<string | null>(null);

  const data = watch.data;
  // The server's clock when it answered; until it does, the moment the page opened.
  const [opened] = useState(() => new Date());
  const serverNow = data?.now;
  const now = useMemo(() => (serverNow ? new Date(serverNow) : opened), [serverNow, opened]);
  const viewer = identity?.owner ?? '';
  const ranked = useMemo(() => (data
    ? rankGames({ viewer, games: data.games.filter((game) => !stale(game, now)), favorites: data.favorites, rosters: data.rosters })
    : []), [data, viewer, now]);
  const nights = useMemo(() => byNight(ranked), [ranked]);
  const live = useMemo(() => (data ? liveParties(data.parties, now) : []), [data, now]);
  const past = useMemo(() => (data ? pastParties(data.parties, now) : []), [data, now]);
  const tally = useMemo(() => (data ? partyTally(OWNERS, data.parties, now).filter((row) => row.attended > 0 || row.hosted > 0) : []), [data, now]);

  if (!identity) return <SignInPanel reason="Sign in to see the games worth watching and who is hosting." />;

  const mine = data?.favorites[viewer] ?? null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      watch.replace(await fetchWatch(identity, true));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  };

  const upFor = async (game: NbaGame) => {
    if (busyGame) return;
    setBusyGame(game.id);
    setError(null);
    try {
      const result = await openHouseParty(identity, { gameIds: [game.id], hosting: false, note: '' });
      watch.putParty(result.party);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusyGame(null);
    }
  };

  const gameById = (id: string) => data?.games.find((game) => game.id === id) ?? null;

  const partyList = (parties: HouseParty[]) => parties.map((party) => (
    <PartyCard
      key={party.id}
      party={party}
      rosters={data?.rosters ?? {}}
      now={now}
      onChange={watch.putParty}
      onEdit={(target) => {
        const main = gameById(target.games[0]?.id ?? '');
        if (main) setHosting({ main, editing: target });
      }}
    />
  ));

  const gameCard = (game: WatchGame) => {
    const parties = data ? partiesForGame(data.parties, game.id, now) : [];
    const upForIt = parties.filter((party) => !party.host);
    const hosted = parties.filter((party) => party.host);
    const iAmUpFor = upForIt.some((party) => whoIsIn(party).includes(viewer));
    const done = game.state === 'post';
    return (
      <article key={game.id} className={`panel game-card${game.favorites.length > 0 ? ' is-favorite' : ''}${done ? ' is-done' : ''}${game.state === 'in' ? ' is-live' : ''}`}>
        <div className="game-when">
          <strong>{dayLabel(game.tipoff)}</strong>
          <span>{game.state === 'pre' ? tipLabel(game.tipoff) : game.detail}</span>
          {game.tv && <span className="game-tv">{game.tv}</span>}
          {game.state === 'in' && <span className="game-live">LIVE</span>}
        </div>
        <div className="game-teams">
          <span className="game-team">
            <TeamLogo code={game.away} size={36} />
            <span>{teamNickname(game.away)}</span>
            {game.awayScore !== null && game.state !== 'pre' && <b>{game.awayScore}</b>}
          </span>
          <span className="game-at">at</span>
          <span className="game-team">
            <TeamLogo code={game.home} size={36} />
            <span>{teamNickname(game.home)}</span>
            {game.homeScore !== null && game.state !== 'pre' && <b>{game.homeScore}</b>}
          </span>
        </div>
        {game.stakes.length > 0 && (
          <div className="game-stakes">
            {game.stakes.map((stake) => (
              <span key={stake.owner} className={`stake-owner${stake.owner === viewer ? ' is-me' : ''}`}>
                <b>{stake.owner === viewer ? 'You' : stake.owner}</b>
                {stake.players.map((player) => <span key={player.key} className="stake-chip" title={player.name}>{lastName(player.name)}</span>)}
              </span>
            ))}
          </div>
        )}
        {(() => {
          const fans = data ? fansOf(data.favorites, game.home).concat(fansOf(data.favorites, game.away)).filter((owner) => owner !== viewer) : [];
          return fans.length > 0 ? <div className="game-fans">Fans: {fans.join(', ')}</div> : null;
        })()}
        {hosted.map((party) => (
          <div key={party.id} className="game-party">
            <NavIcon name="home" size={14} className="icon-in-heading" />
            <span><b>{party.host}</b> is hosting · {whoIsIn(party).length} in</span>
            <button type="button" className="tap-btn mock-mini-btn is-primary" onClick={() => setView('parties')}>SEE IT</button>
          </div>
        ))}
        {upForIt.length > 0 && (
          <div className="game-party is-open">
            <NavIcon name="people" size={14} className="icon-in-heading" />
            <span>Up for it: {upForIt.flatMap(whoIsIn).join(', ')}</span>
            <button type="button" className="tap-btn mock-mini-btn" onClick={() => setView('parties')}>SEE IT</button>
          </div>
        )}
        {!done && (
          <div className="game-actions">
            <button type="button" className="tap-btn mock-mini-btn is-host" onClick={() => setHosting({ main: game, editing: null })}>HOST</button>
            {!iAmUpFor && hosted.length === 0 && (
              <button type="button" className="tap-btn mock-mini-btn" disabled={busyGame === game.id} onClick={() => void upFor(game)}>
                {busyGame === game.id ? 'SAVING…' : "I'M UP FOR IT"}
              </button>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <main className="schedule-page watch-page">
      <header className="schedule-page-header">
        <div>
          <h1 className="hub-heading glow-orange">
            <NavIcon name="tv" size={18} className="icon-in-heading" />
            WATCH
          </h1>
          <p>
            Games worth your couch, and whose couch. Your teams first, then the games with the most league players.
            {data && <> Read {new Date(data.fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</>}
          </p>
        </div>
        <div className="nba-watch-actions">
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => void refresh()} disabled={refreshing || watch.isFetching}>
            {refreshing ? 'READING…' : 'REFRESH'}
          </button>
          <IdentityChip />
        </div>
      </header>

      <section className="panel watch-favorites">
        <div className="watch-favorites-line">
          <TeamLogo code={mine?.first ?? null} size={30} />
          {mine?.second && <TeamLogo code={mine.second} size={30} />}
          <span>
            {mine
              ? <>Your {teamNickname(mine.first)}{mine.second ? ` and ${teamNickname(mine.second)}` : ''}.</>
              : 'No favorite team yet. Pick one and its games go to the top.'}
          </span>
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => setPickingTeams((open) => !open)}>
            {pickingTeams ? 'CLOSE' : mine ? 'CHANGE' : 'PICK A TEAM'}
          </button>
        </div>
        {pickingTeams && (
          <FavoritesSheet
            compact
            current={mine}
            onSaved={(favorites) => {
              watch.putFavorites(favorites);
              setPickingTeams(false);
            }}
          />
        )}
      </section>

      <nav className="watch-tabs" aria-label="Views">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`tap-btn watch-tab hub-heading${view === entry.id ? ' active' : ''}`}
            onClick={() => setView(entry.id)}
          >
            {entry.label}
            {entry.id === 'parties' && live.length > 0 && <span className="nav-pill">{live.length}</span>}
          </button>
        ))}
      </nav>

      {error && <div className="mock-note mock-note-bad">{error}</div>}
      {watch.isLoading && <div className="mock-note">Reading the schedule…</div>}
      {watch.isError && <div className="mock-note mock-note-bad">Could not read the schedule. Try REFRESH.</div>}
      {data?.error && <div className="mock-note mock-note-warn">{data.error}</div>}

      {data && view === 'for-you' && (
        <section className="watch-games">
          {ranked.length === 0 && <div className="mock-note mock-note-dim">No games in the next two weeks.</div>}
          {ranked.map(gameCard)}
        </section>
      )}

      {data && view === 'nights' && (
        <section className="watch-nights">
          {nights.map((night) => (
            <div key={night.day} className="watch-night">
              <h2 className="hub-heading watch-night-head">{night.label}</h2>
              <div className="watch-games">{night.games.map(gameCard)}</div>
            </div>
          ))}
        </section>
      )}

      {data && view === 'parties' && (
        <section className="watch-parties">
          {live.length === 0 && (
            <div className="mock-note mock-note-dim">
              No parties on the calendar. Tap HOST on a game, or I'M UP FOR IT and see who bites.
            </div>
          )}
          {partyList(live)}
          {tally.length > 0 && (
            <div className="panel party-tally">
              <div className="hub-heading party-tally-head">PARTY PEOPLE</div>
              <table className="party-tally-table">
                <thead><tr><th>Who</th><th>Went</th><th>Hosted</th></tr></thead>
                <tbody>
                  {tally.map((row) => <tr key={row.owner}><td>{row.owner}</td><td>{row.attended}</td><td>{row.hosted}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
          {past.length > 0 && (
            <>
              <h2 className="hub-heading watch-night-head">ALREADY HAPPENED</h2>
              {partyList(past)}
            </>
          )}
        </section>
      )}

      {hosting && data && (
        <HostSheet
          main={hosting.main}
          games={ranked}
          editing={hosting.editing}
          onDone={(party) => {
            watch.putParty(party);
            setHosting(null);
            setView('parties');
          }}
          onClose={() => setHosting(null)}
        />
      )}
      {hosting && !data && <div className="mock-note">{matchupLabel(hosting.main)}</div>}
    </main>
  );
}

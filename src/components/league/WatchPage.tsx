import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { useWatch } from '../../hooks/useWatch.js';
import { answerHouseParty, apiErrorMessage, fetchWatch } from '../../lib/league/api.js';
import {
  byNight,
  dayLabel,
  fansOf,
  lastName,
  liveParties,
  partiesForGame,
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
import SignInPanel from './SignInPanel.js';
import TeamLogo from './TeamLogo.js';

type View = 'games' | 'nights';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'games', label: 'GAMES' },
  { id: 'nights', label: 'BY NIGHT' },
];

/** Games already over for more than half a day are off the list. */
const stale = (game: NbaGame, now: Date) => game.state === 'post' && now.getTime() - Date.parse(game.tipoff) > 12 * 60 * 60 * 1000;

/**
 * WATCH: the next two weeks of NBA games ranked for you, and who is hosting
 * each one. Every card ends in one button: HOST when nobody has the house,
 * JOIN when somebody does. The party itself lives at its own page.
 */
export default function WatchPage() {
  const { identity } = useIdentity();
  const watch = useWatch();
  const [view, setView] = useState<View>('games');
  const [hosting, setHosting] = useState<NbaGame | null>(null);
  const [pickingTeams, setPickingTeams] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyParty, setBusyParty] = useState<string | null>(null);

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
  const mineLive = useMemo(() => (data ? liveParties(data.parties, now).filter((party) => whoIsIn(party).includes(viewer)) : []), [data, now, viewer]);

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

  const join = async (party: HouseParty) => {
    if (busyParty) return;
    setBusyParty(party.id);
    setError(null);
    try {
      watch.putParty((await answerHouseParty(identity, party.id, 'in')).party);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusyParty(null);
    }
  };

  const gameCard = (game: WatchGame) => {
    const party = data ? partiesForGame(data.parties, game.id, now).find((row) => row.host) ?? null : null;
    const inIt = party !== null && whoIsIn(party).includes(viewer);
    const done = game.state === 'post';
    const stakes = [...game.stakes].sort((a, b) => Number(b.owner === viewer) - Number(a.owner === viewer) || b.players.length - a.players.length || a.owner.localeCompare(b.owner));
    const fans = data ? fansOf(data.favorites, game.home).concat(fansOf(data.favorites, game.away)).filter((owner) => owner !== viewer) : [];
    return (
      <article key={game.id} className={`panel game-card${game.favorites.length > 0 ? ' is-favorite' : ''}${done ? ' is-done' : ''}${game.state === 'in' ? ' is-live' : ''}`}>
        <div className="game-when">
          <strong>{dayLabel(game.tipoff)}</strong>
          <span>{game.state === 'pre' ? tipLabel(game.tipoff) : game.detail}</span>
          {game.tv && <span className="game-tv">{game.tv}</span>}
          {game.state === 'in' && <span className="game-live">LIVE</span>}
          {game.favorites.length > 0 && <span className="game-yours">YOUR {game.favorites.map((team) => teamNickname(team).toUpperCase()).join(' & ')}</span>}
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
        <div className="game-stakes">
          {stakes.length === 0 && <div className="game-stakes-none">No league players in this one.</div>}
          {stakes.map((stake) => (
            <div key={stake.owner} className={`stake-row${stake.owner === viewer ? ' is-me' : ''}`}>
              <b>{stake.owner === viewer ? 'You' : stake.owner}</b>
              <span>
                {stake.players.map((player) => <span key={player.key} className="stake-chip" title={player.name}>{lastName(player.name)}</span>)}
              </span>
            </div>
          ))}
        </div>
        {fans.length > 0 && <div className="game-fans">Fans: {fans.join(', ')}</div>}
        <div className="game-foot">
          {party ? (
            <>
              <Link className="game-party-line" to={`/party/${party.id}`}>
                <NavIcon name="home" size={14} className="icon-in-heading" />
                <b>{party.host}</b> is hosting · {whoIsIn(party).length} in
              </Link>
              {inIt
                ? <Link className="mock-mini-btn tap-btn is-in" to={`/party/${party.id}`}>YOU'RE IN</Link>
                : (
                  <button type="button" className="tap-btn mock-mini-btn is-primary" disabled={busyParty === party.id || done} onClick={() => void join(party)}>
                    {busyParty === party.id ? 'JOINING…' : 'JOIN'}
                  </button>
                )}
            </>
          ) : (
            <>
              <span className="game-party-line is-none">Nobody is hosting yet.</span>
              {!done && <button type="button" className="tap-btn mock-mini-btn is-host" onClick={() => setHosting(game)}>HOST</button>}
            </>
          )}
        </div>
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

      {mineLive.length > 0 && (
        <section className="panel watch-mine">
          <div className="hub-heading watch-mine-head">YOUR PARTIES</div>
          {mineLive.map((party) => (
            <Link key={party.id} className="watch-mine-row" to={`/party/${party.id}`}>
              <TeamLogo code={party.games[0]?.away ?? null} size={22} />
              <TeamLogo code={party.games[0]?.home ?? null} size={22} />
              <span>
                <strong>{party.games[0] ? `${teamNickname(party.games[0].away)} at ${teamNickname(party.games[0].home)}` : 'House party'}</strong>
                <small>{party.games[0] && `${dayLabel(party.games[0].tipoff)}, ${tipLabel(party.games[0].tipoff)} · `}{party.host === viewer ? 'you host' : `${party.host} hosts`} · {whoIsIn(party).length} in</small>
              </span>
              <span className="mock-mini-btn">OPEN</span>
            </Link>
          ))}
        </section>
      )}

      <nav className="watch-tabs" aria-label="Views">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`tap-btn watch-tab hub-heading${view === entry.id ? ' active' : ''}`}
            onClick={() => setView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {error && <div className="mock-note mock-note-bad">{error}</div>}
      {watch.isLoading && <div className="mock-note">Reading the schedule…</div>}
      {watch.isError && <div className="mock-note mock-note-bad">Could not read the schedule. Try REFRESH.</div>}
      {data?.error && <div className="mock-note mock-note-warn">{data.error}</div>}

      {data && view === 'games' && (
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

      {hosting && data && (
        <HostSheet
          main={hosting}
          games={ranked}
          onDone={(party) => {
            watch.putParty(party);
            setHosting(null);
          }}
          onClose={() => setHosting(null)}
        />
      )}
    </main>
  );
}

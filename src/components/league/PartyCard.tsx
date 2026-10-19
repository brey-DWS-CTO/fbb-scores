import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  answerHouseParty,
  apiErrorMessage,
  cancelHouseParty,
  hostHouseParty,
} from '../../lib/league/api.js';
import {
  answerOf,
  canManage,
  dayLabel,
  guestStakes,
  lastName,
  matchupLabel,
  partyHeadline,
  partyOver,
  rivalryIn,
  stakesIn,
  teamNickname,
  tipLabel,
  whoIsIn,
  type HouseParty,
  type PartyGame,
  type RostersByOwner,
} from '../../lib/league/houseParty.js';
import ShareButton from './ShareButton.js';
import TeamLogo from './TeamLogo.js';

interface Props {
  party: HouseParty;
  rosters: RostersByOwner;
  now: Date;
  onChange: (party: HouseParty) => void;
  onEdit?: (party: HouseParty) => void;
  /** On the share page the card is the whole page, so it links nowhere. */
  linkToPage?: boolean;
}

/** One line for one game: logos, names, night, TV, and the rivalry if any. */
export function PartyGameLine({ game, rosters, main }: { game: PartyGame; rosters: RostersByOwner; main: boolean }) {
  const rivalry = rivalryIn(game, stakesIn(game, rosters));
  return (
    <div className={main ? 'party-game is-main' : 'party-game'}>
      <span className="party-game-logos">
        <TeamLogo code={game.away} size={26} />
        <TeamLogo code={game.home} size={26} />
      </span>
      <span className="party-game-text">
        <strong>{matchupLabel(game)}</strong>
        <small>
          {dayLabel(game.tipoff)}, {tipLabel(game.tipoff)}
          {game.tv && <> · {game.tv}</>}
          {main && <> · main game</>}
        </small>
        {rivalry && (
          <small className="party-rivalry">
            RIVALRY · {rivalry.a.owner}'s {rivalry.a.player} vs {rivalry.b.owner}'s {rivalry.b.player}
          </small>
        )}
      </span>
    </div>
  );
}

/**
 * A party, whole: the games, the host, the note, who is in and what each of
 * them brings. Everyone signed in can say in or out, take an open house, or
 * share the link. The host can edit and call it off.
 */
export default function PartyCard({ party, rosters, now, onChange, onEdit, linkToPage = true }: Props) {
  const { identity } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const viewer = identity?.owner ?? null;
  const over = partyOver(party, now);
  const off = party.cancelledAt !== null;
  const mine = viewer ? answerOf(party, viewer) : null;
  const guests = whoIsIn(party);
  const stakes = guestStakes(party, rosters);
  const manage = viewer !== null && canManage(party, viewer, identity?.isCommissioner === true);
  const url = `${window.location.origin}/party/${party.id}`;

  const run = async (work: () => Promise<{ party: HouseParty }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange((await work()).party);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`panel party-card${off ? ' is-off' : ''}${over ? ' is-over' : ''}`}>
      <header className="party-head">
        <div>
          <div className="party-host hub-heading">
            {off ? 'CALLED OFF' : over ? 'HAPPENED' : party.host ? `${party.host} IS HOSTING` : 'NOBODY HAS THE HOUSE YET'}
          </div>
          <div className="party-when">{dayLabel(party.games[0]?.tipoff ?? party.createdAt)} · {guests.length} in</div>
        </div>
        <div className="party-actions-top">
          {linkToPage && <Link className="mock-mini-btn tap-btn party-link" to={`/party/${party.id}`}>OPEN</Link>}
          <ShareButton url={url} title={partyHeadline(party)} className="mock-mini-btn party-share" />
        </div>
      </header>

      <div className="party-games">
        {party.games.map((game, index) => <PartyGameLine key={game.id} game={game} rosters={rosters} main={index === 0 && party.games.length > 1} />)}
      </div>

      {party.note && <p className="party-note">{party.note}</p>}

      <div className="party-guests">
        {stakes.length === 0 && <div className="mock-note mock-note-dim">Nobody is in yet.</div>}
        {stakes.map((guest) => (
          <div key={guest.owner} className="party-guest">
            <span className="party-guest-name">
              {guest.owner}
              {guest.owner === party.host && <small>host</small>}
            </span>
            <span className="party-guest-players">
              {guest.total === 0 && <small className="party-guest-none">no players in these games</small>}
              {guest.byGame.map((players, index) => players.map((player) => (
                <span key={`${index}-${player.key}`} className="stake-chip" title={`${player.name}, ${teamNickname(player.proTeam)}`}>
                  {lastName(player.name)}
                </span>
              )))}
            </span>
          </div>
        ))}
      </div>

      {error && <div className="mock-note mock-note-bad">{error}</div>}

      {viewer && !off && !over && (
        <div className="party-actions">
          {mine !== 'in' && (
            <button type="button" className="tap-btn mock-mini-btn is-primary" disabled={busy} onClick={() => void run(() => answerHouseParty(identity!, party.id, 'in'))}>
              I'M IN
            </button>
          )}
          {mine === 'in' && party.host !== viewer && (
            <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => void run(() => answerHouseParty(identity!, party.id, 'out'))}>
              CAN'T MAKE IT
            </button>
          )}
          {!party.host && noteDraft === null && (
            <button type="button" className="tap-btn mock-mini-btn is-host" disabled={busy} onClick={() => setNoteDraft('')}>
              I'LL HOST
            </button>
          )}
          {manage && party.host && onEdit && (
            <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => onEdit(party)}>EDIT</button>
          )}
          {manage && !armed && (
            <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => setArmed(true)}>CALL IT OFF</button>
          )}
          {manage && armed && (
            <>
              <button type="button" className="tap-btn mock-mini-btn is-danger" disabled={busy} onClick={() => void run(() => cancelHouseParty(identity!, party.id))}>
                YES, CALL IT OFF
              </button>
              <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => setArmed(false)}>KEEP IT</button>
            </>
          )}
        </div>
      )}

      {viewer && noteDraft !== null && !party.host && (
        <form
          className="party-host-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => hostHouseParty(identity!, party.id, noteDraft)).then(() => setNoteDraft(null));
          }}
        >
          <input
            className="hub-input"
            placeholder="Address, what to bring"
            value={noteDraft}
            maxLength={280}
            onChange={(event) => setNoteDraft(event.target.value)}
          />
          <button type="submit" className="tap-btn mock-mini-btn is-host" disabled={busy}>TAKE THE HOUSE</button>
          <button type="button" className="tap-btn mock-mini-btn" disabled={busy} onClick={() => setNoteDraft(null)}>NEVER MIND</button>
        </form>
      )}
    </article>
  );
}

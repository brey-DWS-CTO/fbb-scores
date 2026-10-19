import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import {
  answerHouseParty,
  apiErrorMessage,
  cancelHouseParty,
  fetchPartyScore,
  hostHouseParty,
  type PartyScoreResponse,
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
import { partyStarted, type GuestScore } from '../../lib/league/partyScore.js';
import InviteSheet from './InviteSheet.js';
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

/** What the scoreboard says about one of the party's games, once it starts. */
export type GameScore = PartyScoreResponse['games'][number];

/** "DEN 121, LAL 106", the leader first. */
function scoreLabel(score: GameScore): string {
  if (score.homeScore === null || score.awayScore === null) return '';
  const home = `${score.home} ${score.homeScore}`;
  const away = `${score.away} ${score.awayScore}`;
  return score.homeScore >= score.awayScore ? `${home}, ${away}` : `${away}, ${home}`;
}

/** One line for one game: logos, names, night, TV, and the rivalry if any. */
export function PartyGameLine({ game, rosters, main, score }: { game: PartyGame; rosters: RostersByOwner; main: boolean; score?: GameScore }) {
  const rivalry = rivalryIn(game, stakesIn(game, rosters));
  const running = score && score.state !== 'pre' ? score : null;
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
        {running && (
          <small className={running.state === 'in' ? 'party-game-score is-live' : 'party-game-score'}>
            {running.state === 'in' ? 'LIVE' : 'FINAL'}
            {running.state === 'in' && running.detail && <> · {running.detail}</>}
            {scoreLabel(running) && <> · {scoreLabel(running)}</>}
          </small>
        )}
        {rivalry && (
          <small className="party-rivalry">
            RIVALRY · {rivalry.a.owner}'s {rivalry.a.player} vs {rivalry.b.owner}'s {rivalry.b.player}
          </small>
        )}
      </span>
    </div>
  );
}

/** One guest's players with their points, once the games are on. */
function ScoredGuest({ guest, host }: { guest: GuestScore; host: string | null }) {
  return (
    <div className="party-guest">
      <span className="party-guest-name">
        {guest.owner}
        {guest.owner === host && <small>host</small>}
        <b className="party-guest-total">{guest.total.toFixed(1)}</b>
      </span>
      <span className="party-guest-players">
        {guest.players.length === 0 && <small className="party-guest-none">no players in these games</small>}
        {guest.players.map((player) => (
          <span
            key={`${player.gameId}-${player.key}`}
            className={`stake-chip is-scored${player.fpts === null ? ' is-waiting' : ''}${player.fpts !== null && !player.played ? ' is-dnp' : ''}`}
            title={player.line ? `${player.name}: ${player.line}` : `${player.name}, ${teamNickname(player.team)}`}
          >
            {lastName(player.name)}
            {player.fpts !== null && <b>{player.fpts.toFixed(1)}</b>}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * A party, whole: the games, the host, the note, who is in and what each of
 * them brings. Everyone signed in can say in or out, take an open house, or
 * share the link. The host can edit and call it off. Once the games tip off
 * the strip turns into a scoreboard: every guest's points, refreshed each
 * minute until the night is over.
 */
export default function PartyCard({ party, rosters, now, onChange, onEdit, linkToPage = true }: Props) {
  const { identity } = useIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const viewer = identity?.owner ?? null;
  const over = partyOver(party, now);
  const off = party.cancelledAt !== null;
  const started = partyStarted(party, now);
  const mine = viewer ? answerOf(party, viewer) : null;
  const guests = whoIsIn(party);
  const stakes = guestStakes(party, rosters);
  const score = useQuery<PartyScoreResponse>({
    queryKey: ['party-score', party.id],
    queryFn: () => fetchPartyScore(identity!, party.id),
    enabled: identity !== null && started && !off,
    // A minute while the night runs. A party that happened is read once and kept.
    refetchInterval: over ? false : 60_000,
    staleTime: over ? 10 * 60_000 : 30_000,
    refetchOnWindowFocus: !over,
  });
  const live = score.data?.started ? score.data : null;
  const gameScore = (id: string) => live?.games.find((game) => game.id === id);
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
        {party.games.map((game, index) => (
          <PartyGameLine key={game.id} game={game} rosters={rosters} main={index === 0 && party.games.length > 1} score={gameScore(game.id)} />
        ))}
      </div>

      {party.note && <p className="party-note">{party.note}</p>}

      {live?.error && <div className="mock-note mock-note-dim">{live.error}</div>}

      <div className="party-guests">
        {stakes.length === 0 && <div className="mock-note mock-note-dim">Nobody is in yet.</div>}
        {(party.invites ?? []).filter((invite) => answerOf(party, invite.owner) === null).length > 0 && (
          <div className="party-invited">
            Asked: {(party.invites ?? []).filter((invite) => answerOf(party, invite.owner) === null).map((invite) => invite.owner).join(', ')}
          </div>
        )}
        {live && live.guests.map((guest) => <ScoredGuest key={guest.owner} guest={guest} host={party.host} />)}
        {!live && stakes.map((guest) => (
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
          {mine === 'in' && (
            <button type="button" className="tap-btn mock-mini-btn is-host" disabled={busy} onClick={() => setInviting(true)}>INVITE</button>
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

      {inviting && (
        <InviteSheet
          party={party}
          onDone={(next) => {
            onChange(next);
            setInviting(false);
          }}
          onClose={() => setInviting(false)}
        />
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

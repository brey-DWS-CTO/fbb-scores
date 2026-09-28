import { useEffect, useMemo, useRef, useState } from 'react';
import { starterSlotList, type ValueBoard } from '../../lib/league/draftValue.js';
import { autoPick, oddsGoneByNextPick, replayLive, type LiveChoices } from '../../lib/league/liveMock.js';
import type { PreparedMock } from '../../lib/league/mockDraft.js';
import NavIcon from './NavIcon.js';

/** Seconds on the clock at the person's pick. */
const PICK_CLOCK = 60;
/** Gap between one team's pick and the next on screen. */
const REVEAL_MS = 450;
const LIST_LIMIT = 40;

const pct = (share: number) => `${Math.round(share * 100)}%`;

interface Props {
  prepared: PreparedMock;
  values: ValueBoard;
  person: string;
  seed: number;
  onNewSeed: () => void;
}

/**
 * One live mock draft. The other nine teams pick on their own, a pick every
 * half second; at the person's turn the clock starts and the board waits.
 * The draft is rebuilt from the seed and the person's choices on every
 * change, so undo is dropping a choice and nothing is ever saved.
 */
export default function LiveMockDraft({ prepared, values, person, seed, onNewSeed }: Props) {
  const [choices, setChoices] = useState<LiveChoices>({});
  const [revealed, setRevealed] = useState(0);
  const [search, setSearch] = useState('');
  const [clock, setClock] = useState<{ overall: number; deadline: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLOListElement | null>(null);

  const live = useMemo(() => replayLive(prepared, seed, person, choices), [prepared, seed, person, choices]);
  const byKey = useMemo(() => new Map(values.entries.map((entry) => [entry.player.key, entry])), [values]);
  const caughtUp = revealed >= live.picks.length;
  const myTurn = caughtUp && live.waitingOn !== null;
  const over = caughtUp && live.over;

  // Reveal the other teams' picks one at a time. Keepers and picks already
  // made show at once; they were never in doubt.
  useEffect(() => {
    if (caughtUp) return;
    const delay = live.picks[revealed]?.how === 'pick' ? REVEAL_MS : 0;
    const timer = setTimeout(() => setRevealed((current) => Math.min(current + 1, live.picks.length)), delay);
    return () => clearTimeout(timer);
  }, [caughtUp, revealed, live.picks]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [revealed]);

  // The clock starts when it is the person's turn, one clock per pick, and
  // stops when it is not. State moves inside timers, never in the effect body.
  const waitingOverall = live.waitingOn?.pick.overall ?? null;
  useEffect(() => {
    if (!myTurn || waitingOverall === null) {
      if (clock === null) return;
      const stop = setTimeout(() => setClock(null), 0);
      return () => clearTimeout(stop);
    }
    if (clock?.overall === waitingOverall) return;
    const start = setTimeout(() => setClock({ overall: waitingOverall, deadline: Date.now() + PICK_CLOCK * 1000 }), 0);
    return () => clearTimeout(start);
  }, [myTurn, waitingOverall, clock]);

  // Tick while the clock runs. At zero the pick goes to the best value on the board.
  useEffect(() => {
    if (!clock) return;
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= clock.deadline) {
        const pick = autoPick(live);
        if (pick) setChoices((current) => ({ ...current, [clock.overall]: pick.playerKey }));
      }
    }, 250);
    return () => clearInterval(tick);
  }, [clock, live]);
  const secondsLeft = clock ? Math.min(PICK_CLOCK, Math.max(0, Math.ceil((clock.deadline - now) / 1000))) : null;

  const odds = useMemo(
    () => (myTurn ? oddsGoneByNextPick(prepared, seed, person, live, 60) : new Map<string, number>()),
    [myTurn, prepared, seed, person, live],
  );

  const choose = (playerKey: string) => {
    if (!live.waitingOn) return;
    setChoices((current) => ({ ...current, [live.waitingOn!.pick.overall]: playerKey }));
    setSearch('');
  };
  const undo = () => {
    const mine = Object.keys(choices).map(Number).sort((a, b) => a - b);
    const last = mine[mine.length - 1];
    if (last === undefined) return;
    const next = { ...choices };
    delete next[last];
    setChoices(next);
    setRevealed(Math.min(revealed, last - 1));
  };
  const restart = () => {
    setChoices({});
    setRevealed(0);
  };

  const available = live.run.available();
  const needle = search.trim().toLowerCase();
  const shown = (needle
    ? available.filter((candidate) => {
      const entry = byKey.get(candidate.playerKey);
      return candidate.playerName.toLowerCase().includes(needle) || (entry?.player.fullName ?? '').toLowerCase().includes(needle);
    })
    : available).slice(0, LIST_LIMIT);

  const shownPicks = live.picks.slice(0, revealed);
  // Whose turn the screen says it is: the person's waiting slot, or the next pick still to show.
  const nextUp: { label: string; owner: string } | null = caughtUp
    ? live.waitingOn
      ? { label: `${live.waitingOn.pick.round}.${live.waitingOn.pick.slot}`, owner: live.waitingOn.pick.currentOwner }
      : null
    : live.picks[revealed]
      ? { label: live.picks[revealed].label, owner: live.picks[revealed].owner }
      : null;
  const myKeys = live.run.result().rosters[person] ?? [];
  const lineup = live.run.lineupOf(person);
  const starters = starterSlotList(prepared.roster);
  const madeCount = Object.keys(choices).length;

  return (
    <div className="live-mock">
      <section className="panel live-log-panel">
        <div className="hub-heading mock-sub" style={{ marginTop: 0 }}>
          THE DRAFT
          <small>seed {seed}{over ? ', finished' : nextUp ? `, on the clock: ${nextUp.owner}` : ''}</small>
        </div>
        <ol className="live-log" ref={logRef}>
          {shownPicks.map((pick) => (
            <li key={pick.overall} className={pick.owner === person ? 'live-pick live-pick-mine' : 'live-pick'}>
              <span className="mock-slot-label">{pick.label}</span>
              <span className="mock-slot-owner">{pick.owner}</span>
              <span className="mock-slot-player">
                {pick.playerName ?? 'nobody'}
                <small>{pick.positions.join('/')}</small>
                {pick.how === 'keeper' && (
                  <span className={`mock-tag ${pick.keeperStatus === 'known' ? 'mock-tag-known' : 'mock-tag-assumed'}`}>
                    {pick.keeperStatus === 'known' ? 'keeper' : 'projected'}
                  </span>
                )}
                {pick.how === 'made' && <span className="mock-tag mock-tag-known">picked</span>}
              </span>
              <span className="live-pick-why">
                {pick.how === 'pick' && pick.owner !== person && pick.valueRank !== null && (
                  pick.roomRank !== null && pick.roomRank < pick.valueRank ? `ADP ${pick.roomRank}` : `value #${pick.valueRank}`
                )}
              </span>
            </li>
          ))}
          {!caughtUp && nextUp && (
            <li className="live-pick live-pick-thinking">
              <span className="mock-slot-label">{nextUp.label}</span>
              <span className="mock-slot-owner">{nextUp.owner}</span>
              <span className="mock-slot-player"><span className="mock-live">picking…</span></span>
              <span />
            </li>
          )}
        </ol>
        <div className="live-actions">
          <button type="button" className="tap-btn mock-mini-btn" onClick={undo} disabled={madeCount === 0}>UNDO MY LAST PICK</button>
          <button type="button" className="tap-btn mock-mini-btn" onClick={restart}>RESTART</button>
          <button type="button" className="tap-btn mock-mini-btn" onClick={onNewSeed}>NEW SEED</button>
        </div>
      </section>

      <section className={`panel live-turn-panel${myTurn ? ' is-mine' : ''}`}>
        {over ? (
          <Finished prepared={prepared} live={live} person={person} byKey={byKey} />
        ) : myTurn && live.waitingOn ? (
          <>
            <div className="live-clock-row">
              <div className="hub-heading live-turn-title">
                <NavIcon name="target" size={14} className="icon-in-heading" />
                YOUR PICK, {live.waitingOn.pick.round}.{live.waitingOn.pick.slot}
              </div>
              <div className={`live-clock${secondsLeft !== null && secondsLeft <= 10 ? ' is-low' : ''}`} aria-live="polite">
                {secondsLeft ?? PICK_CLOCK}s
              </div>
            </div>
            <input
              className="hub-input live-search"
              type="search"
              placeholder="Search a player…"
              value={search}
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && shown[0]) choose(shown[0].playerKey);
              }}
            />
            <div className="live-list-head" aria-hidden="true">
              <span>#</span><span>Player</span><span>FPPG</span><span>ADP</span><span>Gone by next</span><span />
            </div>
            <ul className="live-list">
              {shown.map((candidate) => {
                const entry = byKey.get(candidate.playerKey);
                const gone = odds.get(candidate.playerKey) ?? 0;
                return (
                  <li key={candidate.playerKey}>
                    <span className="mock-odds-rank">{candidate.valueRank}</span>
                    <span className="mock-odds-name">
                      {candidate.playerName}
                      <small>{candidate.positions.join('/')}{entry?.player.proTeam ? ` · ${entry.player.proTeam}` : ''}</small>
                    </span>
                    <span className="live-num">{entry?.fppg?.toFixed(1) ?? '–'}</span>
                    <span className="live-num">{entry?.adp !== null && entry?.adp !== undefined && entry.adp < 139 ? entry.adp.toFixed(1) : '–'}</span>
                    <span className={`live-num${gone >= 0.5 ? ' is-hot' : ''}`}>{odds.size > 0 ? pct(gone) : '–'}</span>
                    <button type="button" className="tap-btn mock-mini-btn is-primary" onClick={() => choose(candidate.playerKey)}>DRAFT</button>
                  </li>
                );
              })}
            </ul>
            <div className="mock-note mock-note-dim">
              Sorted by our value. "Gone by next" is how often he was taken before your next pick across 60 runs from here.
              The clock runs out to the best value on the board.
            </div>
          </>
        ) : (
          <div className="mock-note">
            {nextUp ? `${nextUp.owner} is picking…` : 'Setting up…'}
          </div>
        )}

        <div className="hub-heading mock-sub">YOUR TEAM</div>
        <div className="mock-note mock-note-dim">
          Starters filled {lineup.filled} of {starters.length}
          {lineup.open.length > 0 ? `, still open: ${lineup.open.join(', ')}` : ', lineup complete'}.
        </div>
        <ul className="live-roster">
          {myKeys.map((key) => {
            const entry = byKey.get(key);
            return (
              <li key={key}>
                <span className="mock-odds-name">{entry?.player.name ?? key}<small>{entry?.positions.join('/')}</small></span>
                <span className="live-num">{entry?.fppg?.toFixed(1) ?? '–'}</span>
              </li>
            );
          })}
          {myKeys.length === 0 && <li className="mock-live">nobody yet</li>}
        </ul>
      </section>
    </div>
  );
}

interface FinishedProps {
  prepared: PreparedMock;
  live: ReturnType<typeof replayLive>;
  person: string;
  byKey: Map<string, ValueBoard['entries'][number]>;
}

function Finished({ prepared, live, person, byKey }: FinishedProps) {
  const result = live.run.result();
  const owners = [...new Set(prepared.input.board.slots.map((slot) => slot.pick.currentOwner))];
  return (
    <>
      <div className="hub-heading live-turn-title">
        <NavIcon name="trophy" size={14} className="icon-in-heading" />
        DRAFT COMPLETE
      </div>
      {result.warnings.length > 0 && (
        <div className="mock-note mock-note-warn">{result.warnings.map((warning) => warning.message).join(' ')}</div>
      )}
      <div className="live-rosters">
        {owners.map((owner) => (
          <div key={owner} className={owner === person ? 'live-team is-mine' : 'live-team'}>
            <div className="mock-guess-owner">{owner}</div>
            <ul>
              {(result.rosters[owner] ?? []).map((key) => (
                <li key={key}>{byKey.get(key)?.player.name ?? key}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

import { Fragment, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { useExpectedPoints, useScoresWeek } from '../../hooks/useScores.js';
import { leagueDataset } from '../../lib/league/data.js';
import {
  defaultDay,
  gameText,
  isOut,
  lineupOrder,
  longDate,
  matchupChance,
  ownerByEspnTeamId,
  playerWeek,
  recordText,
  seasonStartDate,
  shortDate,
  shortDay,
  shortName,
  statLineText,
  weekOrder,
  yetToPlay,
  type ScoreMatchup,
  type ScorePlayer,
  type ScoreSide,
  type ScoresWeek,
} from '../../lib/league/scores.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { ScoresNotice, WeekPicker, WinBar } from './ScoresBits.js';
import { numberParam, scoresQuery, tipoffText } from './scoresUi.js';

type View = { kind: 'day'; scoringPeriodId: number } | { kind: 'week' };

interface SideHeadProps {
  side: ScoreSide;
  owner: string | undefined;
  chance: number;
  leading: boolean;
  right?: boolean;
}

function SideHead({ side, owner, chance, leading, right }: SideHeadProps) {
  return (
    <div className={`score-side-head${right ? ' is-right' : ''}${leading ? ' is-leading' : ''}`}>
      <div className="score-side-name">{side.name}</div>
      <div className="score-side-owner">{owner ?? 'Unknown owner'} · {recordText(side.record)}</div>
      <div className="score-side-total">{side.total.toFixed(1)}</div>
      <div className="score-side-chance">{chance}% to win</div>
    </div>
  );
}

function YetToPlay({ side, week, right }: { side: ScoreSide; week: ScoresWeek; right?: boolean }) {
  const players = yetToPlay(side, week);
  return (
    <div className={`score-yet${right ? ' is-right' : ''}`}>
      <span className="score-yet-title hub-heading">Yet to play ({players.length})</span>
      <span className="score-yet-names">
        {players.length === 0 ? 'Nobody' : players.map((player) => shortName(player.name)).join(', ')}
      </span>
    </div>
  );
}

function DayCell({ player, scoringPeriodId }: { player: ScorePlayer | undefined; scoringPeriodId: number }) {
  if (!player) return <div className="score-player is-empty" aria-hidden="true" />;
  const day = player.days[String(scoringPeriodId)];
  const started = day?.started === true;
  const out = isOut(player);
  const classes = ['score-player', started ? '' : 'is-bench', out ? 'is-out' : ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <div className="score-player-top">
        <span className="score-player-name">{shortName(player.name)}</span>
        <span className="score-player-pts">{day ? day.points.toFixed(1) : '0.0'}</span>
      </div>
      <div className="score-player-meta">
        {player.position || '—'} · {player.proTeam || 'FA'}
        {out && <span className="score-out"> · OUT</span>}
        {!started && <span className="score-bench-tag"> · bench</span>}
      </div>
      <div className="score-player-game">{gameText(day?.game ?? null, tipoffText(day?.game?.tipoff ?? null))}</div>
      {day?.stats && <div className="score-player-line">{statLineText(day.stats)}</div>}
    </div>
  );
}

function WeekCell({ player, week }: { player: ScorePlayer | undefined; week: ScoresWeek }) {
  if (!player) return <div className="score-player is-empty" aria-hidden="true" />;
  const summary = playerWeek(player, week);
  const started = Object.values(player.days).some((day) => day.started);
  const out = isOut(player);
  const classes = ['score-player', started ? '' : 'is-bench', out ? 'is-out' : ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <div className="score-player-top">
        <span className="score-player-name">{shortName(player.name)}</span>
        <span className="score-player-pts">{summary.total.toFixed(1)}</span>
      </div>
      <div className="score-player-meta">
        {player.position || '—'} · {player.proTeam || 'FA'}
        {out && <span className="score-out"> · OUT</span>}
        {!started && <span className="score-bench-tag"> · bench</span>}
      </div>
      <div className="score-player-game">
        {summary.played} played · {summary.left} left
      </div>
    </div>
  );
}

/** One matchup, Sleeper style: both sides, the days of the week, each day's lineups. */
export default function MatchupPage() {
  const { matchupId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const demo = params.get('demo') === '1';
  const requestedWeek = numberParam(params.get('week'));
  const teamParam = numberParam(params.get('team'));
  const dayParam = params.get('day');
  const { identity } = useIdentity();
  const query = useScoresWeek(requestedWeek, demo);
  const expected = useExpectedPoints();
  const owners = useMemo(() => ownerByEspnTeamId(leagueDataset.teams), []);
  const myTeamId = identity
    ? (leagueDataset.teams.find((team) => team.owner === identity.owner)?.espnTeamId ?? null)
    : null;

  const week = query.data;
  const wantedId = numberParam(matchupId ?? null);
  const matchup: ScoreMatchup | undefined = useMemo(() => {
    if (!week) return undefined;
    const byId = week.matchups.find((entry) => entry.id === wantedId);
    if (byId) return byId;
    const team = teamParam ?? myTeamId;
    return week.matchups.find((entry) => entry.home.teamId === team || entry.away.teamId === team);
  }, [week, wantedId, teamParam, myTeamId]);

  // Moving to another week lands on the same team's matchup there, which has
  // its own id. Put the real id in the address so the link can be shared.
  useEffect(() => {
    if (!week || !matchup || matchup.id === wantedId) return;
    navigate(`/scores/${matchup.id}${scoresQuery({ week: week.matchupPeriodId, demo, day: dayParam })}`, { replace: true });
  }, [week, matchup, wantedId, demo, dayParam, navigate]);

  const view: View | null = useMemo(() => {
    if (!week) return null;
    if (dayParam === 'week') return { kind: 'week' };
    const asked = numberParam(dayParam);
    if (asked !== null && week.days.some((day) => day.scoringPeriodId === asked)) return { kind: 'day', scoringPeriodId: asked };
    const fallback = defaultDay(week);
    return fallback === null ? { kind: 'week' } : { kind: 'day', scoringPeriodId: fallback };
  }, [week, dayParam]);

  const setView = (next: View) => {
    const copy = new URLSearchParams(params);
    copy.set('day', next.kind === 'week' ? 'week' : String(next.scoringPeriodId));
    setParams(copy, { replace: true });
  };

  const setWeek = (matchupPeriodId: number) => {
    if (!matchup) return;
    const anchor = myTeamId !== null && (matchup.home.teamId === myTeamId || matchup.away.teamId === myTeamId)
      ? myTeamId
      : matchup.home.teamId;
    navigate(`/scores/${matchup.id}${scoresQuery({ week: matchupPeriodId, demo, team: anchor })}`);
  };

  const dayIndex = view?.kind === 'day' && week
    ? week.days.findIndex((day) => day.scoringPeriodId === view.scoringPeriodId)
    : -1;
  const prevDay = week && dayIndex > 0 ? week.days[dayIndex - 1] : null;
  const nextDay = week && dayIndex >= 0 && dayIndex < week.days.length - 1 ? week.days[dayIndex + 1] : null;

  const chance = week && matchup ? matchupChance(matchup, week, expected) : null;
  const back = `/scores${scoresQuery({ week: week?.matchupPeriodId ?? requestedWeek, demo })}`;

  return (
    <div className="mock-page scores-page">
      <div className="mock-head">
        <Link to={back} className="hub-heading score-back">
          <NavIcon name="chevrons" size={14} className="icon-in-heading" />
          SCORES
        </Link>
        <IdentityChip />
      </div>

      {demo && (
        <div className="score-demo" role="status">
          Demo numbers. Real scores start {longDate(seasonStartDate())}.
        </div>
      )}

      <WeekPicker weeks={week?.weeks ?? []} selected={week?.matchupPeriodId ?? requestedWeek} onChange={setWeek} />

      {query.isLoading && <ScoresNotice>Loading the matchup from ESPN...</ScoresNotice>}
      {query.isError && (
        <ScoresNotice onRetry={() => { void query.refetch(); }}>
          ESPN did not answer. Try again in a minute.
        </ScoresNotice>
      )}
      {week && !matchup && (
        <ScoresNotice>
          No such matchup this week. <Link to={back}>Back to the scoreboard.</Link>
        </ScoresNotice>
      )}

      {week && matchup && chance && view && (
        <>
          <section className="panel score-head">
            <div className="score-head-grid">
              <SideHead side={matchup.home} owner={owners.get(matchup.home.teamId)} chance={chance.home} leading={matchup.home.total > matchup.away.total} />
              <SideHead side={matchup.away} owner={owners.get(matchup.away.teamId)} chance={chance.away} leading={matchup.away.total > matchup.home.total} right />
            </div>
            <WinBar left={chance.home} right={chance.away} />
            {matchup.winner !== 'UNDECIDED' && <div className="score-final">FINAL</div>}
            <div className="score-yet-grid">
              <YetToPlay side={matchup.home} week={week} />
              <YetToPlay side={matchup.away} week={week} right />
            </div>
          </section>

          <div className="score-days" role="tablist" aria-label="Days of the week">
            {week.days.map((day) => {
              const on = view.kind === 'day' && view.scoringPeriodId === day.scoringPeriodId;
              const today = day.scoringPeriodId === week.currentScoringPeriodId;
              return (
                <button
                  key={day.scoringPeriodId}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={`tap-btn score-day${on ? ' is-on' : ''}${today ? ' is-today' : ''}`}
                  onClick={() => setView({ kind: 'day', scoringPeriodId: day.scoringPeriodId })}
                >
                  <span className="score-day-name">{shortDay(day.date)}</span>
                  <span className="score-day-date">{shortDate(day.date)}</span>
                  <span className="score-day-pts">{(matchup.home.pointsByDay[String(day.scoringPeriodId)] ?? 0).toFixed(1)}</span>
                  <span className="score-day-pts">{(matchup.away.pointsByDay[String(day.scoringPeriodId)] ?? 0).toFixed(1)}</span>
                </button>
              );
            })}
            <button
              type="button"
              role="tab"
              aria-selected={view.kind === 'week'}
              className={`tap-btn score-day score-day-week${view.kind === 'week' ? ' is-on' : ''}`}
              onClick={() => setView({ kind: 'week' })}
            >
              <span className="score-day-name">WEEK</span>
              <span className="score-day-date">{week.days.length} days</span>
              <span className="score-day-pts">{matchup.home.total.toFixed(1)}</span>
              <span className="score-day-pts">{matchup.away.total.toFixed(1)}</span>
            </button>
          </div>

          {view.kind === 'day' && (
            <div className="score-day-nav">
              <button
                type="button"
                className="tap-btn score-arrow"
                aria-label="Previous day"
                disabled={!prevDay}
                onClick={() => prevDay && setView({ kind: 'day', scoringPeriodId: prevDay.scoringPeriodId })}
              >
                <NavIcon name="chevrons" size={16} />
              </button>
              <span className="score-day-title hub-heading">
                {longDate(week.days[dayIndex].date)}
                {week.days[dayIndex].scoringPeriodId === week.currentScoringPeriodId && ' · today'}
              </span>
              <button
                type="button"
                className="tap-btn score-arrow score-arrow-next"
                aria-label="Next day"
                disabled={!nextDay}
                onClick={() => nextDay && setView({ kind: 'day', scoringPeriodId: nextDay.scoringPeriodId })}
              >
                <NavIcon name="chevrons" size={16} />
              </button>
            </div>
          )}

          <div className="score-grid-head">
            <span>{owners.get(matchup.home.teamId) ?? matchup.home.name}</span>
            <span className="is-right">{owners.get(matchup.away.teamId) ?? matchup.away.name}</span>
          </div>

          {view.kind === 'day' && (() => {
            const home = lineupOrder(matchup.home.players, view.scoringPeriodId);
            const away = lineupOrder(matchup.away.players, view.scoringPeriodId);
            const rows = Math.max(home.length, away.length);
            return (
              <div className="score-grid">
                {Array.from({ length: rows }, (_, index) => (
                  <Fragment key={home[index]?.id ?? `h${index}`}>
                    <DayCell player={home[index]} scoringPeriodId={view.scoringPeriodId} />
                    <DayCell player={away[index]} scoringPeriodId={view.scoringPeriodId} />
                  </Fragment>
                ))}
              </div>
            );
          })()}

          {view.kind === 'week' && (() => {
            const home = weekOrder(matchup.home.players);
            const away = weekOrder(matchup.away.players);
            const rows = Math.max(home.length, away.length);
            return (
              <div className="score-grid">
                {Array.from({ length: rows }, (_, index) => (
                  <Fragment key={home[index]?.id ?? `h${index}`}>
                    <WeekCell player={home[index]} week={week} />
                    <WeekCell player={away[index]} week={week} />
                  </Fragment>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

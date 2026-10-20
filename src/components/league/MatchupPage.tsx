import { Fragment, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { GAMES_CAPS_KEY, useExpectedPoints, useGamesCaps, useScoresWeek } from '../../hooks/useScores.js';
import { apiErrorMessage, saveGamesCap } from '../../lib/league/api.js';
import { playerDayProjection, playerWeekProjection, projText, sideProjection } from '../../lib/league/dailyProjection.js';
import { leagueDataset } from '../../lib/league/data.js';
import { MAX_GAMES_CAP, MIN_GAMES_CAP, gamesText, parseGamesCap } from '../../lib/league/gamesCap.js';
import {
  defaultDay,
  gamesPlayed,
  gameText,
  injuryBadge,
  latestSlot,
  lineupOrder,
  longDate,
  matchupChance,
  ownerByEspnTeamId,
  playerWeek,
  recordText,
  seasonStartDate,
  shortName,
  slotLabel,
  slotOn,
  statLineText,
  weekOrder,
  type ExpectedPoints,
  type ScoreMatchup,
  type ScorePlayer,
  type ScoreSide,
  type ScoresWeek,
} from '../../lib/league/scores.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { ScoresNotice, WinBar } from './ScoresBits.js';
import { numberParam, scoresQuery, tipoffText } from './scoresUi.js';

type View = { kind: 'day'; scoringPeriodId: number } | { kind: 'week' };

/** The address bar's word for a view: a scoring period id, or "week". */
function viewKey(view: View): string {
  return view.kind === 'week' ? 'week' : String(view.scoringPeriodId);
}

function viewFromKey(key: string): View {
  return key === 'week' ? { kind: 'week' } : { kind: 'day', scoringPeriodId: Number(key) };
}

interface SideHeadProps {
  side: ScoreSide;
  owner: string | undefined;
  chance: number;
  /** Where the side should finish the week. Null once the matchup is settled. */
  proj: number | null;
  leading: boolean;
  right?: boolean;
}

function SideHead({ side, owner, chance, proj, leading, right }: SideHeadProps) {
  return (
    <div className={`score-side-head${right ? ' is-right' : ''}${leading ? ' is-leading' : ''}`}>
      <div className="score-side-name">{side.name}</div>
      <div className="score-side-owner">{owner ?? 'Unknown owner'} · {recordText(side.record)}</div>
      <div className="score-side-total">{side.total.toFixed(1)}</div>
      <div className="score-side-chance">{chance}% to win</div>
      {proj !== null && proj > 0 && <div className="score-side-proj">Proj <b>{projText(proj)}</b></div>}
    </div>
  );
}

interface GamesLineProps {
  played: number;
  cap: number;
  right?: boolean;
  /** Set when the viewer may change the cap. */
  onEdit?: () => void;
}

/** "Games 14 of 30", with a pencil for the commissioner. */
function GamesLine({ played, cap, right, onEdit }: GamesLineProps) {
  return (
    <div className={`score-games${right ? ' is-right' : ''}${played > cap ? ' is-over' : ''}`}>
      <span className="score-games-title hub-heading">Games</span>
      <span className="score-games-count">
        {gamesText(played, cap)}
        {onEdit && (
          <button type="button" className="tap-btn score-cap-btn" aria-label="Change this week's games cap" onClick={onEdit}>
            <NavIcon name="pencil" size={12} />
          </button>
        )}
      </span>
    </div>
  );
}

interface CapEditorProps {
  matchupPeriodId: number;
  cap: number;
  onClose: () => void;
}

/** One small box: the games cap for this week. Commissioner only. */
function CapEditor({ matchupPeriodId, cap, onClose }: CapEditorProps) {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(cap));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseGamesCap(value);

  const save = async () => {
    if (!identity || parsed === null) return;
    setSaving(true);
    setError(null);
    try {
      await saveGamesCap(identity, matchupPeriodId, parsed);
      await queryClient.invalidateQueries({ queryKey: GAMES_CAPS_KEY });
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="score-cap-edit"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <label className="score-cap-label" htmlFor="games-cap">Games cap this week</label>
      <input
        id="games-cap"
        className="hub-input score-cap-input"
        type="number"
        inputMode="numeric"
        min={MIN_GAMES_CAP}
        max={MAX_GAMES_CAP}
        step={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="tap-btn mock-mini-btn is-primary" disabled={saving || parsed === null}>
        {saving ? 'SAVING' : 'SAVE'}
      </button>
      <button type="button" className="tap-btn mock-mini-btn" onClick={onClose} disabled={saving}>
        CANCEL
      </button>
      {parsed === null && value !== '' && (
        <span className="score-cap-error">A whole number from {MIN_GAMES_CAP} to {MAX_GAMES_CAP}.</span>
      )}
      {error && <span className="score-cap-error">{error}</span>}
    </form>
  );
}

function PlayerTop({ player, slot }: { player: ScorePlayer; slot: number }) {
  const badge = injuryBadge(player.injuryStatus);
  return (
    <>
      <span className="score-slot">{slotLabel(slot)}</span>
      <span className="score-player-who">
        <span className="score-player-name">{shortName(player.name)}</span>
        <span className="score-player-team">{player.position || '—'} · {player.proTeam || 'FA'}</span>
        {badge && <span className={`score-badge is-${badge.tone}`}>{badge.text}</span>}
      </span>
    </>
  );
}

function cardClass(started: boolean, player: ScorePlayer): string {
  const badge = injuryBadge(player.injuryStatus);
  return ['score-player', started ? '' : 'is-bench', badge?.tone === 'out' ? 'is-out' : ''].filter(Boolean).join(' ');
}

interface DayCellProps {
  player: ScorePlayer | undefined;
  week: ScoresWeek;
  scoringPeriodId: number;
  expected: ExpectedPoints;
}

function DayCell({ player, week, scoringPeriodId, expected }: DayCellProps) {
  if (!player) return <div className="score-player is-empty" aria-hidden="true" />;
  const day = player.days[String(scoringPeriodId)];
  const slot = slotOn(player, scoringPeriodId);
  // Only a game still to play gets a projection; a finished one is just the points.
  const proj = day?.started ? playerDayProjection(player, week, expected, scoringPeriodId) : null;
  return (
    <div className={cardClass(day?.started === true, player)}>
      <div className="score-player-top">
        <PlayerTop player={player} slot={slot} />
        <span className="score-player-pts">{day ? day.points.toFixed(1) : '0.0'}</span>
      </div>
      <div className="score-player-game">
        {gameText(day?.game ?? null, tipoffText(day?.game?.tipoff ?? null))}
        {proj !== null && proj > 0 && <span className="score-player-proj"> · Proj {projText(proj)}</span>}
      </div>
      {day?.stats && <div className="score-player-line">{statLineText(day.stats)}</div>}
    </div>
  );
}

interface WeekCellProps {
  player: ScorePlayer | undefined;
  week: ScoresWeek;
  expected: ExpectedPoints;
}

function WeekCell({ player, week, expected }: WeekCellProps) {
  if (!player) return <div className="score-player is-empty" aria-hidden="true" />;
  const summary = playerWeek(player, week);
  const started = Object.values(player.days).some((day) => day.started);
  const proj = summary.left > 0 ? playerWeekProjection(player, week, expected) : null;
  return (
    <div className={cardClass(started, player)}>
      <div className="score-player-top">
        <PlayerTop player={player} slot={latestSlot(player)} />
        <span className="score-player-pts">{summary.total.toFixed(1)}</span>
      </div>
      <div className="score-player-game">
        {summary.played} played · {summary.left} left
        {proj !== null && proj > 0 && <span className="score-player-proj"> · Proj {projText(proj)}</span>}
      </div>
    </div>
  );
}

/** One matchup, Sleeper style: both sides, then one day's lineups or the whole week. */
export default function MatchupPage() {
  const { matchupId } = useParams();
  const [params, setParams] = useSearchParams();
  const demo = params.get('demo') === '1';
  const requestedWeek = numberParam(params.get('week'));
  const dayParam = params.get('day');
  const { identity } = useIdentity();
  const query = useScoresWeek(requestedWeek, demo);
  const expected = useExpectedPoints();
  const { capFor } = useGamesCaps();
  const owners = useMemo(() => ownerByEspnTeamId(leagueDataset.teams), []);
  const [editingCap, setEditingCap] = useState(false);

  const loaded = query.data;
  // The commissioner's cap for this week, in place of ESPN's lineup limit.
  const week: ScoresWeek | undefined = useMemo(
    () => (loaded ? { ...loaded, gamesCap: capFor(loaded.matchupPeriodId) } : undefined),
    [loaded, capFor],
  );
  const wantedId = numberParam(matchupId ?? null);
  const matchup: ScoreMatchup | undefined = week?.matchups.find((entry) => entry.id === wantedId);

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
    copy.set('day', viewKey(next));
    setParams(copy, { replace: true });
  };

  // The arrows walk the days in order and end on the week view.
  const steps: View[] = week
    ? [...week.days.map((day): View => ({ kind: 'day', scoringPeriodId: day.scoringPeriodId })), { kind: 'week' }]
    : [];
  const stepIndex = view ? steps.findIndex((step) => viewKey(step) === viewKey(view)) : -1;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;
  const nextStep = stepIndex >= 0 && stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;

  const chance = week && matchup ? matchupChance(matchup, week, expected) : null;
  const settled = matchup?.winner !== 'UNDECIDED';
  const homeProj = week && matchup && !settled ? sideProjection(matchup.home, week, expected) : null;
  const awayProj = week && matchup && !settled ? sideProjection(matchup.away, week, expected) : null;
  const back = `/scores${scoresQuery({ week: week?.matchupPeriodId ?? requestedWeek, demo })}`;
  const isCommish = identity?.isCommissioner === true;

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
              <SideHead side={matchup.home} owner={owners.get(matchup.home.teamId)} chance={chance.home} proj={homeProj?.week ?? null} leading={matchup.home.total > matchup.away.total} />
              <SideHead side={matchup.away} owner={owners.get(matchup.away.teamId)} chance={chance.away} proj={awayProj?.week ?? null} leading={matchup.away.total > matchup.home.total} right />
            </div>
            <WinBar left={chance.home} right={chance.away} />
            {matchup.winner !== 'UNDECIDED' && <div className="score-final">FINAL</div>}
            <div className="score-games-grid">
              <GamesLine
                played={gamesPlayed(matchup.home, week)}
                cap={week.gamesCap ?? 0}
                onEdit={isCommish ? () => setEditingCap(true) : undefined}
              />
              <GamesLine
                played={gamesPlayed(matchup.away, week)}
                cap={week.gamesCap ?? 0}
                onEdit={isCommish ? () => setEditingCap(true) : undefined}
                right
              />
            </div>
            {editingCap && isCommish && (
              <CapEditor matchupPeriodId={week.matchupPeriodId} cap={week.gamesCap ?? 0} onClose={() => setEditingCap(false)} />
            )}
          </section>

          <div className="score-week score-day-nav" role="group" aria-label="Day">
            <button
              type="button"
              className="tap-btn score-arrow"
              aria-label="Previous day"
              disabled={!prevStep}
              onClick={() => prevStep && setView(prevStep)}
            >
              <NavIcon name="chevrons" size={16} />
            </button>
            <select
              className="hub-input score-week-select"
              aria-label="Day of the week"
              value={viewKey(view)}
              onChange={(event) => setView(viewFromKey(event.target.value))}
            >
              {week.days.map((day) => (
                <option key={day.scoringPeriodId} value={String(day.scoringPeriodId)}>
                  {longDate(day.date)}
                  {day.scoringPeriodId === week.currentScoringPeriodId ? ' · today' : ''}
                </option>
              ))}
              <option value="week">Week</option>
            </select>
            <button
              type="button"
              className="tap-btn score-arrow score-arrow-next"
              aria-label="Next day"
              disabled={!nextStep}
              onClick={() => nextStep && setView(nextStep)}
            >
              <NavIcon name="chevrons" size={16} />
            </button>
          </div>

          <div className="score-grid-head">
            <span>{owners.get(matchup.home.teamId) ?? matchup.home.name}</span>
            <span className="is-right">{owners.get(matchup.away.teamId) ?? matchup.away.name}</span>
          </div>

          {view.kind === 'day' && homeProj && awayProj && view.scoringPeriodId >= week.currentScoringPeriodId
            && (homeProj.byDay[String(view.scoringPeriodId)] ?? 0) + (awayProj.byDay[String(view.scoringPeriodId)] ?? 0) > 0 && (
            <div className="score-proj-grid" aria-label="Projected points for the day">
              <span>
                {(matchup.home.pointsByDay[String(view.scoringPeriodId)] ?? 0).toFixed(1)} · Proj <b>{projText(homeProj.byDay[String(view.scoringPeriodId)] ?? 0)}</b>
              </span>
              <span className="is-right">
                {(matchup.away.pointsByDay[String(view.scoringPeriodId)] ?? 0).toFixed(1)} · Proj <b>{projText(awayProj.byDay[String(view.scoringPeriodId)] ?? 0)}</b>
              </span>
            </div>
          )}

          {view.kind === 'day' && (() => {
            const home = lineupOrder(matchup.home.players, view.scoringPeriodId);
            const away = lineupOrder(matchup.away.players, view.scoringPeriodId);
            const rows = Math.max(home.length, away.length);
            return (
              <div className="score-grid">
                {Array.from({ length: rows }, (_, index) => (
                  <Fragment key={home[index]?.id ?? `h${index}`}>
                    <DayCell player={home[index]} week={week} scoringPeriodId={view.scoringPeriodId} expected={expected} />
                    <DayCell player={away[index]} week={week} scoringPeriodId={view.scoringPeriodId} expected={expected} />
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
                    <WeekCell player={home[index]} week={week} expected={expected} />
                    <WeekCell player={away[index]} week={week} expected={expected} />
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

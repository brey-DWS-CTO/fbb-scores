import { FppgLabel } from './LineupFppg.js';
import { fppgText, lineupFppg } from '../../lib/league/lineupFppg.js';
import ScoreBreakdown from './ScoreBreakdown.js';
import PlayerNews from './PlayerNews.js';
import { cardGame } from '../../lib/league/playerCard.js';
import { nbaGameHref } from '../../lib/league/dailyScorers.js';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isActiveSlot } from '../../lib/espn/calculations.js';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { GAMES_CAPS_KEY, useCourt, useExpectedPoints, useGamesCaps, useScoresWeek } from '../../hooks/useScores.js';
import { foulTitle, type CourtRead } from '../../lib/league/fouls.js';
import { apiErrorMessage, saveGamesCap } from '../../lib/league/api.js';
import { playerDayProjection, playerWeekProjection, projText, sideProjection } from '../../lib/league/dailyProjection.js';
import { leagueDataset } from '../../lib/league/data.js';
import { MAX_GAMES_CAP, MIN_GAMES_CAP, parseGamesCap } from '../../lib/league/gamesCap.js';
import {
  defaultDay,
  gameText,
  injuryBadge,
  latestSlot,
  lineupOrder,
  longDate,
  matchupChance,
  ownerByEspnTeamId,
  playerWeek,
  recordText,
  rosterOn,
  seasonStartDate,
  slotLabel,
  slotOn,
  statLineText,
  weekOrder,
  type ExpectedPoints,
  type ScoreMatchup,
  type ScorePlayer,
  type ScoreSide,
  type ScoresWeek,
  type OverageGame,
} from '../../lib/league/scores.js';
import FantasyTeamLogo from './FantasyTeamLogo.js';
import TeamLogo from './TeamLogo.js';
import MatchupStrip from './MatchupStrip.js';
import LineupGamesSummary from './LineupGamesSummary.js';
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
  /** Where the side should finish the week. Null once the matchup is settled. */
  proj: number | null;
  leading: boolean;
  right?: boolean;
}

function SideHead({ side, owner, proj, leading, right }: SideHeadProps) {
  return (
    <div className={`score-side-head${right ? ' is-right' : ''}${leading ? ' is-leading' : ''}`}>
      <div className="score-team-heading"><FantasyTeamLogo side={side} /><div className="score-side-name">{side.name}</div></div>
      <div className="score-side-owner">{owner ?? 'Unknown owner'}</div>
      <div className="score-side-scoreline"><div className="score-side-total">{side.total.toFixed(1)}</div>
      {proj !== null && <div className="score-side-proj">Proj <b>{projText(proj)}</b></div>}
      </div>
    </div>
  );
}

interface GamesLineProps {
  side: ScoreSide;
  week: ScoresWeek;
  right?: boolean;
  onEdit?: () => void;
  /** The first day this side goes over the cap. Tapping "1 over" opens it. */
  overage?: { label: string; open: () => void };
}

function GamesLine({ side, week, right, onEdit, overage }: GamesLineProps) {
  return (
    <div className={`score-games${right ? ' is-right' : ''}`}>
      <LineupGamesSummary side={side} week={week} onOver={overage?.open} overDay={overage?.label} />
      {onEdit && <button type="button" className="tap-btn score-cap-btn" aria-label="Change this week's games cap" onClick={onEdit}><NavIcon name="pencil" size={12} /></button>}
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

function PlayerTop({ player, slot, foulTrouble, scoring }: { player: ScorePlayer; slot: number; foulTrouble?: string; scoring?: ScoresWeek['scoringItems'] }) {
  const badge = injuryBadge(player.injuryStatus);
  return (
    <>
      <span className="score-slot">{slotLabel(slot)}</span>
      <span className="score-player-who">
        <span className="score-player-name"><PlayerNews player={player} scoring={scoring} /><TeamLogo code={player.proTeam || null} size={14} /></span>
        {badge && <span className={`score-badge is-${badge.tone}`}>{badge.text}</span>}
        {foulTrouble && <span className="score-badge is-foul" title={foulTrouble} aria-label={foulTrouble}>FL</span>}
      </span>
    </>
  );
}

/**
 * His game line. When he has a game it links to that game's NBA box score,
 * and the link stretches across the card, so a tap anywhere on the card
 * opens it. His name and his points sit above it with their own taps.
 */
function GameLink({ player, week, scoringPeriodId, className, children }: { player: ScorePlayer; week: ScoresWeek; scoringPeriodId?: number; className: string; children: ReactNode }) {
  const location = useLocation();
  const game = cardGame(player, week, scoringPeriodId);
  if (!game) return <div className={className}>{children}</div>;
  return (
    <Link
      className={`${className} score-player-game-link`}
      to={nbaGameHref(game.date, { team: game.team, player: String(player.id) })}
      state={{ returnTo: `${location.pathname}${location.search}` }}
      aria-label={`${player.name}: open his NBA game`}
    >
      {children}
    </Link>
  );
}

function cardClass(started: boolean, player: ScorePlayer): string {
  const badge = injuryBadge(player.injuryStatus);
  return ['score-player', started ? '' : 'is-bench', badge?.tone === 'out' ? 'is-out' : ''].filter(Boolean).join(' ');
}

function PlayerPoints({ actual, projected, player, week, period }: { actual: string; projected: number | null; player: ScorePlayer; week: ScoresWeek; period?: number }) {
  return (
    <span className="score-player-points">
      <span className="score-player-pts is-labeled"><ScoreBreakdown player={player} week={week} period={period} total={Number(actual)} /></span>
      {projected !== null && <span className="score-points-projected" aria-label="Projected points">{projected.toFixed(1)}</span>}
    </span>
  );
}

interface DayCellProps {
  player: ScorePlayer | undefined;
  week: ScoresWeek;
  scoringPeriodId: number;
  expected: ExpectedPoints;
  overage?: OverageGame;
  /** On the floor and foul trouble, when his game has started. */
  court?: CourtRead;
  demo?: boolean;
}

/**
 * Actual points stay prominent before, during and after the game.
 * A smaller projected finish sits below until the game is complete.
 * The card lights only while he is on the floor, not for his whole game.
 */
function DayCell({ player, week, scoringPeriodId, expected, overage, court }: DayCellProps) {
  if (!player) return <div className="score-player is-empty" aria-hidden="true" />;
  const day = player.days[String(scoringPeriodId)];
  const slot = slotOn(player, scoringPeriodId);
  const proj = playerDayProjection(player, week, expected, scoringPeriodId, true);
  const status = day?.game?.status;
  const underway = day?.played === true || status === 'live' || status === 'final';
  const projected = status !== 'final' && proj !== null && proj > 0 && (!underway || status === 'live') ? proj : null;
  const onCourt = status === 'live' && court?.onCourt === true;
  const foulTrouble = status === 'live' && court?.foul?.state === 'trouble' ? foulTitle(court.foul) : undefined;
  return (
    <div className={`${cardClass(day?.started === true, player)}${overage ? ' is-overage' : ''}${onCourt ? ' is-live' : ''}`}>
      <div className="score-player-top">
        <PlayerTop player={player} slot={slot} foulTrouble={foulTrouble} scoring={week.scoringItems} />
        <PlayerPoints player={player} week={week} period={scoringPeriodId} actual={day ? day.points.toFixed(1) : '0.0'} projected={projected} />
      </div>
      <GameLink player={player} week={week} scoringPeriodId={scoringPeriodId} className={`score-player-game${status === 'live' ? ' is-live' : ''}`}>
        {status === 'live' && <span className="score-live-label">LIVE</span>}
        {gameText(day?.game ?? null, tipoffText(day?.game?.tipoff ?? null))}
      </GameLink>
      {day?.stats && <div className="score-player-line">{statLineText(day.stats)}</div>}
      {overage &&<div className="score-overage-label">OVERAGE · −{projText(overage.deduction)}</div>}
    </div>
  );
}

interface WeekCellProps {
  player: ScorePlayer | undefined;
  week: ScoresWeek;
  expected: ExpectedPoints;
  overages: OverageGame[];
}

/**
 * One player over the week: actual points above a muted projected finish,
 * and how many games he has played and has left. A bench player's
 * games and projection count every game his team has, as if started.
 */
function WeekCell({ player, week, expected, overages }: WeekCellProps) {
  if (!player) return <div className="score-player is-empty" aria-hidden="true" />;
  const summary = playerWeek(player, week, true);
  const started = Object.values(player.days).some((day) => day.started);
  const excluded = overages.filter((game) => game.playerId === player.id);
  const deduction = excluded.reduce((sum, game) => sum + game.deduction, 0);
  const proj = summary.left > 0 || excluded.length > 0 ? playerWeekProjection(player, week, expected, true) - deduction : null;
  return (
    <div className={cardClass(started, player)}>
      <div className="score-player-top">
        <PlayerTop player={player} slot={latestSlot(player)} scoring={week.scoringItems} />
        <PlayerPoints player={player} week={week} actual={summary.total.toFixed(1)} projected={proj} />
      </div>
      <GameLink player={player} week={week} className="score-player-game">
        {summary.played} played · {summary.left} left
      </GameLink>
      {excluded.length > 0 && <div className="score-overage-label">{excluded.length} overage{excluded.length === 1 ? '' : 's'} · −{projText(deduction)}</div>}
    </div>
  );
}

/** One day's points for both sides on two short lines: points and projection, then FPPG. */
function DayTotals({ label, sides, period, projections }: {
  label: string;
  sides: [ScoreSide, ScoreSide];
  period: number;
  projections: [number | undefined, number | undefined];
}) {
  return <section className="score-starter-subtotal" aria-label={label}>
    {sides.map((side, index) => {
      const projection = projections[index];
      const fppg = lineupFppg(side, period);
      return <Fragment key={side.teamId}>
        {index === 1 && <div className="score-subtotal-label">DAY<br />TOTAL</div>}
        <div className={index === 1 ? 'score-subtotal-side is-right' : 'score-subtotal-side'}>
          <div className="score-subtotal-line">
            <strong className="score-subtotal-points" aria-label={`${side.name} daily points`}>{(side.pointsByDay[String(period)] ?? 0).toFixed(1)}</strong>
            {projection !== undefined && <small className="score-subtotal-projection">Proj <b>{projText(projection)}</b></small>}
          </div>
          <div className="score-subtotal-fppg">{fppgText(fppg.average)} FPPG · {fppg.games} GP{fppg.live ? ' · live' : ''}</div>
        </div>
      </Fragment>;
    })}
  </section>;
}

/** Keep both benches below the same divider, even when starter counts differ. */
function LineupGrid({ home, away, isStarter, renderCell, starterSummary }: {
  home: ScorePlayer[];
  away: ScorePlayer[];
  isStarter: (player: ScorePlayer) => boolean;
  renderCell: (player: ScorePlayer | undefined, side: 'home' | 'away') => ReactNode;
  starterSummary?: ReactNode;
}) {
  const groups = [true, false].map(starters => ({
    starters,
    home: home.filter(player => isStarter(player) === starters),
    away: away.filter(player => isStarter(player) === starters),
  }));
  return <>{groups.map(group => {
    const count = Math.max(group.home.length, group.away.length);
    if (!count) return group.starters ? <Fragment key="starter-summary">{starterSummary}</Fragment> : null;
    return <Fragment key={String(group.starters)}>
      {!group.starters && <div className="score-bench-divider" role="separator" aria-label="Bench and injured reserve"><span>BENCH / IR</span></div>}
      <div className="score-grid">{Array.from({ length: count }, (_, index) => <Fragment key={group.home[index]?.id ?? `h${index}`}>
        {renderCell(group.home[index], 'home')}
        {renderCell(group.away[index], 'away')}
      </Fragment>)}</div>
      {group.starters && starterSummary}
    </Fragment>;
  })}</>;
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
  const dayNav = useRef<HTMLDivElement>(null);
  const scoreHeader = useRef<HTMLElement>(null);
  const [showStickyScore, setShowStickyScore] = useState(false);

  const loaded = query.data;
  // The commissioner's cap for this week when he set one, else ESPN's.
  const week: ScoresWeek | undefined = useMemo(
    () => (loaded ? { ...loaded, gamesCap: capFor(loaded.matchupPeriodId, loaded.gamesCap) } : undefined),
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
  const homeForecast = week && matchup ? sideProjection(matchup.home, week, expected) : null;
  const awayForecast = week && matchup ? sideProjection(matchup.away, week, expected) : null;
  // "1 over" jumps to the first day that side's lineup runs past the games cap.
  const firstOverage = (forecast: typeof homeForecast) => {
    const first = forecast?.overages.reduce<number | null>((min, game) => (min === null || game.scoringPeriodId < min ? game.scoringPeriodId : min), null) ?? null;
    const day = first === null ? undefined : week?.days.find((entry) => entry.scoringPeriodId === first);
    if (!day) return undefined;
    return { scoringPeriodId: day.scoringPeriodId, label: new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  };
  const homeOver = firstOverage(homeForecast);
  const awayOver = firstOverage(awayForecast);
  const openDay = (scoringPeriodId: number) => {
    setView({ kind: 'day', scoringPeriodId });
    dayNav.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const homeProj = settled ? null : homeForecast;
  const awayProj = settled ? null : awayForecast;
  // The box scores behind on-the-floor and foul trouble: today only, and only once a game has tipped.
  const courtDay = !demo && week && view?.kind === 'day' && view.scoringPeriodId === week.currentScoringPeriodId
    ? week.days.find((day) => day.scoringPeriodId === view.scoringPeriodId) ?? null
    : null;
  const courtLive = courtDay !== null && matchup !== undefined && [...matchup.home.players, ...matchup.away.players]
    .some((player) => {
      const status = player.days[String(courtDay.scoringPeriodId)]?.game?.status;
      return status === 'live' || status === 'final';
    });
  const court = useCourt(courtDay?.date ?? null, courtLive);
  useEffect(() => {
    const header = scoreHeader.current;
    if (!header) return;
    const observer = new IntersectionObserver(([entry]) => setShowStickyScore(entry.boundingClientRect.bottom <= 0));
    observer.observe(header);
    return () => observer.disconnect();
  }, [matchup?.id]);

  const back = `/scores${scoresQuery({ week: week?.matchupPeriodId ?? requestedWeek, demo })}`;
  const isCommish = identity?.isCommissioner === true;

  const dayTotals = (label: string) => matchup && view?.kind === 'day' && week ? <DayTotals
    label={label}
    sides={[matchup.home, matchup.away]}
    period={view.scoringPeriodId}
    projections={view.scoringPeriodId >= week.currentScoringPeriodId
      ? [homeProj?.byDay[String(view.scoringPeriodId)], awayProj?.byDay[String(view.scoringPeriodId)]]
      : [undefined, undefined]}
  /> : null;

  return (
    <div className="mock-page scores-page">
      <div className="mock-head">
        <Link to={back} className="hub-heading score-back">
          <NavIcon name="chevrons" size={14} className="icon-in-heading" />
          SCORES
        </Link>
        <IdentityChip />
      </div>

      {week && matchup && <MatchupStrip week={week} selected={matchup.id} demo={demo} day={dayParam} />}

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
          <section ref={scoreHeader} className="panel score-head">
            <div className="score-head-grid">
              <SideHead side={matchup.home} owner={owners.get(matchup.home.teamId)} proj={homeProj?.week ?? null} leading={matchup.home.total > matchup.away.total} />
              <SideHead side={matchup.away} owner={owners.get(matchup.away.teamId)} proj={awayProj?.week ?? null} leading={matchup.away.total > matchup.home.total} right />
            </div>
            <WinBar left={chance.home} right={chance.away} />
            {matchup.winner !== 'UNDECIDED' && <div className="score-final">FINAL</div>}
            <details className="score-matchup-details">
              <summary>Matchup details</summary>
              <div className="score-head-grid score-extra-stats">
                {[matchup.home, matchup.away].map((side, index) => {
                  const deduction = (index === 0 ? homeForecast : awayForecast)?.deduction ?? 0;
                  return <div key={side.teamId} className={index === 1 ? 'is-right' : undefined}>
                    <strong>{side.abbrev || side.name}</strong>
                    <div className="score-side-owner">Record {recordText(side.record)}</div>
                    <FppgLabel side={side} />
                    {deduction > 0 && <div className="score-overage-label">−{projText(deduction)} projected overage</div>}
                  </div>;
                })}
              </div>
            <div className="score-games-grid">
              <GamesLine
                side={matchup.home}
                week={week}
                onEdit={isCommish ? () => setEditingCap(true) : undefined}
                overage={homeOver ? { label: homeOver.label, open: () => openDay(homeOver.scoringPeriodId) } : undefined}
              />
              <GamesLine
                side={matchup.away}
                week={week}
                onEdit={isCommish ? () => setEditingCap(true) : undefined}
                overage={awayOver ? { label: awayOver.label, open: () => openDay(awayOver.scoringPeriodId) } : undefined}
                right
              />
            </div>
            {editingCap && isCommish && (
              <CapEditor matchupPeriodId={week.matchupPeriodId} cap={week.gamesCap ?? 0} onClose={() => setEditingCap(false)} />
            )}
            </details>
          </section>

          <div className={`score-sticky-summary${showStickyScore ? ' is-visible' : ''}`} aria-hidden={!showStickyScore} aria-label="Matchup score">
            {[matchup.home, matchup.away].map((side, index) => {
              return <div key={side.teamId} className={`score-sticky-side${index === 1 ? ' is-right' : ''}`}>
                <FantasyTeamLogo side={side} size={30} />
                <span className="score-sticky-name">{side.abbrev || side.name}</span>
                <span className="score-sticky-numbers">
                  <strong aria-label={`${side.name}: ${side.total.toFixed(1)} points`}>{side.total.toFixed(1)}</strong>
                </span>
              </div>;
            })}
            <WinBar left={chance.home} right={chance.away} />
          </div>

          <div ref={dayNav} className="score-week score-day-nav" role="group" aria-label="Day">
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

          {view.kind === 'week' && <div className="score-head-grid"><FppgLabel side={matchup.home} /><div className="is-right"><FppgLabel side={matchup.away} /></div></div>}

          {view.kind === 'day' && <LineupGrid
            home={lineupOrder(rosterOn(matchup.home.players, view.scoringPeriodId), view.scoringPeriodId)}
            away={lineupOrder(rosterOn(matchup.away.players, view.scoringPeriodId), view.scoringPeriodId)}
            isStarter={player => isActiveSlot(slotOn(player, view.scoringPeriodId))}
            starterSummary={dayTotals('Daily starter totals')}
            renderCell={(player, side) => <DayCell demo={demo} player={player} week={week} scoringPeriodId={view.scoringPeriodId} expected={expected} court={player ? court.get(String(player.id)) : undefined} overage={(side === 'home' ? homeForecast : awayForecast)?.overages.find(game => game.playerId === player?.id && game.scoringPeriodId === view.scoringPeriodId)} />}
          />}

          {view.kind === 'week' && <LineupGrid
            home={weekOrder(matchup.home.players)}
            away={weekOrder(matchup.away.players)}
            isStarter={player => isActiveSlot(latestSlot(player))}
            renderCell={(player, side) => <WeekCell player={player} week={week} expected={expected} overages={(side === 'home' ? homeForecast : awayForecast)?.overages ?? []} />}
          />}

        </>
      )}
    </div>
  );
}

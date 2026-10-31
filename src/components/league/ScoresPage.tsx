import { FppgLabel } from './LineupFppg.js';
import { leadPerExtraGameLabel } from '../../lib/league/lineupFppg.js';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';
import { useExpectedPoints, useGamesCaps, useScoresWeek } from '../../hooks/useScores.js';
import { projText, sideProjection } from '../../lib/league/dailyProjection.js';
import { leagueDataset } from '../../lib/league/data.js';
import { todayIso } from '../../lib/league/navSections.js';
import {
  beforeSeason,
  longDate,
  matchupChance,
  orderForViewer,
  ownerByEspnTeamId,
  seasonStartDate,
  type ScoreMatchup,
  type ScoreSide,
  type ScoresWeek,
} from '../../lib/league/scores.js';
import FantasyTeamLogo from './FantasyTeamLogo.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { ScoresNotice, WeekPicker, WinBar } from './ScoresBits.js';
import { numberParam, scoresQuery } from './scoresUi.js';

interface SideProps {
  side: ScoreSide;
  week: ScoresWeek;
  owner: string | undefined;
  leading: boolean;
  mine: boolean;
  /** Where the team should finish the week. Null when there is nothing to say. */
  proj: number | null;
  deduction: number;
  /** Projected to finish ahead of the other side. */
  projAhead: boolean;
  right?: boolean;
}

/** One team on a card: name, owner, total, projection. Home left, away right, as on the matchup page. */
function CardSide({ side, week, owner, leading, mine, proj, deduction, projAhead, right }: SideProps) {
  return (
    <div className={`score-side-head${right ? ' is-right' : ''}${leading ? ' is-leading' : ''}${mine ? ' is-mine' : ''}`}>
      <div className="score-team-heading"><FantasyTeamLogo side={side} /><div className="score-side-name">{side.name} <span className="score-side-owner-inline">· {owner ?? 'Unknown owner'}</span></div></div>
      <FppgLabel side={side} week={week} />
      <div className="score-side-scoreline"><div className="score-side-total">{side.total.toFixed(1)}</div>
      {proj !== null && (
        <div className={`score-side-proj${projAhead ? ' is-up' : ''}`} title={deduction > 0 ? `${projText(deduction)} overage points deducted` : undefined}>Proj <b>{projText(proj)}</b></div>
      )}
      </div>
    </div>
  );
}

/** The five matchups of one fantasy week, your own on top. */
export default function ScoresPage() {
  const [params, setParams] = useSearchParams();
  const demo = params.get('demo') === '1';
  const requestedWeek = numberParam(params.get('week'));
  const { identity } = useIdentity();
  const preseason = !demo && beforeSeason(todayIso());
  const query = useScoresWeek(requestedWeek, demo, !preseason);
  const expected = useExpectedPoints();
  const { capFor } = useGamesCaps();
  const owners = useMemo(() => ownerByEspnTeamId(leagueDataset.teams), []);
  const myTeamId = identity
    ? (leagueDataset.teams.find((team) => team.owner === identity.owner)?.espnTeamId ?? null)
    : null;

  const loaded = query.data;
  // The commissioner's cap for this week when he set one, else ESPN's.
  const week = useMemo(
    () => (loaded ? { ...loaded, gamesCap: capFor(loaded.matchupPeriodId, loaded.gamesCap) } : undefined),
    [loaded, capFor],
  );
  const matchups = useMemo(() => (week ? orderForViewer(week.matchups, myTeamId) : []), [week, myTeamId]);
  const selectedWeek = week?.matchupPeriodId ?? requestedWeek;

  const setWeek = (matchupPeriodId: number) => {
    const next = new URLSearchParams(params);
    next.set('week', String(matchupPeriodId));
    setParams(next);
  };

  const linkTo = (matchup: ScoreMatchup) =>
    `/scores/${matchup.id}${scoresQuery({ week: week?.matchupPeriodId ?? null, demo })}`;

  return (
    <div className="mock-page scores-page">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
          <NavIcon name="tv" size={16} className="icon-in-heading" />
          SCORES
        </h1>
        <IdentityChip />
      </div>

      {demo && (
        <div className="score-demo" role="status">
          Demo numbers. Real scores start {longDate(seasonStartDate())}.{' '}
          <Link to="/scores">Leave the demo.</Link>
        </div>
      )}

      {!preseason && (
        <WeekPicker weeks={week?.weeks ?? []} selected={selectedWeek} onChange={setWeek} />
      )}

      <nav className="score-quick-links" aria-label="Score tools">
        {!demo && <Link className="tap-btn mock-mini-btn" to="/scores/performers" >Top Performers</Link>}
        {!demo && <Link className="tap-btn mock-mini-btn" to="/scores/nba-scoreboard" aria-label="NBA scoreboard">NBA Scores</Link>}
        {week && week.matchups.length > 0 && <Link className="tap-btn mock-mini-btn" to={`/scores/ppg${scoresQuery({ week: week.matchupPeriodId, demo })}`} aria-label="Weekly PPG and trends">Weekly Trends</Link>}
      </nav>

      {preseason && (
        <ScoresNotice>
          Week 1 starts {longDate(seasonStartDate())}. Scores show up here once the games do.
        </ScoresNotice>
      )}

      {!preseason && query.isLoading && <ScoresNotice>Loading scores from ESPN...</ScoresNotice>}

      {!preseason && query.isError && (
        <ScoresNotice onRetry={() => { void query.refetch(); }}>
          ESPN did not answer. Try again in a minute.
        </ScoresNotice>
      )}

      {week && week.matchups.length === 0 && (
        <ScoresNotice>ESPN has no scores for this week yet.</ScoresNotice>
      )}

      {week && matchups.length > 0 && (
        <div className="score-list">
          {matchups.map((matchup) => {
            const chance = matchupChance(matchup, week, expected);
            const homeForecast = sideProjection(matchup.home, week, expected);
            const awayForecast = sideProjection(matchup.away, week, expected);
            const homeProj = homeForecast.week;
            const awayProj = awayForecast.week;
            // A settled matchup has nothing left to project; before any source loads there is nothing to say.
            const showProj = matchup.winner === 'UNDECIDED' && homeProj + awayProj > 0;
            const homeLeads = matchup.home.total > matchup.away.total;
            const awayLeads = matchup.away.total > matchup.home.total;
            const mine = matchup.home.teamId === myTeamId || matchup.away.teamId === myTeamId;
            const fppgGap = leadPerExtraGameLabel(matchup.home, matchup.away, owners.get(matchup.home.teamId), owners.get(matchup.away.teamId));
            return (
              <Link key={matchup.id} to={linkTo(matchup)} className={`panel score-card${mine ? ' is-mine' : ''}`}>
                <div className="score-head-grid">
                  <CardSide
                    week={week}
                    side={matchup.home}
                    owner={owners.get(matchup.home.teamId)}
                    leading={homeLeads}
                    mine={matchup.home.teamId === myTeamId}
                    proj={showProj ? homeProj : null}
                    deduction={homeForecast.deduction}
                    projAhead={homeProj > awayProj}
                  />
                  <CardSide
                    week={week}
                    side={matchup.away}
                    owner={owners.get(matchup.away.teamId)}
                    leading={awayLeads}
                    mine={matchup.away.teamId === myTeamId}
                    proj={showProj ? awayProj : null}
                    deduction={awayForecast.deduction}
                    projAhead={awayProj > homeProj}
                    right
                  />
                </div>
                <WinBar left={chance.home} right={chance.away} />
                {fppgGap && <div className="score-fppg-gap">{fppgGap}</div>}
                {matchup.winner !== 'UNDECIDED' && <div className="score-final">FINAL</div>}
              </Link>
            );
          })}
        </div>
      )}


      {week && (
        <p className="score-foot">Projections include overage deductions.{week.matchupPeriodId === week.currentMatchupPeriodId && !demo && ' Updates every minute.'}</p>
      )}
    </div>
  );
}

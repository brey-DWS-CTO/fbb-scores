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
  recordText,
  seasonStartDate,
  type ScoreMatchup,
  type ScoreSide,
} from '../../lib/league/scores.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import { ScoresNotice, WeekPicker, WinBar } from './ScoresBits.js';
import { numberParam, scoresQuery } from './scoresUi.js';

interface RowProps {
  side: ScoreSide;
  owner: string | undefined;
  leading: boolean;
  mine: boolean;
}

function TeamRow({ side, owner, leading, mine }: RowProps) {
  return (
    <div className={`score-row${leading ? ' is-leading' : ''}${mine ? ' is-mine' : ''}`}>
      <div className="score-row-who">
        <div className="score-row-name">{side.name}</div>
        <div className="score-row-owner">
          {owner ?? 'Unknown owner'} · {recordText(side.record)}
        </div>
      </div>
      <div className="score-row-total">{side.total.toFixed(1)}</div>
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
  // The commissioner's cap for this week, in place of ESPN's lineup limit.
  const week = useMemo(
    () => (loaded ? { ...loaded, gamesCap: capFor(loaded.matchupPeriodId) } : undefined),
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
            const homeProj = sideProjection(matchup.home, week, expected).week;
            const awayProj = sideProjection(matchup.away, week, expected).week;
            const homeLeads = matchup.home.total > matchup.away.total;
            const awayLeads = matchup.away.total > matchup.home.total;
            const mine = matchup.home.teamId === myTeamId || matchup.away.teamId === myTeamId;
            return (
              <Link key={matchup.id} to={linkTo(matchup)} className={`panel score-card${mine ? ' is-mine' : ''}`}>
                <TeamRow side={matchup.home} owner={owners.get(matchup.home.teamId)} leading={homeLeads} mine={matchup.home.teamId === myTeamId} />
                <WinBar left={chance.home} right={chance.away} />
                <TeamRow side={matchup.away} owner={owners.get(matchup.away.teamId)} leading={awayLeads} mine={matchup.away.teamId === myTeamId} />
                {matchup.winner === 'UNDECIDED' && (
                  <div className="score-proj">
                    <span className="score-proj-title">Proj</span>
                    <b className={homeProj > awayProj ? 'is-up' : ''}>{projText(homeProj)}</b>
                    <span className="score-proj-dash">–</span>
                    <b className={awayProj > homeProj ? 'is-up' : ''}>{projText(awayProj)}</b>
                  </div>
                )}
                {matchup.winner !== 'UNDECIDED' && <div className="score-final">FINAL</div>}
              </Link>
            );
          })}
        </div>
      )}

      {week && (
        <p className="score-foot">
          Proj is where each team should finish the week. Win chance comes from the same numbers: points so far plus each player&apos;s expected points for every game left.
          A player&apos;s expected points are ESPN&apos;s projection for the day when it has one, else a blend of his last 15 days, his season and his preseason projection.
          {week.matchupPeriodId === week.currentMatchupPeriodId && !demo && ' Updates every minute while you watch.'}
        </p>
      )}
    </div>
  );
}

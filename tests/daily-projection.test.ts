import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLEND_WEIGHTS,
  blendExpected,
  expectedPointsForGame,
  playerDayProjection,
  playerWeekProjection,
  projText,
  sideProjection,
} from '../src/lib/league/dailyProjection.ts';
import { sideOdds, type GameLine, type ScorePlayer, type ScoreSide, type ScoresWeek } from '../src/lib/league/scores.ts';
import { sideMean } from '../src/lib/league/winOdds.ts';

// ─── A small week by hand ───────────────────────────────────────────────────

const line = (overrides: Partial<GameLine>): GameLine => ({
  status: 'upcoming', opponent: 'LAL', home: true, teamScore: null, oppScore: null, clock: null, tipoff: null, minutesLeft: null, ...overrides,
});

/** Three days: yesterday (final), today (DEN live, GSW upcoming), tomorrow (both upcoming). */
const WEEK: Pick<ScoresWeek, 'days' | 'currentScoringPeriodId' | 'gamesCap'> = {
  currentScoringPeriodId: 18,
  gamesCap: null,
  days: [
    { scoringPeriodId: 17, date: '2026-11-04', games: { DEN: line({ status: 'final', teamScore: 112, oppScore: 104 }), GSW: line({ status: 'final', teamScore: 120, oppScore: 118 }) } },
    { scoringPeriodId: 18, date: '2026-11-05', games: { DEN: line({ status: 'live', teamScore: 50, oppScore: 48, clock: 'Half', minutesLeft: 24 }), GSW: line({}) } },
    { scoringPeriodId: 19, date: '2026-11-06', games: { DEN: line({}), GSW: line({}) } },
  ],
};

interface PlayerInput {
  id: number;
  name: string;
  proTeam: 'DEN' | 'GSW' | '';
  injuryStatus?: string | null;
  seasonAvg?: number | null;
  last15?: number | null;
  projByDay?: Record<string, number>;
  points?: Record<string, number>;
  started?: boolean;
}

function player(input: PlayerInput): ScorePlayer {
  const proTeamId = input.proTeam === 'DEN' ? 7 : input.proTeam === 'GSW' ? 9 : 0;
  const days: ScorePlayer['days'] = {};
  for (const day of WEEK.days) {
    const key = String(day.scoringPeriodId);
    const points = input.points?.[key] ?? 0;
    days[key] = {
      lineupSlotId: input.started === false ? 12 : 0,
      started: input.started !== false,
      points,
      stats: null,
      played: points > 0,
      game: day.games?.[input.proTeam] ?? null,
    };
  }
  return {
    id: input.id,
    name: input.name,
    position: 'C',
    proTeamId,
    proTeam: input.proTeam,
    injuryStatus: input.injuryStatus ?? null,
    seasonAvg: input.seasonAvg ?? null,
    last7: null,
    last15: input.last15 ?? null,
    last30: null,
    projByDay: input.projByDay ?? {},
    days,
  };
}

function side(players: ScorePlayer[], pointsByDay: Record<string, number>): ScoreSide {
  const total = Object.values(pointsByDay).reduce((sum, value) => sum + value, 0);
  return { teamId: 7, name: 'Home', abbrev: 'HOM', record: { wins: 0, losses: 0, ties: 0 }, total, pointsByDay, players };
}

const CTX = { scoringPeriodId: 18, preseason: 20 };

// ─── One player's expected points ───────────────────────────────────────────

test('the blend weights add to one and renormalize as sources go missing', () => {
  assert.ok(Math.abs(BLEND_WEIGHTS.last15 + BLEND_WEIGHTS.season + BLEND_WEIGHTS.preseason - 1) < 1e-9);
  assert.equal(blendExpected({ last15: 40, season: 30, preseason: 20 }), 0.5 * 40 + 0.3 * 30 + 0.2 * 20);
  // No last 15: the season and preseason weights scale up to add to one.
  assert.ok(Math.abs((blendExpected({ last15: null, season: 30, preseason: 20 }) as number) - (0.3 * 30 + 0.2 * 20) / 0.5) < 1e-9);
  // Opening night: the preseason projection stands alone.
  assert.equal(blendExpected({ last15: null, season: null, preseason: 20 }), 20);
  assert.equal(blendExpected({ last15: 40, season: null, preseason: null }), 40);
  assert.equal(blendExpected({ last15: null, season: null, preseason: null }), null);
  // A negative average never pulls the number below zero.
  assert.equal(blendExpected({ last15: -5, season: null, preseason: null }), 0);
});

test('ESPN\'s projection for the day beats the blend, and only for that day', () => {
  const jokic = player({ id: 1, name: 'Nikola Jokic', proTeam: 'DEN', seasonAvg: 50, last15: 56, projByDay: { '18': 61.5 } });
  assert.equal(expectedPointsForGame(jokic, CTX), 61.5, 'ESPN\'s own number for today');
  const blended = 0.5 * 56 + 0.3 * 50 + 0.2 * 20;
  assert.ok(Math.abs(expectedPointsForGame(jokic, { scoringPeriodId: 19, preseason: 20 }) - blended) < 1e-9, 'tomorrow falls back to the blend');
});

test('the blend takes the preseason projection as its third source, and nothing is zero', () => {
  const rookie = player({ id: 2, name: 'Rookie', proTeam: 'GSW' });
  assert.equal(expectedPointsForGame(rookie, { scoringPeriodId: 18, preseason: 18 }), 18, 'before his first game, the preseason projection');
  assert.equal(expectedPointsForGame(rookie, { scoringPeriodId: 18, preseason: null }), 0, 'with no source at all, nothing');
  const vet = player({ id: 3, name: 'Vet', proTeam: 'GSW', seasonAvg: 30 });
  assert.equal(vet.last15, null);
  assert.ok(Math.abs(expectedPointsForGame(vet, { scoringPeriodId: 18, preseason: null }) - 30) < 1e-9, 'season alone when that is all there is');
});

test('out and suspended project to nothing, whatever ESPN says', () => {
  const out = player({ id: 4, name: 'Out Guy', proTeam: 'DEN', injuryStatus: 'OUT', seasonAvg: 40, last15: 45, projByDay: { '18': 44 } });
  const suspended = player({ id: 5, name: 'Banned Guy', proTeam: 'DEN', injuryStatus: 'SUSPENSION', seasonAvg: 40 });
  const dtd = player({ id: 6, name: 'Sore Guy', proTeam: 'DEN', injuryStatus: 'DAY_TO_DAY', seasonAvg: 40 });
  assert.equal(expectedPointsForGame(out, CTX), 0);
  assert.equal(expectedPointsForGame(suspended, CTX), 0);
  assert.equal(expectedPointsForGame(dtd, CTX), (0.3 * 40 + 0.2 * 20) / 0.5, 'day to day still plays');
});

// ─── A player's day and week ────────────────────────────────────────────────

const expected = (p: ScorePlayer, scoringPeriodId: number) => expectedPointsForGame(p, { scoringPeriodId, preseason: 20 });

test('a player with no game on a day gets no projection, not a zero', () => {
  const jokic = player({ id: 1, name: 'Nikola Jokic', proTeam: 'DEN', seasonAvg: 50, points: { '17': 56.8, '18': 30 } });
  const noTeam = player({ id: 7, name: 'Free Agent', proTeam: '', seasonAvg: 10 });
  assert.equal(playerDayProjection(jokic, WEEK, expected, 17), null, 'yesterday is over');
  assert.equal(playerDayProjection(noTeam, WEEK, expected, 18), null, 'no team, no game');
  const out = player({ id: 4, name: 'Out Guy', proTeam: 'DEN', injuryStatus: 'OUT', seasonAvg: 40 });
  assert.equal(playerDayProjection(out, WEEK, expected, 18), null, 'out means no game to come');
});

test('a live game projects points so far plus the share left; a game to come projects the whole thing', () => {
  const jokic = player({ id: 1, name: 'Nikola Jokic', proTeam: 'DEN', seasonAvg: 50, points: { '17': 56.8, '18': 30 } });
  const blended = 0.3 * 50 + 0.2 * 20;
  const perGame = blended / 0.5;
  // Today DEN is at the half: 30 so far plus half a game.
  assert.equal(playerDayProjection(jokic, WEEK, expected, 18), Math.round((30 + perGame * 0.5) * 10) / 10);
  assert.equal(playerDayProjection(jokic, WEEK, expected, 19), Math.round(perGame * 10) / 10);
  // The week: yesterday's points, today's so far, half of today and all of tomorrow.
  assert.equal(playerWeekProjection(jokic, WEEK, expected), Math.round((56.8 + 30 + perGame * 1.5) * 10) / 10);
});

// ─── A side's day and week ──────────────────────────────────────────────────

test('a side projects each day and the week from the same games the odds use', () => {
  const jokic = player({ id: 1, name: 'Nikola Jokic', proTeam: 'DEN', seasonAvg: 50, points: { '17': 56.8, '18': 30 } });
  const curry = player({ id: 8, name: 'Stephen Curry', proTeam: 'GSW', seasonAvg: 40, points: { '17': 33 } });
  const bench = player({ id: 9, name: 'Bench Guy', proTeam: 'GSW', seasonAvg: 40, started: false });
  const home = side([jokic, curry, bench], { '17': 89.8, '18': 30 });
  const proj = sideProjection(home, WEEK, expected);
  const jokicGame = (0.3 * 50 + 0.2 * 20) / 0.5;
  const curryGame = (0.3 * 40 + 0.2 * 20) / 0.5;

  assert.equal(proj.byDay['17'], 89.8, 'a day gone by projects to what it scored');
  assert.equal(proj.byDay['18'], Math.round((30 + jokicGame * 0.5 + curryGame) * 10) / 10, 'today: so far, half of DEN, all of GSW');
  assert.equal(proj.byDay['19'], Math.round((jokicGame + curryGame) * 10) / 10);
  assert.equal(proj.week, Math.round(sideMean(sideOdds(home, WEEK, expected)) * 10) / 10, 'the week is the mean the win chance works from');
  assert.ok(proj.week > home.total);
});

test('the games cap cuts a side\'s projection off in date order, but never a live game', () => {
  const jokic = player({ id: 1, name: 'Nikola Jokic', proTeam: 'DEN', seasonAvg: 50, points: { '17': 56.8, '18': 30 } });
  const curry = player({ id: 8, name: 'Stephen Curry', proTeam: 'GSW', seasonAvg: 40, points: { '17': 33 } });
  const home = side([jokic, curry], { '17': 89.8, '18': 30 });
  // Three games count already: yesterday's pair and Jokic's live one. A cap
  // of 4 leaves room for one more whole game, Curry today, and nothing after.
  const capped = sideProjection(home, { ...WEEK, gamesCap: 4 }, expected);
  const jokicGame = (0.3 * 50 + 0.2 * 20) / 0.5;
  const curryGame = (0.3 * 40 + 0.2 * 20) / 0.5;
  assert.equal(capped.byDay['18'], Math.round((30 + jokicGame * 0.5 + curryGame) * 10) / 10);
  assert.equal(capped.byDay['19'], 0, 'tomorrow is over the cap');
  const open = sideProjection(home, WEEK, expected);
  assert.ok(capped.week < open.week);
  // No room at all: only the live half of Jokic's game survives.
  const full = sideProjection(home, { ...WEEK, gamesCap: 3 }, expected);
  assert.equal(full.byDay['18'], Math.round((30 + jokicGame * 0.5) * 10) / 10);
});

test('a projection prints as a whole number with a thousands comma', () => {
  assert.equal(projText(1239.6), '1,240');
  assert.equal(projText(42.4), '42');
  assert.equal(projText(0), '0');
});

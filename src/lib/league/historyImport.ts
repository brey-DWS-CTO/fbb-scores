/**
 * Reading one ESPN season into a league-history import.
 *
 * Pure and payload-driven on purpose. Nobody working on this repo has ESPN
 * credentials, so the parser is fed fixtures in tests and the live fetch sits
 * behind one thin server function. Nothing here invents a fact: a season ESPN
 * cannot answer for comes back as problems, not as guesses.
 */

import {
  type HistoryRecord,
  type ScoreBasis,
  type SeasonImport,
  type SeasonPlacement,
  type SourceRef,
} from './history.js';

/** Only the fields this parser reads. ESPN sends a great deal more. */
export interface EspnSeasonTeam {
  id: number;
  name?: string;
  location?: string;
  nickname?: string;
  abbrev?: string;
  rankCalculatedFinal?: number;
  playoffSeed?: number;
}

export interface EspnMatchupSide {
  teamId?: number;
  totalPoints?: number;
}

export interface EspnSeasonMatchup {
  id?: number;
  matchupPeriodId?: number;
  playoffTierType?: string;
  winner?: string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

export interface EspnSeasonPayload {
  id?: number;
  seasonId?: number;
  teams?: EspnSeasonTeam[];
  schedule?: EspnSeasonMatchup[];
  status?: {
    finalScoringPeriod?: number;
    currentMatchupPeriod?: number;
    isActive?: boolean;
    latestScoringPeriod?: number;
  };
}

/** How one ESPN team id maps onto a league franchise. */
export interface TeamMapping {
  espnTeamId: number;
  franchiseId: string;
  /** The person running that team that season. Falls back to the ESPN team name. */
  ownerName?: string;
}

export interface SeasonImportOptions {
  seasonNumber: number;
  label: string;
  startYear: number;
  endYear: number;
  espnSeasonId: number;
  teamMap: TeamMapping[];
  /** Category the weekly scores belong to. */
  categoryId: string;
  /** Lowest total worth keeping, matching the category's criteria. */
  recordMinimum: number;
  basis: ScoreBasis;
  fetchedAt: string;
  /** Where the payload came from, when it was not a live fetch. */
  sourceReference?: string;
}

export interface ImportProblem {
  kind:
    | 'wrong-season'
    | 'no-teams'
    | 'unmapped-team'
    | 'season-in-progress'
    | 'no-final-rankings'
    | 'no-schedule'
    | 'tied-final';
  severity: 'error' | 'review';
  message: string;
}

export interface SeasonImportCandidate {
  seasonImport: SeasonImport | null;
  problems: ImportProblem[];
  /** Team names as ESPN gave them, so the commissioner can build the mapping. */
  espnTeams: Array<{ espnTeamId: number; name: string; finalRank: number | null }>;
}

const teamName = (team: EspnSeasonTeam): string => {
  const joined = [team.location, team.nickname].filter(Boolean).join(' ').trim();
  return team.name?.trim() || joined || team.abbrev?.trim() || `Team ${team.id}`;
};

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';

/** Deterministic id: one team, one week, one score. */
export function weeklyRecordId(
  seasonNumber: number,
  period: number | null,
  franchiseId: string | null,
  ownerName: string,
): string {
  return `hs-s${seasonNumber}-w${period ?? 'x'}-${franchiseId ?? slug(ownerName)}`;
}

/**
 * Turn one ESPN season response into a season import.
 *
 * Final placements come from ESPN's own final ranking. Where ESPN does not
 * carry one, the last playoff matchup decides the top two and everyone else is
 * left unplaced, because a made-up standing is worse than a gap.
 */
export function parseEspnSeason(
  payload: EspnSeasonPayload,
  options: SeasonImportOptions,
): SeasonImportCandidate {
  const problems: ImportProblem[] = [];
  const teams = payload.teams ?? [];
  const espnTeams = teams.map((team) => ({
    espnTeamId: team.id,
    name: teamName(team),
    finalRank: typeof team.rankCalculatedFinal === 'number' && team.rankCalculatedFinal > 0
      ? team.rankCalculatedFinal
      : null,
  }));

  if (payload.seasonId !== undefined && payload.seasonId !== options.espnSeasonId) {
    problems.push({
      kind: 'wrong-season',
      severity: 'error',
      message: `ESPN answered for season ${payload.seasonId}, not ${options.espnSeasonId}`,
    });
  }
  if (teams.length === 0) {
    problems.push({
      kind: 'no-teams',
      severity: 'error',
      message: 'ESPN returned no teams for that season',
    });
  }
  if (payload.status?.isActive === true) {
    problems.push({
      kind: 'season-in-progress',
      severity: 'error',
      message: 'That season is still running; close it once ESPN calls it final',
    });
  }

  const mapByTeam = new Map(options.teamMap.map((entry) => [entry.espnTeamId, entry]));
  for (const team of teams) {
    if (!mapByTeam.has(team.id)) {
      problems.push({
        kind: 'unmapped-team',
        severity: 'error',
        message: `ESPN team ${team.id} (${teamName(team)}) is not mapped to a franchise`,
      });
    }
  }

  const source: SourceRef = {
    provenance: 'espn',
    reference:
      options.sourceReference
      ?? `espn:leagues/${String(payload.id ?? 'unknown')}?seasonId=${options.espnSeasonId}`,
    verified: false,
    reviewNote: 'Imported from ESPN. Check it against what the league remembers before publishing.',
    recordedAt: options.fetchedAt,
  };

  const ownerFor = (team: EspnSeasonTeam): string =>
    mapByTeam.get(team.id)?.ownerName ?? teamName(team);

  const placements: SeasonPlacement[] = [];
  const ranked = teams.filter((team) => typeof team.rankCalculatedFinal === 'number' && team.rankCalculatedFinal > 0);
  let standingsComplete = false;

  if (ranked.length === teams.length && teams.length > 0) {
    standingsComplete = true;
    for (const team of ranked) {
      const mapping = mapByTeam.get(team.id);
      if (!mapping) continue;
      placements.push({
        franchiseId: mapping.franchiseId,
        ownerName: ownerFor(team),
        placement: team.rankCalculatedFinal ?? null,
        source,
      });
    }
  } else {
    problems.push({
      kind: 'no-final-rankings',
      severity: 'review',
      message: 'ESPN did not carry a full final ranking; only the title game is used',
    });
    const final = lastChampionshipMatchup(payload.schedule ?? []);
    if (!final) {
      problems.push({
        kind: 'no-schedule',
        severity: 'error',
        message: 'ESPN carried neither final rankings nor a playoff bracket for that season',
      });
    } else {
      const home = teams.find((team) => team.id === final.home?.teamId);
      const away = teams.find((team) => team.id === final.away?.teamId);
      const homePoints = final.home?.totalPoints ?? 0;
      const awayPoints = final.away?.totalPoints ?? 0;
      if (homePoints === awayPoints) {
        problems.push({
          kind: 'tied-final',
          severity: 'error',
          message: 'The title game is level in the ESPN data; the commissioner must say who won',
        });
      } else {
        const winner = homePoints > awayPoints ? home : away;
        const loser = homePoints > awayPoints ? away : home;
        for (const [team, place] of [[winner, 1], [loser, 2]] as Array<[EspnSeasonTeam | undefined, number]>) {
          const mapping = team ? mapByTeam.get(team.id) : undefined;
          if (!team || !mapping) continue;
          placements.push({
            franchiseId: mapping.franchiseId,
            ownerName: ownerFor(team),
            placement: place,
            source,
          });
        }
      }
    }
  }

  const records: HistoryRecord[] = [];
  for (const matchup of payload.schedule ?? []) {
    const period = typeof matchup.matchupPeriodId === 'number' ? matchup.matchupPeriodId : null;
    const sides: Array<[EspnMatchupSide | undefined, EspnMatchupSide | undefined]> = [
      [matchup.home, matchup.away],
      [matchup.away, matchup.home],
    ];
    for (const [side, other] of sides) {
      if (!side || typeof side.totalPoints !== 'number' || side.teamId === undefined) continue;
      if (side.totalPoints < options.recordMinimum) continue;
      const team = teams.find((candidate) => candidate.id === side.teamId);
      const mapping = mapByTeam.get(side.teamId);
      if (!team || !mapping) continue;
      const opponentTeam = teams.find((candidate) => candidate.id === other?.teamId);
      const opponentMapping = other?.teamId === undefined ? undefined : mapByTeam.get(other.teamId);
      records.push({
        id: weeklyRecordId(options.seasonNumber, period, mapping.franchiseId, ownerFor(team)),
        categoryId: options.categoryId,
        franchiseId: mapping.franchiseId,
        ownerName: ownerFor(team),
        seasonNumber: options.seasonNumber,
        period,
        opponentFranchiseId: opponentMapping?.franchiseId ?? null,
        opponentName: opponentTeam ? ownerFor(opponentTeam) : null,
        value: Number(side.totalPoints.toFixed(1)),
        basis: options.basis,
        source,
      });
    }
  }
  records.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));

  const blocked = problems.some((problem) => problem.severity === 'error');
  const seasonImport: SeasonImport | null = blocked
    ? null
    : {
        seasonNumber: options.seasonNumber,
        label: options.label,
        startYear: options.startYear,
        endYear: options.endYear,
        espnSeasonId: options.espnSeasonId,
        status: 'complete',
        standingsComplete,
        placements,
        records,
        source,
      };

  return { seasonImport, problems, espnTeams };
}

/** The last matchup of the winners' bracket, which is the title game. */
function lastChampionshipMatchup(schedule: EspnSeasonMatchup[]): EspnSeasonMatchup | null {
  const bracket = schedule.filter((matchup) => matchup.playoffTierType === 'WINNERS_BRACKET');
  if (bracket.length === 0) return null;
  return bracket.reduce((latest, matchup) =>
    (matchup.matchupPeriodId ?? 0) >= (latest.matchupPeriodId ?? 0) ? matchup : latest,
  );
}

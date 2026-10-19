import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { buildDraftBoard } from '../../lib/keeper/engine.js';
import {
  RECAP_COLUMNS,
  buildDraftRecap,
  nextRecapSort,
  adpGapText,
  POSITION_ORDER,
  ordinal,
  pickPlace,
  recapCsv,
  recapPage,
  recapRows,
  ROAST_MAX_LENGTH,
  type DraftRecap,
  type PlayerAge,
  type RecapPick,
  type RecapSort,
  type RecapTeam,
} from '../../lib/league/draftRecap.js';
import { SEED_ROASTS } from '../../lib/league/draftRecapSeed.js';
import { valueBoard } from '../../lib/league/draftValue.js';
import { buildProjections } from '../../lib/league/projections.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import { teamNameOf } from '../../lib/league/teamNames.js';
import { apiErrorMessage, fetchRecapEdits, saveRecapRoast } from '../../lib/league/api.js';
import { applyProjectionEdits, editsById } from '../../lib/league/projectionEdits.js';
import { withFills } from '../../lib/league/expertProjections.js';
import { useApplyStateResponse, useDraftData, useIdentity } from '../../hooks/useLeague.js';
import { useProjectionData } from '../../hooks/useProjectionData.js';
import rawAges from '../../data/source/player-ages-2027.json' with { type: 'json' };
import SignInPanel from '../league/SignInPanel.js';
import NavIcon, { type NavIconName } from '../league/NavIcon.js';

const AGES = rawAges as Readonly<Record<string, PlayerAge>>;
const PAGE_SIZES = [20, 50, 100] as const;

const clock = (seconds: number | null) =>
  seconds === null ? '–' : seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`;
const fmt = (value: number) => value.toLocaleString('en-US');
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The verdict short enough for a board cell. */
const SHORT_VERDICT: Record<RecapPick['verdict'], string> = {
  Steal: 'Steal', 'Good value': 'Value', 'Fair price': 'Fair', 'A bit early': 'Early', Reach: 'Reach', 'No numbers': '',
};

/** Green for a steal, amber for early, red for a reach. */
function scoreClass(score: number | null): string {
  if (score === null) return '';
  if (score >= 0.3) return 'proj-good';
  if (score <= -1.2) return 'proj-bad';
  if (score <= -0.3) return 'proj-warn';
  return '';
}

/**
 * The draft recap: every team's grade first, then the draft's numbers, the
 * heat-mapped board and every pick in a table. Members see it once the
 * commissioner closes the draft; until then the stats gate holds it.
 */
export default function DraftRecapPage() {
  const { identity } = useIdentity();
  const { state, dataset } = useDraftData();
  // ESPN's numbers with the commish's injury edits, the same for every member.
  const { espn, loading: espnLoading } = useProjectionData();
  const isCommish = identity?.isCommissioner === true;
  const editsQuery = useQuery({
    queryKey: ['recap-edits', identity?.owner ?? 'anon'],
    queryFn: () => fetchRecapEdits(identity as NonNullable<typeof identity>),
    enabled: identity !== null,
    staleTime: 60_000,
  });
  const snapshot = useMemo(
    () => (espn && editsQuery.data
      ? applyProjectionEdits(withFills(espn, editsQuery.data.fills), editsById(editsQuery.data.edits))
      : null),
    [espn, editsQuery.data],
  );
  const loading = espnLoading || editsQuery.isLoading;

  const recap = useMemo((): DraftRecap | null => {
    if (!snapshot) return null;
    const values = valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027, projectionsOnly: true });
    const projections = new Map(buildProjections(values, snapshot, { keepers: {}, status: {} })
      .map((row) => [row.key, { total: row.total, games: row.games, adp: row.adp }]));
    const saved = state.draftRecap?.season === state.season ? state.draftRecap.roasts : undefined;
    return buildDraftRecap({
      season: state.season,
      board: buildDraftBoard(dataset, state),
      values,
      projections,
      teams: dataset.teams.map((team) => ({ owner: team.owner, name: teamNameOf(team, state.teamNames), draftPosition: team.draftPosition })),
      ages: AGES,
      asOf: state.draft.startedAt ?? new Date().toISOString(),
      roasts: saved,
      seedRoasts: SEED_ROASTS[state.season],
    });
  }, [snapshot, dataset, state]);

  if (!identity) {
    return <div className="mock-page"><SignInPanel reason="Sign in to see the draft recap." /></div>;
  }

  return (
    <div className="mock-page recap-page">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal recap-title">DRAFT RECAP</h1>
        <Link to="/draft" className="tap-btn mock-mini-btn">THE BOARD</Link>
      </div>
      {isCommish && !state.draft.closedAt && (
        <div className="panel proj-stale" role="status">
          Only you can see this until you close the draft in Commish Mode. Then every member can.
        </div>
      )}
      {!recap && <div className="panel recap-empty">{loading ? 'Loading the numbers…' : 'The commish has not saved ESPN numbers yet, so nothing can be graded.'}</div>}
      {recap && !recap.complete && (
        <div className="panel proj-stale" role="status">The draft isn't finished. The grades cover the picks made so far.</div>
      )}
      {recap && (
        <>
          <nav className="recap-jumps" aria-label="Jump to">
            <a href="#recap-grades">GRADES</a>
            <a href="#recap-positions">POSITIONS</a>
            <a href="#recap-steals">STEALS</a>
            <a href="#recap-board">BOARD</a>
            <a href="#recap-table">EVERY PICK</a>
          </nav>
          <Kpis recap={recap} />
          <Grades recap={recap} isCommish={isCommish} />
          <Positions recap={recap} />
          <Totals recap={recap} />
          <Makeup recap={recap} />
          <StealsAndReaches recap={recap} />
          <HeatBoard recap={recap} teams={dataset.teams.map((team) => ({ owner: team.owner, draftPosition: team.draftPosition }))} />
          <PickTable recap={recap} />
          <p className="recap-foot">
            Grades weigh projected points from the best ten starters (45%), a good-luck ceiling (15%), a bad-luck
            floor (15%), how each pick beat its slot (15%) and the bench (10%). Numbers are ESPN's projections in
            our scoring with the commish's injury calls (Hashtag's for anyone ESPN skips), the same for everyone.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Grades ──────────────────────────────────────────────────────────────────

function Grades({ recap, isCommish }: { recap: DraftRecap; isCommish: boolean }) {
  const lows = recap.teams.map((team) => team.floor);
  const highs = recap.teams.map((team) => team.ceiling);
  const lo = Math.floor(Math.min(...lows) / 1000) * 1000;
  const hi = Math.ceil(Math.max(...highs) / 1000) * 1000;
  const at = (value: number) => (hi > lo ? ((value - lo) / (hi - lo)) * 100 : 50);
  return (
    <section className="recap-section" aria-labelledby="recap-grades">
      <h2 id="recap-grades" className="hub-heading recap-h2">GRADES AND WRITE-UPS</h2>
      <div className="panel recap-strip">
        {recap.teams.map((team) => (
          <div key={team.owner} className="recap-strip-row">
            <span className="recap-strip-grade">{team.grade}</span>
            <span className="recap-strip-owner">{team.owner}</span>
            <span className="recap-track" title={`Floor ${fmt(team.floor)}, projected ${fmt(team.projected)}, ceiling ${fmt(team.ceiling)}`}>
              <span className="recap-range" style={{ left: `${at(team.floor)}%`, width: `${at(team.ceiling) - at(team.floor)}%` }} />
              <span className="recap-dot" style={{ left: `${at(team.projected)}%` }} />
            </span>
            <span className="recap-strip-pts">{fmt(team.projected)}</span>
          </div>
        ))}
        <div className="recap-strip-axis"><span>{fmt(lo)}</span><span>projected points, floor to ceiling</span><span>{fmt(hi)}</span></div>
      </div>
      <div className="recap-cards">
        {recap.teams.map((team) => <TeamCard key={team.owner} team={team} isCommish={isCommish} />)}
      </div>
    </section>
  );
}

function PickBox({ pick, kind }: { pick: RecapPick | null; kind: 'best' | 'worst' }) {
  if (!pick) return null;
  return (
    <div className={`recap-pick recap-pick-${kind}`}>
      <div className="recap-pick-label">{kind === 'best' ? 'BEST PICK' : 'WORST PICK'} · {pickPlace(pick)}</div>
      <strong>{pick.name}</strong>
      <div className="recap-pick-nums">
        <span><b>{ordinal(pick.overall)}</b>taken</span>
        <span><b>{pick.valueRank === null ? '–' : ordinal(pick.valueRank)}</b>value</span>
        <span><b>{pick.adp === null ? '–' : ordinal(Math.round(pick.adp))}</b>ESPN</span>
      </div>
    </div>
  );
}

function TeamCard({ team, isCommish }: { team: RecapTeam; isCommish: boolean }) {
  const { identity } = useIdentity();
  const applyState = useApplyStateResponse();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string) => {
    if (!identity) return;
    setSaving(true);
    setError(null);
    try {
      applyState(await saveRecapRoast(identity, team.owner, next));
      setEditing(false);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const chips = [
    team.averageAge !== null ? `avg age ${team.averageAge.toFixed(1)}` : null,
    team.rookies.length > 0 ? `${team.rookies.length} rookie${team.rookies.length === 1 ? '' : 's'}` : null,
    ...team.stacks.map((stack) => `${stack.players.length} from ${stack.club}`),
    team.autoPicks > 0 ? `${team.autoPicks} auto` : null,
    team.averageSeconds !== null ? `${clock(team.averageSeconds)} a pick` : null,
    `${team.positions.C} C · ${team.positions.PG} PG`,
  ].filter((chip): chip is string => chip !== null);

  return (
    <article className="panel recap-card">
      <header className="recap-card-head">
        <div>
          <h3 className="recap-owner">{team.owner}</h3>
          <div className="recap-teamname">{team.name} · picked {team.draftPosition}{['st', 'nd', 'rd'][team.draftPosition - 1] ?? 'th'}</div>
        </div>
        <div className="recap-grade" aria-label={`Grade ${team.grade}`}>{team.grade}</div>
      </header>
      {editing ? (
        <div className="recap-roast-edit">
          <label htmlFor={`roast-${team.owner}`} className="recap-pick-label">ROAST FOR {team.owner.toUpperCase()}</label>
          <textarea
            id={`roast-${team.owner}`}
            className="hub-input"
            rows={4}
            maxLength={ROAST_MAX_LENGTH}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="recap-roast-actions">
            <button type="button" className="tap-btn mock-mini-btn" disabled={saving || text.trim() === ''} onClick={() => void save(text)}>SAVE</button>
            <button type="button" className="tap-btn mock-mini-btn" disabled={saving} onClick={() => void save('')} title="Show the line the numbers write instead">USE THE NUMBERS</button>
            <button type="button" className="tap-btn mock-mini-btn" disabled={saving} onClick={() => setEditing(false)}>CANCEL</button>
            <span className="recap-count">{text.length}/{ROAST_MAX_LENGTH}</span>
          </div>
          {error && <div className="identity-error" role="alert">{error}</div>}
        </div>
      ) : (
        <p className="recap-roast">
          {team.roast}
          {isCommish && (
            <button type="button" className="recap-roast-btn" onClick={() => { setText(team.roast); setEditing(true); }} aria-label={`Edit the roast for ${team.owner}`}>
              <NavIcon name="pencil" size={12} /> EDIT
            </button>
          )}
        </p>
      )}
      <div className="recap-picks">
        <PickBox pick={team.best} kind="best" />
        <PickBox pick={team.worst} kind="worst" />
      </div>
      <div className="recap-chips">{chips.map((chip) => <span key={chip} className="recap-chip">{chip}</span>)}</div>
      <div className="recap-mini">
        <div><b>{fmt(team.projected)}</b>projected</div>
        <div><b>{fmt(team.ceiling)}</b>ceiling</div>
        <div><b>{fmt(team.floor)}</b>floor</div>
      </div>
    </article>
  );
}

// ─── The headline numbers ────────────────────────────────────────────────────

interface Kpi {
  label: string;
  icon: NavIconName;
  big: string;
  who: string;
  stat: string;
  tone: 'teal' | 'red' | 'yellow' | 'blue' | 'purple';
}

function Kpis({ recap }: { recap: DraftRecap }) {
  const { fastest, slowest, bestKeeper, spotOn } = recap;
  const steal = recap.steals[0] ?? null;
  const reach = recap.reaches[0] ?? null;
  const aged = recap.teams.filter((team) => team.averageAge !== null);
  const oldest = [...aged].sort((a, b) => b.averageAge! - a.averageAge!)[0] ?? null;
  const youngest = [...aged].sort((a, b) => a.averageAge! - b.averageAge!)[0] ?? null;
  const at = (pick: RecapPick) => `${pick.owner} · ${pickPlace(pick)}`;
  const candidates: (Kpi | null | false)[] = [
    steal && { label: 'BIGGEST STEAL', icon: 'star' as const, big: steal.name, who: at(steal), stat: adpGapText(steal), tone: 'teal' as const },
    reach && { label: 'BIGGEST REACH', icon: 'warning' as const, big: reach.name, who: at(reach), stat: adpGapText(reach), tone: 'red' as const },
    spotOn && { label: 'MOST SPOT-ON PICK', icon: 'target' as const, big: spotOn.name, who: at(spotOn), stat: `Taken ${ordinal(spotOn.overall)} overall. ESPN drafts: ${ordinal(Math.round(spotOn.adp ?? 0))}. Projections: ${ordinal(spotOn.valueRank ?? 0)}.`, tone: 'blue' as const },
    bestKeeper && { label: 'BEST KEEPER', icon: 'lock' as const, big: bestKeeper.name, who: at(bestKeeper), stat: `${ordinal(bestKeeper.valueRank ?? 0)} in projected value, kept ${ordinal(bestKeeper.overall)} overall`, tone: 'teal' as const },
    fastest && { label: 'FASTEST DRAFTER', icon: 'bolt' as const, big: fastest.owner, who: '', stat: `${clock(fastest.averageSeconds)} a pick`, tone: 'yellow' as const },
    slowest && { label: 'SLOWEST DRAFTER', icon: 'clock' as const, big: slowest.owner, who: '', stat: `${clock(slowest.averageSeconds)} a pick`, tone: 'yellow' as const },
    oldest && { label: 'OLDEST ROSTER', icon: 'wheelchair' as const, big: oldest.owner, who: 'Average age', stat: `${oldest.averageAge!.toFixed(1)} years`, tone: 'purple' as const },
    youngest && youngest !== oldest && { label: 'YOUNGEST ROSTER', icon: 'sneaker' as const, big: youngest.owner, who: 'Average age', stat: `${youngest.averageAge!.toFixed(1)} years`, tone: 'blue' as const },
  ];
  const kpis = candidates.filter((kpi): kpi is Kpi => Boolean(kpi));
  return (
    <section className="recap-section" aria-label="The draft at a glance">
      <KpiTiles kpis={kpis} />
    </section>
  );
}

function KpiTiles({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="recap-kpis">
      {kpis.map((kpi) => (
        <div key={kpi.label} className={`panel recap-kpi recap-kpi-${kpi.tone}`}>
          <span className="recap-kpi-icon" aria-hidden="true"><NavIcon name={kpi.icon} size={22} /></span>
          <span className="recap-kpi-label">{kpi.label}</span>
          <b className="recap-kpi-big">{kpi.big}</b>
          {kpi.who && <span className="recap-kpi-who">{kpi.who}</span>}
          <span className="recap-kpi-stat">{kpi.stat}</span>
        </div>
      ))}
    </div>
  );
}

const POSITION_ICONS: Record<string, NavIconName> = { PG: 'ball', SG: 'target', SF: 'swap', PF: 'shield', C: 'ruler' };
const POSITION_TONES: Record<string, Kpi['tone']> = { PG: 'yellow', SG: 'blue', SF: 'purple', PF: 'red', C: 'teal' };

function leaderTiles(recap: DraftRecap): Kpi[] {
  const club = recap.clubs[0] ?? null;
  const fewest = recap.clubs[recap.clubs.length - 1] ?? null;
  const stack = recap.biggestStack;
  const tiles: (Kpi | null)[] = [
    club && { label: 'MOST DRAFTED NBA TEAM', icon: 'jersey', big: club.club, who: fewest ? `Fewest: ${fewest.club} with ${fewest.count}` : '', stat: `${club.count} players drafted`, tone: 'blue' },
    stack && { label: 'BIGGEST TEAM STACK', icon: 'layers', big: stack.owner, who: stack.players.join(', '), stat: `${stack.players.length} from ${stack.club}`, tone: 'purple' },
    ...recap.positionLeaders.map((row): Kpi => ({
      label: `MOST ${POSITION_WORDS[row.position].toUpperCase()}`,
      icon: POSITION_ICONS[row.position],
      big: row.owners.join(' & '),
      who: `Players who can play ${row.position}`,
      stat: `${row.count} ${POSITION_WORDS[row.position]}`,
      tone: POSITION_TONES[row.position],
    })),
  ];
  return tiles.filter((tile): tile is Kpi => tile !== null);
}

const POSITION_WORDS: Record<string, string> = {
  PG: 'point guards', SG: 'shooting guards', SF: 'small forwards', PF: 'power forwards', C: 'centers',
};

function Bars({ rows, max, tone }: { rows: { label: string; count: number; note?: string }[]; max: number; tone: string }) {
  return (
    <div className="recap-bars">
      {rows.map((row) => (
        <div key={row.label} className="recap-bar-row" title={`${row.label}: ${row.count}${row.note ? `. ${row.note}` : ''}`}>
          <span className="recap-bar-label">{row.label}</span>
          <span className="recap-bar-track"><span className={`recap-bar recap-bar-${tone}`} style={{ width: `${(row.count / (max || 1)) * 100}%` }} /></span>
          <span className="recap-bar-value">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function Positions({ recap }: { recap: DraftRecap }) {
  const totals = recap.positionTotals;
  const teams = [...recap.teams].sort((a, b) => a.owner.localeCompare(b.owner));
  const mean = (position: (typeof POSITION_ORDER)[number]) => totals[position] / (recap.teams.length || 1);
  const shade = (count: number, average: number) => {
    const t = Math.max(-1, Math.min(1, (count - average) / 3));
    const hue = t >= 0 ? 'var(--neon-teal)' : 'var(--neon-red)';
    return `color-mix(in srgb, ${hue} ${Math.round(Math.abs(t) * 40)}%, var(--cell-bg))`;
  };
  const maxPos = Math.max(...POSITION_ORDER.map((position) => totals[position]));
  const maxClub = recap.clubs[0]?.count ?? 1;
  return (
    <section className="recap-section" aria-labelledby="recap-positions">
      <h2 id="recap-positions" className="hub-heading recap-h2">POSITIONS AND NBA TEAMS</h2>
      <KpiTiles kpis={leaderTiles(recap)} />
      <div className="recap-charts">
        <div className="panel recap-chart">
          <h3 className="recap-pick-label">POSITIONS DRAFTED</h3>
          <p className="recap-chart-note">A player who can play two spots counts at both.</p>
          <Bars rows={POSITION_ORDER.map((position) => ({ label: position, count: totals[position] }))} max={maxPos} tone="teal" />
        </div>
      </div>
      <div className="panel recap-chart">
        <h3 className="recap-pick-label">POSITIONS BY TEAM</h3>
        <p className="recap-chart-note">Teal is more than the league average, red is fewer.</p>
        <div className="recap-mix-wrap">
          <table className="recap-mix">
            <thead>
              <tr><th>TEAM</th>{POSITION_ORDER.map((position) => <th key={position}>{position}</th>)}</tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.owner}>
                  <th>{team.owner}</th>
                  {POSITION_ORDER.map((position) => (
                    <td key={position} style={{ background: shade(team.positions[position], mean(position)) }} title={`${team.owner}: ${team.positions[position]} ${POSITION_WORDS[position]}, league average ${mean(position).toFixed(1)}`}>
                      {team.positions[position]}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="recap-mix-avg">
                <th>Average</th>
                {POSITION_ORDER.map((position) => <td key={position}>{mean(position).toFixed(1)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel recap-chart">
        <h3 className="recap-pick-label">NBA TEAMS DRAFTED</h3>
        <Bars rows={recap.clubs.map((row) => ({ label: row.club, count: row.count }))} max={maxClub} tone="blue" />
      </div>
    </section>
  );
}

function Totals({ recap }: { recap: DraftRecap }) {
  const { headline } = recap;
  const totals: [string, string][] = [
    [headline.lengthMinutes === null ? '–' : `${Math.floor(headline.lengthMinutes / 60)}h ${headline.lengthMinutes % 60}m`, 'draft length'],
    [clock(headline.averageSeconds), 'average pick'],
    [String(headline.keepers), 'keepers'],
    [String(headline.autoPicks), 'auto picks'],
    [String(headline.clockCalls), 'clocks called'],
    [String(headline.tradedPicks), 'picks traded'],
  ];
  return (
    <section className="recap-section" aria-labelledby="recap-totals">
      <h2 id="recap-totals" className="hub-heading recap-h2">THE DRAFT IN NUMBERS</h2>
      <div className="panel recap-totals">
        {totals.map(([value, label]) => (
          <div key={label}><b>{value}</b><span>{label}</span></div>
        ))}
      </div>
    </section>
  );
}

function Makeup({ recap }: { recap: DraftRecap }) {
  // The tiles up top already name the oldest and youngest rosters.
  const rows = recap.makeup.filter((row) => row.label !== 'Oldest roster' && row.label !== 'Youngest roster');
  if (rows.length === 0) return null;
  return (
    <section className="recap-section" aria-labelledby="recap-makeup">
      <h2 id="recap-makeup" className="hub-heading recap-h2">ROSTER MAKEUP</h2>
      <div className="recap-awards">
        {rows.map((row) => (
          <div key={`${row.label}-${row.who}-${row.detail}`} className="recap-award">
            <span className="recap-pick-label">{row.label.toUpperCase()}</span>
            <b>{row.who}</b>
            <span>{row.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PickList({ title, picks, tone }: { title: string; picks: RecapPick[]; tone: string }) {
  return (
    <div className="panel recap-list">
      <h3 className="recap-pick-label">{title}</h3>
      <ol>
        {picks.map((pick) => (
          <li key={pick.overall}>
            <span><strong>{pick.name}</strong> · {pick.owner}, {pickPlace(pick)}</span>
            <span className={`recap-list-gap ${tone}`}>{adpGapText(pick)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StealsAndReaches({ recap }: { recap: DraftRecap }) {
  return (
    <section className="recap-section" aria-labelledby="recap-steals">
      <h2 id="recap-steals" className="hub-heading recap-h2">STEALS AND REACHES</h2>
      <div className="recap-lists">
        <PickList title="BIGGEST STEALS" picks={recap.steals} tone="proj-good" />
        <PickList title="BIGGEST REACHES" picks={recap.reaches} tone="proj-bad" />
      </div>
    </section>
  );
}

// ─── The heat map ────────────────────────────────────────────────────────────

function heat(pick: RecapPick, mode: 'value' | 'age'): string {
  if (mode === 'age') {
    if (pick.age === null) return 'var(--cell-bg)';
    const t = Math.max(-1, Math.min(1, (pick.age - 27) / 9));
    const hue = t >= 0 ? 'var(--neon-purple)' : 'var(--neon-blue)';
    return `color-mix(in srgb, ${hue} ${Math.round(Math.abs(t) * 45)}%, var(--cell-bg))`;
  }
  if (pick.score === null) return 'var(--cell-bg)';
  const t = Math.max(-1, Math.min(1, pick.score / 2.2));
  const hue = t >= 0 ? 'var(--neon-teal)' : 'var(--neon-red)';
  return `color-mix(in srgb, ${hue} ${Math.round(Math.abs(t) * 45)}%, var(--cell-bg))`;
}

function HeatBoard({ recap, teams }: { recap: DraftRecap; teams: { owner: string; draftPosition: number }[] }) {
  const [mode, setMode] = useState<'value' | 'age'>('value');
  const [focus, setFocus] = useState<string | null>(null);
  const [picked, setPicked] = useState<RecapPick | null>(null);
  const columns = [...teams].sort((a, b) => a.draftPosition - b.draftPosition);
  const rounds = Math.max(...recap.picks.map((pick) => pick.round));
  const at = new Map(recap.picks.map((pick) => [`${pick.round}:${pick.column}`, pick]));
  return (
    <section className="recap-section" aria-labelledby="recap-board">
      <h2 id="recap-board" className="hub-heading recap-h2">EVERY PICK, HEAT-MAPPED</h2>
      <div className="recap-board-controls">
        <div className="mock-seg" role="radiogroup" aria-label="Color the board by">
          {(['value', 'age'] as const).map((choice) => (
            <button key={choice} type="button" role="radio" aria-checked={mode === choice} className={`tap-btn mock-seg-btn${mode === choice ? ' is-on' : ''}`} onClick={() => setMode(choice)}>
              {choice === 'value' ? 'PICK VALUE' : 'AGE'}
            </button>
          ))}
        </div>
        <span className="recap-legend">
          {mode === 'value' ? 'Red reached · teal beat the slot' : 'Blue young · purple old'}. Tap a team to light up its picks.
        </span>
      </div>
      <div className="panel recap-board-wrap">
        <div className={`recap-board${focus ? ' is-focus' : ''}`} style={{ gridTemplateColumns: `28px repeat(${columns.length}, minmax(92px, 1fr))` }}>
          <div />
          {columns.map((team) => (
            <button key={team.owner} type="button" className="recap-board-head" aria-pressed={focus === team.owner} onClick={() => setFocus(focus === team.owner ? null : team.owner)}>
              {team.owner}
            </button>
          ))}
          {Array.from({ length: rounds }, (_, index) => index + 1).flatMap((round) => [
            <div key={`r${round}`} className="recap-board-round">{round}</div>,
            ...columns.map((team) => {
              const pick = at.get(`${round}:${team.draftPosition}`);
              if (!pick || !pick.key) return <div key={`${round}-${team.owner}`} className="recap-board-cell is-empty" />;
              const right = mode === 'age' ? (pick.age === null ? '' : `age ${pick.age}`) : SHORT_VERDICT[pick.verdict];
              return (
                <button
                  key={`${round}-${team.owner}`}
                  type="button"
                  className={`recap-board-cell${focus === pick.owner ? ' is-on' : ''}${picked?.overall === pick.overall ? ' is-picked' : ''}`}
                  style={{ background: heat(pick, mode) }}
                  onClick={() => setPicked(pick)}
                  aria-label={`${pick.name}, ${pick.owner}, ${pickPlace(pick)}`}
                >
                  {(pick.keeper || pick.auto) && <span className="recap-board-tag">{pick.keeper ? 'K' : 'A'}</span>}
                  <span className="recap-board-name">{pick.shortName}</span>
                  {pick.owner !== pick.originalOwner && <span className="recap-board-via">to {pick.owner}</span>}
                  <span className="recap-board-meta"><span>{pickPlace(pick)}</span><span>{right}</span></span>
                </button>
              );
            }),
          ])}
        </div>
      </div>
      <div className="panel recap-detail" aria-live="polite">
        {picked ? (
          <>
            <strong>{picked.name}</strong> to {picked.owner}, {pickPlace(picked)}
            {picked.keeper ? ', keeper' : picked.auto ? ', auto pick' : picked.seconds !== null ? `, ${clock(picked.seconds)} on the clock` : ''}
            {picked.clockCalledBy ? `, clock called by ${picked.clockCalledBy}` : ''}.
            <div className="recap-detail-row">
              <span>{picked.positions.join('/')} {picked.proTeam}</span>
              <span>Age {picked.age ?? '–'}{picked.rookie ? ', rookie' : ''}</span>
              <span>{picked.fppg ?? '–'} pts a game</span>
              <span>{picked.games ?? '–'} games</span>
              <span>{picked.valueRank === null ? 'No projection' : `${ordinal(picked.valueRank)} in projected value`}</span>
              <span>{ordinal(picked.overall)} overall</span>
              <span>{picked.adp === null ? 'ESPN drafts rarely take him' : `ESPN drafts take him around ${ordinal(Math.round(picked.adp))}`}</span>
              <span className={scoreClass(picked.score)}>{picked.verdict}: {adpGapText(picked).toLowerCase()}</span>
            </div>
          </>
        ) : 'Tap a pick to see its numbers. 9.7 means round 9, seventh pick. K is a keeper, A an auto pick.'}
      </div>
    </section>
  );
}

// ─── Every pick ──────────────────────────────────────────────────────────────

function PickTable({ recap }: { recap: DraftRecap }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RecapSort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const shown = useMemo(() => recapRows(recap.picks, query, sort), [recap.picks, query, sort]);
  const current = recapPage(shown, page, pageSize);
  const pageAll = current.rows.length > 0 && current.rows.every((pick) => selected.has(pick.overall));
  const exportRows = selected.size > 0 ? shown.filter((pick) => selected.has(pick.overall)) : shown;
  const exportWord = selected.size > 0 ? `${selected.size} ` : '';

  const toggle = (overall: number) => {
    const next = new Set(selected);
    if (next.has(overall)) next.delete(overall); else next.add(overall);
    setSelected(next);
  };
  const togglePage = () => {
    const next = new Set(selected);
    for (const pick of current.rows) if (pageAll) next.delete(pick.overall); else next.add(pick.overall);
    setSelected(next);
  };
  const exportCsv = () => download(new Blob([recapCsv(exportRows)], { type: 'text/csv;charset=utf-8' }), `draft-recap-${recap.season}.csv`);
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      const header = RECAP_COLUMNS.map((column) => ({ value: column.header, fontWeight: 'bold' as const }));
      const body = exportRows.map((pick) => RECAP_COLUMNS.map((column) => {
        const value = column.value(pick);
        return value === null ? null : { value };
      }));
      await writeXlsxFile([header, ...body], { stickyRowsCount: 1 }).toFile(`draft-recap-${recap.season}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="recap-section" aria-labelledby="recap-table">
      <h2 id="recap-table" className="hub-heading recap-h2">EVERY PICK</h2>
      <div className="panel mock-controls proj-controls">
        <div className="proj-search">
          <input
            className="hub-input"
            type="search"
            placeholder="Search across all columns..."
            aria-label="Search picks"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          />
          {query && (
            <button type="button" className="proj-clear" aria-label="Clear search" onClick={() => { setQuery(''); setPage(1); }}>
              <NavIcon name="close" size={14} />
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => setSelected(new Set())}>CLEAR {selected.size} PICKED</button>
        )}
        <div className="proj-export">
          <button type="button" className="tap-btn mock-mini-btn" onClick={exportCsv} disabled={exportRows.length === 0}>
            <span className="proj-export-word">EXPORT {exportWord}</span>CSV
          </button>
          <button type="button" className="tap-btn mock-mini-btn" onClick={() => void exportXlsx()} disabled={exportRows.length === 0 || exporting}>
            {exporting ? 'SAVING…' : <><span className="proj-export-word">EXPORT {exportWord}</span>XLSX</>}
          </button>
        </div>
      </div>
      <div className="panel proj-table-wrap">
        <table className="proj-table recap-table">
          <thead>
            <tr>
              <th className="recap-col-check">
                <input type="checkbox" aria-label="Pick every row on this page" checked={pageAll} onChange={togglePage} />
              </th>
              {RECAP_COLUMNS.map((column) => {
                const dir = sort?.column === column.id ? sort.dir : null;
                return (
                  <th key={column.id} className={`proj-col-${column.id}`} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
                    <button type="button" onClick={() => { setSort(nextRecapSort(sort, column.id)); setPage(1); }}>
                      {column.header.toUpperCase()}
                      <span className={dir ? 'proj-caret is-on' : 'proj-caret'} aria-hidden="true">{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {current.rows.map((pick) => (
              <tr key={pick.overall} className="proj-row recap-row">
                <td className="recap-col-check">
                  <input type="checkbox" aria-label={`Pick ${pick.name}`} checked={selected.has(pick.overall)} onChange={() => toggle(pick.overall)} />
                </td>
                {RECAP_COLUMNS.map((column) => {
                  const value = column.value(pick);
                  const text = column.id === 'score' ? (pick.score === null ? '–' : signed(pick.score))
                    : column.id === 'adpGap' ? (value === null ? '–' : `${Number(value) > 0 ? '+' : ''}${value}`)
                    : column.id === 'seconds' ? clock(pick.seconds)
                    : value === null ? '–' : String(value);
                  const tone = column.id === 'score' || column.id === 'verdict' || column.id === 'adpGap' ? scoreClass(pick.score) : '';
                  return <td key={column.id} className={`proj-col-${column.id}${tone ? ` ${tone}` : ''}`}>{text}</td>;
                })}
              </tr>
            ))}
            {current.rows.length === 0 && (
              <tr><td colSpan={RECAP_COLUMNS.length + 1} className="proj-empty">No picks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="proj-pager">
        <span className="proj-count">{current.total === 0 ? 'No picks' : `${current.from}–${current.to} of ${current.total} picks`}</span>
        <div className="proj-pages">
          <button type="button" className="tap-btn mock-mini-btn" aria-label="First page" disabled={current.page === 1} onClick={() => setPage(1)}>|‹</button>
          <button type="button" className="tap-btn mock-mini-btn" aria-label="Previous page" disabled={current.page === 1} onClick={() => setPage(current.page - 1)}>‹</button>
          <select className="hub-input mock-select" aria-label="Page" value={current.page} onChange={(event) => setPage(Number(event.target.value))}>
            {Array.from({ length: current.pageCount }, (_, index) => (
              <option key={index + 1} value={index + 1}>Page {index + 1} of {current.pageCount}</option>
            ))}
          </select>
          <button type="button" className="tap-btn mock-mini-btn" aria-label="Next page" disabled={current.page === current.pageCount} onClick={() => setPage(current.page + 1)}>›</button>
          <button type="button" className="tap-btn mock-mini-btn" aria-label="Last page" disabled={current.page === current.pageCount} onClick={() => setPage(current.pageCount)}>›|</button>
        </div>
        <div className="mock-seg" role="radiogroup" aria-label="Rows per page">
          {PAGE_SIZES.map((size) => (
            <button key={size} type="button" role="radio" aria-checked={pageSize === size} className={`tap-btn mock-seg-btn${pageSize === size ? ' is-on' : ''}`} onClick={() => { setPageSize(size); setPage(1); }}>
              {size}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

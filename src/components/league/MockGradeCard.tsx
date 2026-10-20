import { gradeSummary, type MockGrade } from '../../lib/league/mockGrade.js';
import { shortName } from '../../lib/league/format.js';

interface Props {
  grade: MockGrade;
  person: string;
  /** Show the full roster and standings, not just the headline. */
  full?: boolean;
  /** Leave off the letter and the one-line summary, when the row above already shows them. */
  headline?: boolean;
  onPlayer?: (playerKey: string) => void;
  /** Tap a team in the standings to see its roster. */
  onTeam?: (owner: string) => void;
}

/** The grade for one finished mock: headline, notes, roster by slot and the room's standings. */
export default function MockGradeCard({ grade, person, full = true, headline = true, onPlayer, onTeam }: Props) {
  return (
    <div className="mock-grade">
      {headline && (
        <div className="mock-grade-head">
          <span className={`mock-grade-letter grade-${grade.grade[0].toLowerCase()}`}>{grade.grade}</span>
          <span className="mock-grade-line">{gradeSummary(grade)}</span>
        </div>
      )}
      <ul className="mock-grade-notes">
        {grade.steal && <li>Best value: <strong>{shortName(grade.steal.name)}</strong> at {grade.steal.label}, {grade.steal.by} picks after his ADP.</li>}
        {grade.reach && <li>Biggest reach: <strong>{shortName(grade.reach.name)}</strong> at {grade.reach.label}, {grade.reach.by} picks before his ADP.</li>}
        {grade.openSlots.length > 0 && <li>No one to start at {grade.openSlots.join(', ')}.</li>}
      </ul>
      {full && (
        <div className="mock-grade-tables">
          <table className="mock-grade-table">
            <thead><tr><th>Slot</th><th>Player</th><th>Pick</th><th className="room-num">FPPG</th><th className="room-num">Total</th></tr></thead>
            <tbody>
              {grade.roster
                .slice()
                .sort((a, b) => (a.slot === 'BE' ? 1 : 0) - (b.slot === 'BE' ? 1 : 0) || a.overall - b.overall)
                .map((pick) => (
                  <tr key={pick.playerKey} className={onPlayer ? 'is-tappable' : ''} onClick={() => onPlayer?.(pick.playerKey)}>
                    <td>{pick.slot === 'BE' ? 'Bench' : pick.slot}</td>
                    <td>{shortName(pick.name)} <small>{pick.positions.join('/')}</small></td>
                    <td>{pick.label}{pick.how === 'keeper' ? ' K' : ''}</td>
                    <td className="room-num">{typeof pick.fppg === 'number' ? pick.fppg.toFixed(1) : '–'}</td>
                    <td className="room-num">{pick.total?.toLocaleString() ?? '–'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <table className="mock-grade-table">
            <thead><tr><th>#</th><th>Team</th><th className="room-num">Points</th></tr></thead>
            <tbody>
              {grade.standings.map((team) => (
                <tr
                  key={team.owner}
                  className={`${team.owner === person ? 'is-mine' : ''}${onTeam ? ' is-tappable' : ''}`}
                  onClick={() => onTeam?.(team.owner)}
                >
                  <td>{team.rank}</td>
                  <td>{onTeam ? <span className="mock-grade-team">{team.owner}</span> : team.owner}</td>
                  <td className="room-num">{team.points.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

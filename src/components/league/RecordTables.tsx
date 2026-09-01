import { rulebook2027 } from '../../lib/league/rulebookData.js';
import { formatHighScoreWhen, rankedHighScores } from '../../lib/league/rulebook.js';

/**
 * Appendix B, rendered from the rulebook's structured records.
 *
 * Shared by /rules (where it is part of the constitution and prints into the
 * PDF) and /league (where it is just something to browse). One source, so the
 * two can never disagree.
 */
export default function RecordTables() {
  const { highScores, champions, formerMembers } = rulebook2027.records;
  const ranked = rankedHighScores(highScores.entries);
  const former = new Set(formerMembers.map((name) => name.split(' ')[0]));

  return (
    <div className="records-block">
      <h3 className="hub-heading records-heading">HIGHEST SCORING WEEKS</h3>
      <p className="records-caption">
        {highScores.criteria}. Raw totals, before any game-limit deduction.
        {!highScores.complete && ' The list is incomplete and is being rebuilt from ESPN.'}
      </p>
      <div className="rules-table-wrap">
        <table className="rules-table records-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Owner</th>
              <th>When</th>
              <th className="records-num">Points</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry) => (
              <tr key={`${entry.owner}-${entry.season}-${entry.week}-${entry.total}`}>
                <td>{entry.rank}</td>
                <td>
                  {entry.owner}
                  {former.has(entry.owner) ? '*' : ''}
                </td>
                <td>{formatHighScoreWhen(entry)}</td>
                <td className="records-num">{entry.total.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="records-caption">* No longer in the league.</p>

      <h3 className="hub-heading records-heading">CHAMPIONS</h3>
      <p className="records-caption">
        {champions.entries.length} seasons of The Nerds.
      </p>
      <div className="rules-table-wrap">
        <table className="rules-table records-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Year</th>
              <th>Champion</th>
              <th>Runner-Up</th>
            </tr>
          </thead>
          <tbody>
            {[...champions.entries]
              .sort((a, b) => b.season - a.season)
              .map((entry) => (
                <tr key={entry.season}>
                  <td>{entry.season}</td>
                  <td>{entry.year}</td>
                  <td>{entry.champion ?? 'Unknown'}</td>
                  <td>{entry.runnerUp ?? 'Unknown'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

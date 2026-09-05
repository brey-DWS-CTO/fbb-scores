import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLeagueHistory } from '../../hooks/useLeague.js';
import {
  formatWhen,
  franchiseIndex,
  memberTotals,
  rankRecords,
  reviewFlags,
  seasonRows,
} from '../../lib/league/history.js';

/**
 * Appendix B, rendered from published league history.
 *
 * Shared by /rules (where it is part of the constitution and prints into the
 * PDF) and /league (where it is just something to browse). One source, so the
 * two can never disagree. The titles table is counted from the season records,
 * not typed, which is what the front matter got wrong.
 */
export default function RecordTables() {
  const { history, published, revision } = useLeagueHistory();

  const franchises = useMemo(() => franchiseIndex(history), [history]);
  const category = history.recordCategories.find((entry) => entry.id === 'weekly-high-score');
  const ranked = useMemo(
    () => rankRecords(history.records, 'weekly-high-score', category?.higherIsBetter ?? true),
    [history.records, category?.higherIsBetter],
  );
  const seasons = useMemo(() => seasonRows(history), [history]);
  const members = useMemo(() => memberTotals(history), [history]);
  const flags = useMemo(() => reviewFlags(history), [history]);

  const formerName = (franchiseId: string | null): boolean =>
    franchiseId !== null && franchises.get(franchiseId)?.active === false;

  return (
    <div className="records-block">
      <h3 className="hub-heading records-heading">HIGHEST SCORING WEEKS</h3>
      <p className="records-caption">
        {category?.criteria ?? 'Weekly high scores'}. {category?.basisNote}
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
              <tr key={entry.id}>
                <td>{entry.rank}</td>
                <td>
                  {entry.ownerName}
                  {formerName(entry.franchiseId) ? '*' : ''}
                </td>
                <td>{formatWhen(entry)}</td>
                <td className="records-num">{entry.value.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="records-caption">* No longer in the league.</p>

      <h3 className="hub-heading records-heading">CHAMPIONS</h3>
      <p className="records-caption">{seasons.length} seasons of The Nerds.</p>
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
            {seasons.map((row) => (
              <tr key={row.season.id}>
                <td>{row.season.seasonNumber}</td>
                <td>{row.season.label}</td>
                <td>{row.champion?.ownerName ?? 'Unknown'}</td>
                <td>{row.runnerUp?.ownerName ?? 'Unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="hub-heading records-heading">TITLES BY MEMBER</h3>
      <p className="records-caption">
        Counted from the seasons above, never typed. That is what keeps this table right. Only the
        top two finishes of each season are on file, so a member who never reached the final shows
        no seasons yet.
      </p>
      <div className="rules-table-wrap">
        <table className="rules-table records-table">
          <thead>
            <tr>
              <th>Member</th>
              <th className="records-num">Titles</th>
              <th className="records-num">Runner-up</th>
              <th className="records-num">Finals</th>
            </tr>
          </thead>
          <tbody>
            {members.map((row) => (
              <tr key={row.franchiseIds.join('+')}>
                <td>
                  {row.currentOwner ?? row.name}
                  {row.inherited ? ' †' : ''}
                </td>
                <td className="records-num">{row.titles}</td>
                <td className="records-num">{row.runnerUps}</td>
                <td className="records-num">{row.titles + row.runnerUps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {members.some((row) => row.inherited) && (
        <p className="records-caption">† Counts more than one franchise after a handover.</p>
      )}

      {/* One line, not a list. The full notes live on the history page, which
          keeps the printed constitution and a phone screen readable. */}
      <p className="records-caption">
        {flags.length > 0 && `${flags.length} notes on how solid this data is. `}
        {published ? `Published history, revision ${revision}.` : 'Committed history seed, not yet published.'}{' '}
        <Link to="/history" className="records-link">
          Open league history
        </Link>
      </p>
    </div>
  );
}

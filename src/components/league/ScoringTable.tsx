import { Link } from 'react-router-dom';
import { rulebook2027, rulebookIndex2027 } from '../../lib/league/rulebookData.js';
import { anchorFor } from '../../lib/league/rulebook.js';

const APPENDIX_A = 'appendix-a';

/**
 * Appendix A, rendered from the rulebook.
 *
 * Shared by /rules (part of the constitution, prints into the PDF) and /league
 * (quick reference). One source, so the two can never drift apart.
 */
export default function ScoringTable() {
  const appendix = rulebook2027.appendices.find((a) => a.id === APPENDIX_A);
  if (!appendix?.table) return null;
  const number = rulebookIndex2027.byId.get(APPENDIX_A)?.number ?? 'Appendix A';

  return (
    <div className="records-block">
      <p className="records-caption">
        The {rulebook2027.season} scoring settings, from {number} of the rule book.
      </p>
      <div className="rules-table-wrap">
        <table className="rules-table records-table">
          <thead>
            <tr>
              {appendix.table.columns.map((column) => (
                <th key={column} className={column === 'Value' ? 'records-num' : undefined}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {appendix.table.rows.map((row) => (
              <tr key={row[0]}>
                <td>{row[0]}</td>
                <td className="records-num">{row[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="records-caption">
        <Link to={`/rules#${anchorFor(APPENDIX_A)}`}>Read it in the rule book →</Link>
      </p>
    </div>
  );
}

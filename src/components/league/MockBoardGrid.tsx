import type { BoardCellView } from '../../lib/league/mockBoard.js';
import { positionTheme } from '../draft/boardUtils.js';

/** A keeper on the board, in the list and in the updates: K, solid when entered, dashed when projected. */
export function KeeperChip({ projected, early }: { projected: boolean; early: string | null }) {
  return (
    <>
      <span
        className={`room-keeper-chip${projected ? ' is-projected' : ''}`}
        title={projected ? 'Projected keeper' : 'Keeper'}
        aria-label={projected ? 'Projected keeper' : 'Keeper'}
      >K</span>
      {early && <span className="keeper-early" title={early} aria-label={early}>↑</span>}
    </>
  );
}

/**
 * The draft board: rounds down, teams across in first-round order, so a snake
 * reads right to left on even rounds. The live room and a saved mock both
 * draw it.
 */
export default function MockBoardGrid({
  owners,
  rounds,
  person,
  projectedTrades,
  onPlayer,
}: {
  owners: readonly string[];
  rounds: readonly (readonly BoardCellView[])[];
  person: string;
  /** Picks that move only if a switched-on pending trade goes through. */
  projectedTrades?: ReadonlySet<number>;
  onPlayer?: (playerKey: string) => void;
}) {
  return (
    <div className="room-grid-wrap">
      <table className="room-grid">
        <thead>
          <tr>
            <th />
            {owners.map((owner) => <th key={owner} className={owner === person ? 'is-mine' : ''}>{owner}</th>)}
          </tr>
        </thead>
        <tbody>
          {rounds.map((row, index) => (
            <tr key={index}>
              <th>R{index + 1}<span className="room-grid-arrow" aria-label={index % 2 === 0 ? 'left to right' : 'right to left'}>{index % 2 === 0 ? '→' : '←'}</span></th>
              {row.map((cell) => {
                const theme = cell.playerName ? positionTheme([...cell.positions]) : null;
                const kept = cell.how === 'keeper';
                const projected = kept && cell.keeperProjected;
                const tradeProjected = projectedTrades?.has(cell.overall) === true;
                return (
                  <td
                    key={cell.overall}
                    className={`${cell.owner === person ? 'is-mine' : ''}${cell.current ? ' is-now' : ''}${kept ? ' is-keeper' : ''}${projected ? ' is-projected' : ''}${cell.via ? ' is-traded' : ''}${cell.playerKey && onPlayer ? ' is-tappable' : ''}`}
                    onClick={() => { if (cell.playerKey) onPlayer?.(cell.playerKey); }}
                    style={theme ? {
                      background: `linear-gradient(155deg, ${theme.background} 0%, ${theme.deepBackground} 100%)`,
                      borderColor: cell.via ? undefined : theme.border,
                      boxShadow: `inset 3px 0 0 ${theme.color}`,
                    } : undefined}
                  >
                    <span className="room-grid-label">
                      {cell.round}.{cell.slot}
                      {cell.via && (
                        <span
                          className={`board-traded-tag${tradeProjected ? ' is-projected' : ''}`}
                          title={tradeProjected
                            ? `${cell.owner} holds ${cell.via}'s pick only if the trade you switched on goes through`
                            : `${cell.owner} holds ${cell.via}'s pick`}
                        >→ {cell.owner.toUpperCase()}</span>
                      )}
                      {kept && <KeeperChip projected={projected} early={cell.keeperEarly} />}
                    </span>
                    {cell.playerName
                      ? <>
                        <span className="room-grid-name">{cell.playerName}</span>
                        <small style={{ color: theme?.color }}>{cell.positions.join('/')}</small>
                      </>
                      : cell.current ? <span className="room-grid-name mock-live">on the clock</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

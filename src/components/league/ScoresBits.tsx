import { dateRangeText, type WeekRef } from '../../lib/league/scores.js';
import NavIcon from './NavIcon.js';

interface WeekPickerProps {
  weeks: readonly WeekRef[];
  /** The week on screen. Null while nothing has loaded. */
  selected: number | null;
  onChange: (matchupPeriodId: number) => void;
}

/** Prev and next arrows around a list of the league's fantasy weeks. */
export function WeekPicker({ weeks, selected, onChange }: WeekPickerProps) {
  const index = weeks.findIndex((week) => week.matchupPeriodId === selected);
  const prev = index > 0 ? weeks[index - 1] : null;
  const next = index >= 0 && index < weeks.length - 1 ? weeks[index + 1] : null;
  return (
    <div className="score-week" role="group" aria-label="Week">
      <button
        type="button"
        className="tap-btn score-arrow"
        aria-label="Previous week"
        disabled={!prev}
        onClick={() => prev && onChange(prev.matchupPeriodId)}
      >
        <NavIcon name="chevrons" size={16} />
      </button>
      <select
        className="hub-input score-week-select"
        aria-label="Fantasy week"
        value={selected ?? ''}
        disabled={weeks.length === 0}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {weeks.length === 0 && <option value="">Week</option>}
        {weeks.map((week) => (
          <option key={week.matchupPeriodId} value={week.matchupPeriodId}>
            {week.label} · {dateRangeText(week.startDate, week.endDate)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="tap-btn score-arrow score-arrow-next"
        aria-label="Next week"
        disabled={!next}
        onClick={() => next && onChange(next.matchupPeriodId)}
      >
        <NavIcon name="chevrons" size={16} />
      </button>
    </div>
  );
}

interface WinBarProps {
  /** The left side's chance, 0 to 100. */
  left: number;
  right: number;
}

/** The thin bar between two teams, split by win chance, with the percents at its ends. */
export function WinBar({ left, right }: WinBarProps) {
  return (
    <div className="score-bar-row" aria-label={`Win chance ${left} percent to ${right} percent`}>
      <span className={`score-pct${left >= right ? ' is-up' : ''}`}>{left}%</span>
      <div className="score-bar" role="presentation">
        <div className="score-bar-left" style={{ width: `${left}%` }} />
      </div>
      <span className={`score-pct score-pct-right${right > left ? ' is-up' : ''}`}>{right}%</span>
    </div>
  );
}

interface NoticeProps {
  children: React.ReactNode;
  onRetry?: () => void;
}

/** One plain sentence in a panel: loading, empty, or ESPN not answering. */
export function ScoresNotice({ children, onRetry }: NoticeProps) {
  return (
    <div className="panel score-notice" role="status">
      <p>{children}</p>
      {onRetry && (
        <button type="button" className="tap-btn mock-mini-btn" onClick={onRetry}>
          TRY AGAIN
        </button>
      )}
    </div>
  );
}

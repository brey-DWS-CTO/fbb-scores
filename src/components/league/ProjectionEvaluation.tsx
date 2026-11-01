import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIdentity } from '../../hooks/useLeague.js';
import { fetchProjectionEvaluation } from '../../lib/league/api.js';
export default function ProjectionEvaluation() {
  const { identity } = useIdentity();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ['projection-evaluation', identity?.owner], queryFn: () => fetchProjectionEvaluation(identity!),
    enabled: open && identity?.isCommissioner === true, staleTime: 60000, retry: false });
  const data = query.data, pair = data?.matchupOnly;
  if (!identity?.isCommissioner) return null;
  return <details className="matchup-tables panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Forecast evaluation <span>Baseline vs matchup model</span></summary>
    {open && <div className="matchup-tables-body">
      {query.isPending && <p role="status">Loading comparison...</p>}
      {query.isError && <p role="alert">Comparison unavailable. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>}
      {data && <>
        <p className="matchup-table-note">{data.status} Captured {data.captured}; matchup-adjusted {data.adjustedCaptures}; scored {pair?.games ?? 0} across {pair?.days ?? 0} days; pending {data.pending}; missing baselines {data.missingBaselines}.</p>
        <p className="matchup-table-note">Last capture: {data.lastCaptureAt ? new Date(data.lastCaptureAt).toLocaleString() : 'none yet'}. Last result: {data.lastResultAt ? new Date(data.lastResultAt).toLocaleString() : 'none yet'}.</p>
        <div className="matchup-table-scroll"><table><caption className="sr-only">Paired prediction errors for matchup-adjusted games; lower MAE and RMSE are better.</caption><thead><tr><th>Model</th><th>MAE</th><th>RMSE</th><th>Bias</th></tr></thead><tbody>
          {(['baseline', 'adjusted'] as const).map(key => <tr key={key}><th scope="row">{key === 'baseline' ? 'Baseline' : 'Matchup'}</th><td>{pair?.[key]?.mae.toFixed(2) ?? '\u2014'}</td><td>{pair?.[key]?.rmse.toFixed(2) ?? '\u2014'}</td><td>{pair?.[key]?.bias.toFixed(2) ?? '\u2014'}</td></tr>)}
        </tbody></table></div>
        <p className="matchup-table-note">Paired MAE improvement: {pair?.maeImprovement?.toFixed(2) ?? '\u2014'} points; positive favors matchup.</p>
        <p className="matchup-table-note">Active-player MAE: baseline {data.activeOnly.baseline?.mae.toFixed(2) ?? '\u2014'} / matchup {data.activeOnly.adjusted?.mae.toFixed(2) ?? '\u2014'}. {data.dnp} explicit DNPs in all scored forecasts. Invalid captures excluded: {data.invalid}.</p>
        <p className="matchup-table-note">Frozen lineup comparisons: {data.lineups.completed}/{data.lineups.captured} completed; mean matchup gain {data.lineups.meanGain?.toFixed(1) ?? '\u2014'} points. Fixed choices from the same lineup/cap, not actual manager behavior.</p>
        <p className="matchup-table-note">League baseline without personal projection edits. Captures run hourly before tip-off after deployment; there is no reconstructed history. Missing results remain pending. MAE = average absolute error; bias above zero means overprediction.</p>
      </>}
    </div>}
  </details>;
}

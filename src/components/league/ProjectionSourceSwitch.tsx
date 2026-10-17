import { useIdentity } from '../../hooks/useLeague.js';
import { setProjectionSource, useProjectionSource } from '../../hooks/useProjectionSource.js';
import { PROJECTION_SOURCES } from '../../lib/league/expertProjections.js';

/**
 * The commissioner's ESPN, Hashtag or Blend switch. One pick drives every
 * screen; this shows it wherever projections are read. Nobody else sees it.
 */
export default function ProjectionSourceSwitch({ caption, onChange }: { caption?: string; onChange?: () => void }) {
  const { identity } = useIdentity();
  const picked = useProjectionSource();
  if (identity?.isCommissioner !== true) return null;
  const buttons = (
    <div className="mock-seg" role="radiogroup" aria-label="Projection source" title="Only you see this. Everyone else uses ESPN.">
      {PROJECTION_SOURCES.map((choice) => (
        <button
          key={choice.id}
          type="button"
          role="radio"
          aria-checked={picked === choice.id}
          className={`tap-btn mock-seg-btn${picked === choice.id ? ' is-on' : ''}`}
          onClick={() => { setProjectionSource(choice.id); onChange?.(); }}
        >
          {choice.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
  if (!caption) return buttons;
  return (
    <div className="proj-source-row">
      <span className="proj-source-caption">{caption}</span>
      {buttons}
    </div>
  );
}

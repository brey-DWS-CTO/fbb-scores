import { useIdentity } from '../../hooks/useLeague.js';

/**
 * A standing reminder that you are in somebody else's seat.
 *
 * It sits above everything and cannot be dismissed. Acting as another owner
 * is easy to forget you did, and forgetting it is how a commissioner saves
 * keepers to the wrong team.
 */
export default function ActingAsBanner() {
  const { identity, stopActingAs } = useIdentity();
  if (!identity?.impersonatedBy) return null;

  return (
    <div className="acting-banner" role="status">
      <span className="acting-banner-text">
        You are acting as <strong>{identity.owner}</strong>. Anything you do is saved as theirs.
      </span>
      <button className="tap-btn acting-banner-stop" type="button" onClick={stopActingAs}>
        BACK TO {identity.impersonatedBy.toUpperCase()}
      </button>
    </div>
  );
}

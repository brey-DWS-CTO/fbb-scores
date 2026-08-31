import { Navigate } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';

/** /keepers — straight to your worksheet; its owner picker links every team. */
export default function KeepersPage() {
  const { identity } = useIdentity();
  if (!identity) return <Navigate to="/" replace />;
  return <Navigate to={`/keepers/${encodeURIComponent(identity.owner)}`} replace />;
}

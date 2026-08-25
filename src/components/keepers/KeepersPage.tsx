import { Navigate } from 'react-router-dom';
import { useIdentity } from '../../hooks/useLeague.js';

export function formatDraftAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * /keepers — straight to YOUR worksheet. Other teams' sheets are commissioner
 * territory (via /admin); everyone else only sees submission status there.
 */
export default function KeepersPage() {
  const { identity } = useIdentity();
  if (!identity) return <Navigate to="/" replace />;
  return <Navigate to={`/keepers/${encodeURIComponent(identity.owner)}`} replace />;
}

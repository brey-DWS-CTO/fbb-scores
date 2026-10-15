import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchSharedMockResult } from '../../lib/league/api.js';
import MockGradeCard from './MockGradeCard.js';
import SavedMockBoard from './SavedMockBoard.js';
import ShareButton from './ShareButton.js';
import NavIcon from './NavIcon.js';

/** What a room is called on screen. The stored name stays `realistic`. */
const roomLabel = (mode: string) => (mode === 'sharp' ? 'sharp' : 'normal');

/**
 * One finished mock draft at its shared link. Anyone with the link can see
 * it, signed in or not: the grade, the roster and the room's standings.
 */
export default function MockResultPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['shared-mock', id],
    queryFn: () => fetchSharedMockResult(id),
    enabled: id !== '',
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const record = query.data;

  return (
    <div className="mock-page mock-shared">
      <div className="mock-head">
        <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
          <NavIcon name="target" size={16} className="icon-in-heading" />
          MOCK DRAFT RESULT
        </h1>
        {record && <ShareButton url={window.location.href} title={`${record.owner}'s mock draft: ${record.grade.grade}`} />}
      </div>
      {query.isPending && <div className="mock-note">Loading…</div>}
      {query.isError && (
        <div className="panel mock-shared-missing">
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>NO SUCH MOCK</div>
          <div className="mock-note">This link does not point at a saved mock. It may have been forgotten.</div>
        </div>
      )}
      {record && (
        <section className="panel room-grade">
          <div className="hub-heading room-head">
            {record.owner.toUpperCase()}
            <small>
              {new Date(record.finishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {roomLabel(record.mode)} room
            </small>
          </div>
          <MockGradeCard grade={record.grade} person={record.owner} />
          <SavedMockBoard board={record.board} person={record.owner} />
        </section>
      )}
      <div className="mock-note" style={{ marginTop: 14 }}>
        <Link to="/mock">Run your own mock draft.</Link>
      </div>
    </div>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiErrorMessage,
  expireSharedMock,
  fetchSharedMock,
  joinSharedMockRoom,
  pickSharedMock,
  quitSharedMockRoom,
  saveSharedMockResults,
  type SharedMockResponse,
} from '../../lib/league/api.js';
import { useDraftData, useIdentity } from '../../hooks/useLeague.js';
import { useProjectionData } from '../../hooks/useProjectionData.js';
import { valueBoard } from '../../lib/league/draftValue.js';
import { replayLive } from '../../lib/league/liveMock.js';
import type { SavedBoard } from '../../lib/league/mockBoard.js';
import { defaultMockSettings, prepareMock, type MockKeeperSets, type MockMode } from '../../lib/league/mockDraft.js';
import { gradeMock, mockResultId, type GradePlayer, type MockGrade } from '../../lib/league/mockGrade.js';
import { buildProjections, type PlayerProjection } from '../../lib/league/projections.js';
import { leagueSchedule2027 } from '../../lib/league/scheduleData.js';
import { clockDeadlineMs, namesOf, othersAt, sharedMockPhase } from '../../lib/league/sharedMock.js';
import DraftRoom, { type RoomProgress, type SharedRoomControls } from './DraftRoom.js';
import IdentityChip from './IdentityChip.js';
import NavIcon from './NavIcon.js';
import ShareButton from './ShareButton.js';
import SignInPanel from './SignInPanel.js';

/** What a room is called on screen. The stored name stays `realistic`. */
const roomLabel = (mode: MockMode) => (mode === 'sharp' ? 'sharp' : 'normal');

/** Your queue for one shared mock, kept on this phone. */
const queueKey = (id: string, owner: string) => `nerds.mock.with.${id}.${owner}`;
function readQueue(id: string, owner: string): string[] {
  try {
    const raw = window.localStorage.getItem(queueKey(id, owner));
    const value: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
  } catch {
    return [];
  }
}

/**
 * A mock draft with a friend, at its link. Before the draft starts it is
 * the invite: join, or wait for the other person. Once it starts it is the
 * draft room, with the server's picks and clock; each phone replays the
 * draft from the frozen board and sends only its own person's picks.
 *
 * Switching who you are starts the page over with that person's seat.
 */
export default function SharedMockPage() {
  const { id = '' } = useParams();
  const { identity } = useIdentity();
  return <SharedMockScreen key={`${id}:${identity?.owner ?? 'anon'}`} id={id} />;
}

function SharedMockScreen({ id }: { id: string }) {
  const { identity } = useIdentity();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const viewer = identity?.owner ?? null;
  const draftData = useDraftData();
  const { dataset } = draftData;
  const { snapshot, original, edits, loading: projectionsLoading } = useProjectionData();

  const queryKey = useMemo(() => ['mock-room', id, viewer ?? 'anon'] as const, [id, viewer]);
  const roomQuery = useQuery({
    queryKey,
    queryFn: () => fetchSharedMock(identity as NonNullable<typeof identity>, id),
    enabled: identity !== null && id !== '',
    // Quick while the draft runs, slower while waiting on a seat, and not at all once it is over.
    refetchInterval: (query) => {
      const room = query.state.data?.room;
      if (!room) return false;
      const phase = sharedMockPhase(room);
      return phase === 'live' ? 3_000 : phase === 'waiting' ? 5_000 : false;
    },
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 1_000,
  });
  const room = roomQuery.data?.room ?? null;
  // The server's clock against this phone's, so a deadline it stamped is drawn right here.
  const serverNow = roomQuery.data?.now;
  const skew = useMemo(() => (serverNow ? Date.parse(serverNow) - Date.now() : 0), [serverNow]);

  const [error, setError] = useState<string | null>(null);
  // Every change goes to the server and the answer becomes the room on screen.
  const apply = useCallback(async (call: () => Promise<SharedMockResponse>): Promise<void> => {
    try {
      const next = await call();
      queryClient.setQueryData(queryKey, next);
      setError(null);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      void queryClient.invalidateQueries({ queryKey });
      throw caught;
    }
  }, [queryClient, queryKey]);

  const values = useMemo(
    () => valueBoard(dataset.players, snapshot, { schedule: leagueSchedule2027, projectionsOnly: true }),
    [dataset.players, snapshot],
  );
  const board = room?.board ?? null;
  // Whose keepers the frozen board carries, for the player list's tags.
  const kept = useMemo((): MockKeeperSets => {
    const keepers: MockKeeperSets['keepers'] = {};
    const status: MockKeeperSets['status'] = {};
    for (const slot of board?.slots ?? []) {
      if (!slot.keeper) continue;
      const owner = slot.pick.currentOwner;
      (keepers[owner] ??= []).push({ playerKey: slot.keeper.playerKey, playerName: slot.keeper.playerName });
      status[owner] = slot.keeper.status;
    }
    return { keepers, status };
  }, [board]);
  const projections = useMemo((): ReadonlyMap<string, PlayerProjection> =>
    new Map(buildProjections(values, snapshot, kept, edits, original).map((row) => [row.key, row])),
  [values, snapshot, kept, edits, original]);
  const owners = useMemo(() => dataset.teams.map((team) => team.owner), [dataset.teams]);
  const mode = room?.mode ?? 'sharp';
  const seed = room?.seed ?? 0;
  const settings = useMemo(() => defaultMockSettings(mode, owners, seed), [mode, owners, seed]);
  const prepared = useMemo(
    () => (board && values.entries.length > 0 ? prepareMock({ board, values, settings }) : null),
    [board, values, settings],
  );

  const queueStart = useMemo(() => (viewer ? readQueue(id, viewer) : []), [id, viewer]);
  const onProgress = useCallback((progress: RoomProgress) => {
    if (!viewer) return;
    try {
      window.localStorage.setItem(queueKey(id, viewer), JSON.stringify(progress.queue));
    } catch {
      /* no storage: the queue just does not survive leaving */
    }
  }, [id, viewer]);

  // The last pick lands: every person's grade, saved to each one's Past
  // mocks from whichever phone gets here first. The same draft saves once.
  const onFinished = useCallback((finished: { choices: Record<number, string>; grade: MockGrade; board: SavedBoard }) => {
    if (!identity || !room || !prepared) return;
    const players = new Map<string, GradePlayer>();
    for (const [key, row] of projections) players.set(key, { name: row.name, positions: row.positions, total: row.total, fppg: row.fppg, adp: row.adp });
    const picks = replayLive(prepared, room.seed, room.people, finished.choices).picks;
    const results = room.people.map((owner) => ({
      owner,
      id: mockResultId(owner, room.seed, room.mode, finished.choices),
      seed: room.seed,
      mode: room.mode,
      grade: owner === identity.owner ? finished.grade : gradeMock(picks, owner, players, prepared.roster),
      board: finished.board,
    }));
    void saveSharedMockResults(identity, room.id, results)
      .then(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mock-results'] }),
        queryClient.invalidateQueries({ queryKey: ['mock-stats'] }),
      ]))
      .catch(() => { /* the grade still shows; it just is not kept */ });
  }, [identity, room, prepared, projections, queryClient]);

  const controls = useMemo((): SharedRoomControls | null => {
    if (!room || !identity) return null;
    return {
      people: room.people,
      clockOverall: room.clock?.overall ?? null,
      deadlineMs: room.clock ? clockDeadlineMs(room.clock) - skew : null,
      onPick: (overall, playerKey) => apply(() => pickSharedMock(identity, room.id, overall, playerKey)),
      onRunOut: (overall, playerKey) => apply(() => expireSharedMock(identity, room.id, overall, playerKey)),
      onQuit: () => { void apply(() => quitSharedMockRoom(identity, room.id)).catch(() => { /* shown above the room */ }); },
    };
  }, [room, identity, skew, apply]);

  if (!viewer || !identity) {
    return <SignInPanel reason="Sign in to join this mock draft." />;
  }

  const others = room ? othersAt(room, viewer) : [];
  const head = (
    <div className="mock-head">
      <h1 className="hub-heading glow-teal" style={{ fontSize: '0.85rem', color: 'var(--neon-teal)', margin: 0, lineHeight: 1.6 }}>
        <NavIcon name="target" size={16} className="icon-in-heading" />
        MOCK WITH {others.length > 0 ? namesOf(others).toUpperCase() : 'A FRIEND'}
      </h1>
      <IdentityChip />
    </div>
  );
  const back = (
    <div className="mock-note" style={{ marginTop: 14 }}>
      <Link to="/mock">Back to the mock draft.</Link>
    </div>
  );

  if (roomQuery.isError) {
    return (
      <div className="mock-page">
        {head}
        <section className="panel mock-shared-missing">
          <div className="hub-heading" style={{ fontSize: '0.72rem', color: 'var(--neon-red)' }}>NOT YOUR MOCK</div>
          <div className="mock-note">{apiErrorMessage(roomQuery.error)}</div>
        </section>
        {back}
      </div>
    );
  }
  if (!room) {
    return (
      <div className="mock-page">
        {head}
        <div className="mock-note">Loading…</div>
      </div>
    );
  }

  const phase = sharedMockPhase(room);
  const link = `${window.location.origin}/mock/with/${room.id}`;
  const leave = (then?: () => void) => {
    void apply(() => quitSharedMockRoom(identity, room.id)).then(() => then?.()).catch(() => { /* shown on the page */ });
  };

  if (phase === 'waiting') {
    const seated = room.joined.includes(viewer);
    const missing = room.people.filter((person) => !room.joined.includes(person));
    return (
      <div className="mock-page">
        {head}
        <section className="panel mock-friend-wait">
          {seated ? (
            <>
              <div className="hub-heading">WAITING FOR {namesOf(missing).toUpperCase()}</div>
              <div className="mock-note">
                Text them the link. The draft starts the moment they join. {roomLabel(room.mode) === 'sharp' ? 'Sharp' : 'Normal'} room, two minutes a pick.
              </div>
              <div className="mock-friend-actions">
                <ShareButton url={link} title={`Mock draft with ${room.host}`} />
                <button type="button" className="tap-btn mock-mini-btn" onClick={() => leave(() => navigate('/mock'))}>CANCEL</button>
              </div>
            </>
          ) : (
            <>
              <div className="hub-heading">{room.host.toUpperCase()} WANTS A MOCK WITH YOU</div>
              <div className="mock-note">
                You each draft your own team against eight computer teams, in the {roomLabel(room.mode)} room. Two minutes a pick,
                and the clock keeps running if one of you walks away. Before the reveal you see each other&apos;s real keepers;
                {' '}{room.host}&apos;s projections cover the other teams.
              </div>
              <div className="mock-friend-actions">
                <button
                  type="button"
                  className="tap-btn mock-mini-btn is-primary"
                  onClick={() => { void apply(() => joinSharedMockRoom(identity, room.id)).catch(() => { /* shown on the page */ }); }}
                >
                  JOIN
                </button>
                <button type="button" className="tap-btn mock-mini-btn" onClick={() => leave(() => navigate('/mock'))}>NO THANKS</button>
              </div>
            </>
          )}
          {error && <div className="mock-note mock-note-bad">{error}</div>}
        </section>
        {back}
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="mock-page">
        {head}
        <section className="panel mock-friend-wait">
          <div className="hub-heading">MOCK OVER</div>
          <div className="mock-note">
            {room.endedBy === viewer
              ? 'You ended this mock.'
              : `${room.endedBy ?? 'Somebody'} ${room.startedAt ? 'left the mock, so it ended for everyone' : 'passed on this mock'}.`}
          </div>
        </section>
        {back}
      </div>
    );
  }

  const loading = draftData.isLoading || draftData.playerPoolQuery.isLoading || projectionsLoading;
  return (
    <div className="mock-page">
      {head}
      {error && <div className="mock-note mock-note-bad">{error}</div>}
      {loading || !prepared || !controls ? (
        <div className="mock-note">Loading the draft…</div>
      ) : (
        <DraftRoom
          key={room.id}
          prepared={prepared}
          values={values}
          projections={projections}
          person={viewer}
          seed={room.seed}
          mode={room.mode}
          saved={{ started: true, choices: room.choices, queue: queueStart, clockLeft: null, finished: phase === 'finished' }}
          onProgress={onProgress}
          onNewDraft={() => { /* a mock with a friend has no next draft here */ }}
          onFinished={onFinished}
          shared={controls}
        />
      )}
    </div>
  );
}

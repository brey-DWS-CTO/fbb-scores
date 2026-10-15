import { useState } from 'react';
import type { SavedBoard } from '../../lib/league/mockBoard.js';
import MockBoardGrid from './MockBoardGrid.js';

/** A finished mock's whole board, folded until asked for. Older mocks kept none. */
export default function SavedMockBoard({ board, person }: { board?: SavedBoard; person: string }) {
  const [open, setOpen] = useState(false);
  if (!board) {
    return <div className="mock-note mock-note-dim">The full board is kept for mocks finished from Oct 14 on.</div>;
  }
  return (
    <div className="saved-mock-board">
      <button type="button" className="tap-btn mock-mini-btn" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? 'HIDE THE BOARD' : 'SEE THE BOARD'}
      </button>
      {open && <MockBoardGrid owners={board.owners} rounds={board.rounds} person={person} />}
    </div>
  );
}

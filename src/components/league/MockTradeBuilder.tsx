import { useState } from 'react';
import type { PickRef } from '../../lib/keeper/types.js';
import { pickRefKey } from '../../lib/league/pickTrades.js';
import type { MockSlot } from '../../lib/league/mockDraft.js';
import { mockTradeProblem, tradablePicks, type MockTrade } from '../../lib/league/mockTrades.js';

interface Props {
  owners: readonly string[];
  viewer: string;
  slots: readonly MockSlot[];
  onAdd: (trade: Omit<MockTrade, 'id'>) => void;
}

/**
 * Build a trade for the mock only: two teams, the picks each gives. It is
 * never sent. Added, it sits with the pending offers as a switch.
 */
export default function MockTradeBuilder({ owners, viewer, slots, onAdd }: Props) {
  const [teamA, setTeamA] = useState(viewer);
  const [teamB, setTeamB] = useState(owners.find((owner) => owner !== viewer) ?? '');
  const [aGives, setAGives] = useState<PickRef[]>([]);
  const [bGives, setBGives] = useState<PickRef[]>([]);
  const problem = mockTradeProblem({ teamA, teamB, aGives, bGives });

  const side = (team: string, setTeam: (team: string) => void, gives: PickRef[], setGives: (refs: PickRef[]) => void) => {
    const picks = tradablePicks(slots, team);
    const has = (ref: PickRef) => gives.some((entry) => pickRefKey(entry) === pickRefKey(ref));
    return (
      <div className="mock-trade-side">
        <select
          className="hub-input mock-select"
          aria-label="Team"
          value={team}
          onChange={(event) => { setTeam(event.target.value); setGives([]); }}
        >
          {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
        </select>
        <small>gives</small>
        <div className="mock-trade-picks">
          {picks.map((pick) => (
            <label key={pickRefKey(pick.ref)} className={has(pick.ref) ? 'is-on' : undefined}>
              <input
                type="checkbox"
                checked={has(pick.ref)}
                onChange={() => setGives(has(pick.ref)
                  ? gives.filter((entry) => pickRefKey(entry) !== pickRefKey(pick.ref))
                  : [...gives, pick.ref])}
              />
              {pick.label}
            </label>
          ))}
          {picks.length === 0 && <span className="mock-live">No picks to trade</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="mock-trade-builder">
      <div className="mock-trade-sides">
        {side(teamA, setTeamA, aGives, setAGives)}
        {side(teamB, setTeamB, bGives, setBGives)}
      </div>
      <div className="mock-trade-add">
        <button
          type="button"
          className="tap-btn mock-mini-btn is-primary"
          disabled={problem !== null}
          onClick={() => {
            onAdd({ teamA, teamB, aGives, bGives });
            setAGives([]);
            setBGives([]);
          }}
        >
          ADD TRADE
        </button>
        {problem && (aGives.length > 0 || bGives.length > 0 || teamA === teamB) && <small className="mock-note-bad">{problem}</small>}
      </div>
    </div>
  );
}

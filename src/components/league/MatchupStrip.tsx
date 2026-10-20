import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { ScoresWeek } from '../../lib/league/scores.js';
import FantasyTeamLogo from './FantasyTeamLogo.js';
import { scoresQuery } from './scoresUi.js';

export default function MatchupStrip({ week, selected, demo, day }: { week: ScoresWeek; selected: number; demo: boolean; day: string | null }) {
  const strip = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [selected]);
  return (
    <nav className="matchup-strip" aria-label="Other matchups">
      <button type="button" className="tap-btn matchup-strip-arrow" aria-label="Scroll matchups left" onClick={() => strip.current?.scrollBy({ left: -240, behavior: 'smooth' })}>‹</button>
      <div className="matchup-strip-track" ref={strip}>
        {week.matchups.map((matchup) => (
          <Link key={matchup.id} ref={matchup.id === selected ? active : undefined} className={`matchup-strip-card${matchup.id === selected ? ' is-selected' : ''}`} aria-current={matchup.id === selected ? 'page' : undefined} aria-label={`${matchup.home.name} versus ${matchup.away.name}`} to={`/scores/${matchup.id}${scoresQuery({ week: week.matchupPeriodId, demo, day })}`}>
            {[matchup.home, matchup.away].map((side) => (
              <span className="matchup-strip-side" key={side.teamId}><FantasyTeamLogo side={side} size={19} /><span>{side.abbrev || side.name}</span><b>{side.total.toFixed(1)}</b></span>
            ))}
          </Link>
        ))}
      </div>
      <button type="button" className="tap-btn matchup-strip-arrow" aria-label="Scroll matchups right" onClick={() => strip.current?.scrollBy({ left: 240, behavior: 'smooth' })}>›</button>
    </nav>
  );
}

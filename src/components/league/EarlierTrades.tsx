import { useLeagueData } from '../../hooks/useLeague.js';

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * Trades the league made before this app existed.
 *
 * These came out of ESPN during the 2025-26 season and moved 2027 picks, so
 * they explain why a pick sits under a team that did not start with it. They
 * are part of the committed dataset and can never be edited here, which is why
 * they render as a plain record rather than as cards with actions.
 *
 * Unlike an in-app trade, these moved players as well as picks, so each side
 * lists everything it received.
 */
export default function EarlierTrades() {
  const { dataset } = useLeagueData();
  const trades = dataset?.tradeDetails ?? [];
  if (trades.length === 0) return null;

  const newestFirst = [...trades].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <section className="earlier-trades">
      <h2 className="hub-heading earlier-heading">BEFORE THE APP</h2>
      <p className="earlier-caption">
        {newestFirst.length} trades made in ESPN last season that moved {dataset?.season} picks.
        These are the league record and cannot be changed here.
      </p>
      {newestFirst.map((trade) => (
        <article key={`${trade.date}-${trade.teams.join('-')}`} className="panel earlier-card">
          <div className="earlier-head">
            <span className="hub-heading earlier-teams">
              {trade.teams[0]} <span className="earlier-swap">⇄</span> {trade.teams[1]}
            </span>
            <span className="earlier-date">{formatDate(trade.date)}</span>
          </div>
          <div className="earlier-sides">
            {trade.teams.map((team) => (
              <div key={team} className="earlier-side">
                <span className="earlier-got">{team} got</span>
                <ul className="earlier-list">
                  {(trade.received[team] ?? []).map((item) => (
                    <li key={item} className={/pick/i.test(item) ? 'earlier-pick' : undefined}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

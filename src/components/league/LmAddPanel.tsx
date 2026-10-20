import { shortName } from '../../lib/league/format.js';
import { useCallback, useEffect, useState } from 'react';
import PlayerCombobox from './PlayerCombobox.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import {
  apiErrorMessage,
  denyLmAdd,
  fetchLmWeekend,
  lmAddChecksOf,
  requestLmAdd,
  retryLmAdd,
  type LmWeekendResponse,
} from '../../lib/league/api.js';
import { hourLabel, lmAddText, type LmAddCheck, type LmAddRequest } from '../../lib/league/lmWeekend.js';
import type { DatasetPlayer } from '../../lib/keeper/types.js';

/** "12:00 PM" in Pacific, the league's clock. */
const tipLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

/** "Sat, Oct 24" for a Pacific date. */
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

/** "9:12 AM" in the viewer's clock. */
const whenLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const STATUS_LABEL: Record<LmAddRequest['status'], string> = {
  requested: 'REQUESTED',
  'waiting-for-drop': 'WAITING',
  added: 'ADDED',
  failsafe: 'FAILSAFE',
  denied: 'DENIED',
};

/** How often the panel asks again while open. */
const REFRESH_MS = 60_000;

/** The weekend LM rules on the ACTIVITY page: waiver hour, early days, LM add requests. */
export default function LmAddPanel() {
  const { dataset } = useLeagueData();
  const { identity } = useIdentity();
  const [data, setData] = useState<LmWeekendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<LmAddCheck[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchLmWeekend()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((e) => setError(apiErrorMessage(e)));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const ask = async (player: DatasetPlayer) => {
    if (!identity || !player.espnId) return;
    if (!window.confirm(`Ask for ${shortName(player.name)} to be LM added to your team? Drop someone in ESPN first if your roster is full.`)) return;
    setBusy(true);
    setFailed([]);
    setNotice(null);
    try {
      const result = await requestLmAdd(identity, player.espnId);
      setNotice(lmAddText(result.request));
      setAsking(false);
      load();
    } catch (e) {
      const checks = lmAddChecksOf(e).filter((check) => !check.ok);
      setFailed(checks);
      if (checks.length === 0) setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (run: () => Promise<LmAddRequest>) => {
    setBusy(true);
    try {
      const request = await run();
      setNotice(lmAddText(request));
      load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data && !error) return null;

  const isCommish = identity?.isCommissioner === true;
  const today = data?.today;
  const candidates = dataset.players.filter((player) => player.espnId !== null);

  return (
    <section className="panel lm-panel">
      <div className="hub-heading lm-title">WAIVERS AND LM ADDS</div>
      {error && <p className="rules-draft-error">{error}</p>}
      {data?.espnWriteTrouble && <p className="rules-draft-error">ESPN sign-in expired: {data.espnWriteTrouble}</p>}
      {data?.dryRun && <p className="rules-draft-note">Dry run is on. The app logs what it would send to ESPN and sends nothing.</p>}

      {today && (
        <p className="lm-today">
          Waivers run at <strong>{hourLabel(today.waiver.hourPT)}</strong> today
          {today.waiver.early && today.waiver.firstTip ? ` (first tip ${tipLabel(today.waiver.firstTip)})` : ''}.
          {today.games === 0 ? ' No NBA games today.' : ''}
        </p>
      )}

      {data && data.earlyDays.length > 0 && (
        <ul className="lm-early">
          {data.earlyDays.map((day) => (
            <li key={day.date}>
              <span>{dayLabel(day.date)}</span>
              <span>waivers at {hourLabel(day.hourPT)}, first tip {tipLabel(day.firstTip)}</span>
            </li>
          ))}
        </ul>
      )}

      {today && (
        today.window.open ? (
          identity ? (
            asking ? (
              <div className="lm-form">
                <PlayerCombobox players={candidates} placeholder="Who do you want added?" onSelect={(player) => { void ask(player); }} autoFocus />
                <button type="button" className="activity-chip" onClick={() => setAsking(false)} disabled={busy}>CANCEL</button>
              </div>
            ) : (
              <button type="button" className="lm-ask" onClick={() => setAsking(true)} disabled={busy}>
                REQUEST LM ADD
              </button>
            )
          ) : (
            <p className="rules-draft-note">Sign in to request an LM add. Open until the first tip at {today.window.closesAt ? tipLabel(today.window.closesAt) : 'tip-off'}.</p>
          )
        ) : (
          <p className="rules-draft-note">{today.window.reason}</p>
        )
      )}

      {failed.length > 0 && (
        <ul className="lm-checks">
          {failed.map((check) => (
            <li key={check.rule}>
              <strong>{check.text}.</strong> {check.detail}
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="rules-draft-note">{notice}</p>}

      {data && data.requests.length > 0 && (
        <ol className="league-activity lm-requests">
          {data.requests.map((request) => (
            <li key={request.id}>
              <div className="league-activity-head">
                <span className={`activity-kind lm-status is-${request.status}`}>{STATUS_LABEL[request.status]}</span>
                <strong>{lmAddText(request)}</strong>
                <span>{dayLabel(request.forDate)}, {whenLabel(request.requestedAt)}</span>
              </div>
              {request.note && <div className="league-activity-line">{request.note}</div>}
              {isCommish && identity && request.status !== 'added' && request.status !== 'denied' && (
                <div className="lm-actions">
                  <button type="button" className="activity-chip" disabled={busy} onClick={() => { void act(() => retryLmAdd(identity, request.id)); }}>SEND TO ESPN AGAIN</button>
                  <button
                    type="button"
                    className="activity-chip"
                    disabled={busy}
                    onClick={() => {
                      const note = window.prompt('Why? One line for the feed.', '');
                      if (note === null) return;
                      void act(() => denyLmAdd(identity, request.id, note));
                    }}
                  >
                    DENY
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="lm-rule">
        Saturdays and Sundays only, before the first tip. Drop first in ESPN if your roster is full; the app never drops. Post the add in the group chat too, the rule still asks for it.
      </p>
    </section>
  );
}

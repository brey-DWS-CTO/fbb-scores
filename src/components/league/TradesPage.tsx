import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import IdentityChip from './IdentityChip.js';
import SignInPanel from './SignInPanel.js';
import NavIcon from './NavIcon.js';
import EarlierTrades from './EarlierTrades.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { OWNERS } from '../../lib/league/data.js';
import {
  acceptPickTrade,
  apiErrorMessage,
  cancelPickTrade,
  deleteMockTrade,
  fetchMockTrades,
  saveMockTrade,
  fetchPickTrades,
  previewPickTrade,
  rejectPickTrade,
  revisePickTrade,
  sendPickTrade,
  type PickTradesResponse,
} from '../../lib/league/api.js';
import {
  assetOrigin,
  exactPickLabel,
  draftYearLabel,
  exactPickTitle,
  groupPicksByOrigin,
  keeperResetWarning,
  MAX_PICKS_PER_SIDE,
  MAX_TRADE_NOTE,
  ordinal,
  pickRefKey,
  sameRef,
  STATUS_LABEL,
  tradableSeasonPicksFor,
  tradeableSeason,
  tradeWindow,
  tradeWindowLine,
  tradeSidesFor,
  type DraftOrder,
  type KeeperResetWarning,
  type PickRef,
  type PickTradeProposal,
  type TradableSeasonPick,
  type TradeAsset,
  type TradePreview,
} from '../../lib/league/pickTrades.js';
import { mockTradeProposal, type MockTrade } from '../../lib/league/mockTrades.js';

/** Open offers either way, your mock trades, and everything that is over. */
type Tab = 'active' | 'mock' | 'done';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/* ------------------------------------------------------------------ */
/* Pick selector                                                       */
/* ------------------------------------------------------------------ */

function PickPicker({
  heading,
  picks,
  chosen,
  onToggle,
}: {
  heading: string;
  picks: TradableSeasonPick[];
  chosen: PickRef[];
  onToggle: (ref: PickRef) => void;
}) {
  const groups = useMemo(() => groupPicksByOrigin(picks), [picks]);
  if (picks.length === 0) {
    return (
      <div className="trade-picker">
        <span className="hub-heading trade-picker-head">{heading}</span>
        <p className="trade-empty">No picks left to trade.</p>
      </div>
    );
  }
  return (
    <div className="trade-picker">
      <span className="hub-heading trade-picker-head">{heading}</span>
      {groups.map((group) => (
        <div key={group.originalOwner} className="trade-group">
          <span className="trade-group-head">{group.originalOwner}&apos;s picks</span>
          <div className="trade-chips">
            {group.picks.map((entry) => {
              const on = chosen.some((ref) => sameRef(ref, entry.ref));
              return (
                <button
                  key={pickRefKey(entry.ref)}
                  type="button"
                  className={on ? 'trade-chip trade-chip-on tap-btn' : 'trade-chip tap-btn'}
                  disabled={!entry.tradable}
                  aria-pressed={on}
                  onClick={() => onToggle(entry.ref)}
                >
                  {/* A pick on the board reads "R1 · 1.9". Next year's draft
                      has no order yet, so its label already says the round and
                      the year and repeating it would be silly. */}
                  {entry.slot === null ? entry.label : <>R{entry.ref.round}<span className="trade-chip-slot"> · {entry.label}</span></>}
                  {entry.onClock && <span className="trade-chip-note"> ON THE CLOCK</span>}
                  {entry.blockedBy === 'drafted' && <span className="trade-chip-note"> USED</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The keeper reset warning                                            */
/* ------------------------------------------------------------------ */

/**
 * Shown when a trade would move a pick the reader's own keeper is paying for.
 *
 * It names the reader's picks and the reader's players, never the other
 * side's. A blocked pick, or a warning about somebody else's keeper, would
 * tell the other side which tier a hidden keeper sits on.
 */
function KeeperResetDialog({
  warning,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  warning: KeeperResetWarning;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="keeper-reset-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="panel keeper-reset"
        role="alertdialog"
        aria-modal="true"
        aria-label="Your keepers will reset"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="hub-heading glow-red">YOUR KEEPERS WILL RESET</span>
        {warning.lines.map((line) => (
          <p key={line} className="keeper-reset-line">
            {line}
          </p>
        ))}
        <p className="keeper-reset-note">Pick them again before the keeper deadline.</p>
        <div className="keeper-reset-actions">
          <button
            type="button"
            className="trade-btn trade-btn-yes tap-btn"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="trade-btn trade-btn-no tap-btn" onClick={onCancel}>
            GO BACK
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One row per pick                                                    */
/* ------------------------------------------------------------------ */

/**
 * A round number on its own is ambiguous: a pick's identity is its round plus
 * the team it came from. So the title carries the exact pick, 1.9, the same
 * number the draft board and the picker chips use, and the line under it says
 * which team the pick started with. Two first rounders in one trade stay
 * apart.
 *
 * The badge keeps the round and the season. A trade has two sides and the
 * heading already names them, so a "from Kyle" line under every row would only
 * repeat what the column and the card header said. Direction is carried by the
 * heading and the colour down the edge.
 */
function AssetRow({
  asset,
  order,
  season,
}: {
  asset: TradeAsset;
  order: DraftOrder;
  season: number;
}) {
  return (
    <li className="trade-asset">
      <span className="trade-asset-badge" aria-hidden="true">
        <span className="trade-asset-round">{ordinal(asset.ref.round)}</span>
        <span className="trade-asset-year">{season}</span>
      </span>
      <span className="trade-asset-text">
        <strong className="trade-asset-title">{exactPickTitle(order, asset.ref)}</strong>
        <span className="trade-asset-origin">{assetOrigin(asset)}</span>
      </span>
    </li>
  );
}

function TradeColumn({
  heading,
  assets,
  order,
  season,
  incoming,
}: {
  heading: string;
  assets: TradeAsset[];
  order: DraftOrder;
  season: number;
  incoming: boolean;
}) {
  return (
    <div className={incoming ? 'trade-side trade-side-in' : 'trade-side trade-side-out'}>
      <span className="trade-side-head">{heading}</span>
      {assets.length === 0 ? (
        <p className="trade-side-empty">Picks hidden</p>
      ) : (
        <ul className="trade-assets">
          {assets.map((asset) => (
            <AssetRow
              key={pickRefKey(asset.ref)}
              asset={asset}
              order={order}
              season={season}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Both columns, always from the reader's seat. Set `named` when the reader is
 * not the member looking at the screen, so the headings say whose seat it is.
 */
function TradeSummary({
  proposal,
  reader,
  order,
  season,
  named = false,
}: {
  proposal: Pick<PickTradeProposal, 'proposer' | 'recipient' | 'offer' | 'request'>;
  reader: string;
  order: DraftOrder;
  season: number;
  named?: boolean;
}) {
  const sides = tradeSidesFor(proposal, reader);
  return (
    <div className="trade-sides">
      <TradeColumn
        heading={named ? `${reader} receives` : 'Receives'}
        assets={sides.receives}
        order={order}
        season={season}
        incoming
      />
      <TradeColumn
        heading={named ? `${reader} sends` : 'Sends'}
        assets={sides.sends}
        order={order}
        season={season}
        incoming={false}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Two-sided review                                                    */
/* ------------------------------------------------------------------ */

function ReviewPanel({
  preview,
  give,
  get,
  giver,
  taker,
  reader,
  order,
  season,
}: {
  preview: TradePreview;
  give: PickRef[];
  get: PickRef[];
  giver: string;
  taker: string;
  reader: string;
  order: DraftOrder;
  season: number;
}) {
  return (
    <div className="trade-review">
      <TradeSummary
        proposal={{ proposer: giver, recipient: taker, offer: give, request: get }}
        reader={reader}
        order={order}
        season={season}
      />

      {!preview.check.ok && <p className="trade-block">{preview.check.message}</p>}

      <div className="trade-keepers">
        <span className="hub-heading trade-picker-head">
          {preview.keepersLocked ? 'KEEPERS ARE LOCKED' : 'KEEPER PICK COSTS'}
        </span>
        {preview.sides.map((side) => (
          <div key={side.owner} className={side.worksAfter ? 'trade-keeper-side' : 'trade-keeper-side trade-keeper-bad'}>
            <p className="trade-keeper-summary">{side.summary}</p>
            {side.changes.map((change) => (
              <p key={change.playerKey} className="trade-keeper-change">
                {change.playerName}: pick {change.beforePick ?? 'none'} → {change.afterPick ?? 'none'}
                {change.afterBump === 'traded' && ' (you traded that round away)'}
                {change.afterBump === 'duplicate' && ' (same tier as your other keeper)'}
              </p>
            ))}
            {!side.detailed && side.keeperCount > 0 && (
              <p className="trade-keeper-hidden">
                Keeper names stay hidden until the commish reveals them.
              </p>
            )}
          </div>
        ))}
      </div>

      {preview.provenance.some((entry) => entry.steps.length > 0) && (
        <div className="trade-history">
          <span className="hub-heading trade-picker-head">WHERE THESE PICKS HAVE BEEN</span>
          {preview.provenance
            .filter((entry) => entry.steps.length > 0)
            .map((entry) => (
              <p key={pickRefKey(entry.ref)} className="trade-history-line">
                <strong>Pick {exactPickLabel(order, entry.ref)}</strong>{' '}
                {[entry.ref.originalOwner, ...entry.steps.map((s) => s.to)].join(' → ')}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One offer                                                           */
/* ------------------------------------------------------------------ */

function TradeCard({
  proposal,
  owner,
  order,
  isCommish,
  busy,
  resetWarning,
  onAccept,
  onReject,
  onCancel,
  onEdit,
}: {
  proposal: PickTradeProposal;
  owner: string;
  order: DraftOrder;
  isCommish: boolean;
  busy: boolean;
  /** Set when accepting would clear this reader's own keepers. */
  resetWarning: KeeperResetWarning | null;
  onAccept: (p: PickTradeProposal) => void;
  onReject: (p: PickTradeProposal) => void;
  onCancel: (p: PickTradeProposal) => void;
  onEdit: (p: PickTradeProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [warning, setWarning] = useState(false);
  const { identity } = useIdentity();

  const pending = proposal.status === 'pending';
  const mine = proposal.proposer === owner;
  const theirs = proposal.recipient === owner;
  // A settled trade is league news, so someone outside it can be reading. Show
  // that trade from the proposer's seat and say whose seat it is.
  const inIt = mine || theirs;
  const reader = inIt ? owner : proposal.proposer;

  // Rechecked on the server at accept time; this is just what the member reads.
  useEffect(() => {
    if (!open || !identity || preview) return;
    let cancelled = false;
    previewPickTrade(identity, { id: proposal.id })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((e) => {
        if (!cancelled) setPreviewError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, identity, preview, proposal.id]);

  return (
    <article className={`panel trade-card trade-${proposal.status}`}>
      <div className="trade-head">
        <span className="hub-heading trade-status">{STATUS_LABEL[proposal.status]}</span>
        <span className="trade-meta">
          {mine ? `to ${proposal.recipient}` : `from ${proposal.proposer}`} · {formatDay(proposal.createdAt)}
          {proposal.revisedAt ? ` · changed ${formatDay(proposal.revisedAt)}` : ''}
        </span>
      </div>

      <TradeSummary
        proposal={proposal}
        reader={reader}
        order={order}
        season={proposal.season}
        named={!inIt}
      />
      {proposal.note && <p className="trade-note">&ldquo;{proposal.note}&rdquo;</p>}
      {proposal.reason && <p className="trade-reason">{proposal.reason}</p>}
      {proposal.status === 'accepted' && proposal.resolvedAt && (
        <p className="trade-reason">
          {proposal.resolvedBy} accepted it on {formatDay(proposal.resolvedAt)}.
        </p>
      )}
      {pending && (
        <p className="trade-reason">Runs out {formatDay(proposal.expiresAt)}.</p>
      )}

      {pending && (mine || theirs) && (
        <button type="button" className="rules-tool trade-open tap-btn" onClick={() => setOpen(!open)}>
          {open ? 'HIDE THE DETAIL' : 'REVIEW THIS TRADE'}
        </button>
      )}

      {open && previewError && <p className="trade-block">{previewError}</p>}
      {open && preview && (
        <ReviewPanel
          preview={preview}
          give={proposal.offer}
          get={proposal.request}
          giver={proposal.proposer}
          taker={proposal.recipient}
          reader={reader}
          order={order}
          season={proposal.season}
        />
      )}

      {pending && theirs && (
        <div className="trade-actions">
          <button
            type="button"
            className="trade-btn trade-btn-yes tap-btn"
            disabled={busy}
            onClick={() => {
              // A trade that clears your keepers gets the warning instead of
              // the second tap. Every other trade keeps the plain two taps.
              if (resetWarning) setWarning(true);
              else if (confirming) onAccept(proposal);
              else setConfirming(true);
            }}
          >
            {confirming && !resetWarning ? 'TAP AGAIN TO TRADE' : 'ACCEPT THIS TRADE'}
          </button>
          <button
            type="button"
            className="trade-btn trade-btn-no tap-btn"
            disabled={busy}
            onClick={() => onReject(proposal)}
          >
            TURN IT DOWN
          </button>
        </div>
      )}
      {confirming && !resetWarning && pending && theirs && (
        <p className="trade-reason">The picks move as soon as you tap again.</p>
      )}
      {warning && resetWarning && (
        <KeeperResetDialog
          warning={resetWarning}
          confirmLabel="ACCEPT AND RESET"
          busy={busy}
          onConfirm={() => {
            setWarning(false);
            onAccept(proposal);
          }}
          onCancel={() => setWarning(false)}
        />
      )}

      {pending && (mine || isCommish) && (
        <div className="trade-actions trade-actions-thin">
          {mine && (
            <button type="button" className="trade-pull tap-btn" disabled={busy} onClick={() => onEdit(proposal)}>
              CHANGE AND RESEND
            </button>
          )}
          <button
            type="button"
            className="trade-pull tap-btn"
            disabled={busy}
            onClick={() => onCancel(proposal)}
          >
            {mine ? 'PULL THIS OFFER' : 'CLEAR THIS STUCK OFFER'}
          </button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/** /trades — swap draft picks with one other member. */
export default function TradesPage() {
  const { identity } = useIdentity();
  const { state, dataset, refetch } = useLeagueData();
  const [data, setData] = useState<PickTradesResponse | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Teams page sends you here with somebody already in mind. Opening the
  // composer on the right person saves the one step everybody would repeat.
  const [searchParams, setSearchParams] = useSearchParams();
  const asked = searchParams.get('with') ?? '';
  // Only open on a real owner who is not you, so a hand-typed or stale link
  // cannot land somebody in a trade with themselves.
  const askedFor = OWNERS.includes(asked) && asked !== identity?.owner ? asked : '';

  const [composing, setComposing] = useState(askedFor !== '');
  const [partner, setPartner] = useState(askedFor);

  // Spend the parameter once. Leaving it in the address bar would reopen the
  // composer on every back and refresh, long after the offer went out.
  useEffect(() => {
    if (!searchParams.has('with')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('with');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [give, setGive] = useState<PickRef[]>([]);
  const [get, setGet] = useState<PickRef[]>([]);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [sendWarning, setSendWarning] = useState<KeeperResetWarning | null>(null);
  // The offer being changed, when the composer is open on one already sent.
  const [editing, setEditing] = useState<PickTradeProposal | null>(null);
  // The mock trade being sent for real, when the composer is open on one.
  const [fromMock, setFromMock] = useState<MockTrade | null>(null);
  const [mocks, setMocks] = useState<MockTrade[]>([]);

  const owner = identity?.owner ?? '';

  const load = useCallback(async () => {
    if (!identity) return;
    try {
      const [trades, mine] = await Promise.all([fetchPickTrades(identity), fetchMockTrades(identity)]);
      setMocks(mine);
      setData(trades);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  // Exactly one draft is open for trading at a time, and which one flips when
  // the commissioner closes the draft. The picker has to follow it or it
  // offers picks every proposal will be refused for.
  const openSeason = tradeableSeason(state, dataset);
  const windowNow = tradeWindow(state);

  const myPicks = useMemo(
    () => (owner ? tradableSeasonPicksFor(dataset, state, owner, openSeason) : []),
    [dataset, state, owner, openSeason],
  );
  const theirPicks = useMemo(
    () => (partner ? tradableSeasonPicksFor(dataset, state, partner, openSeason) : []),
    [dataset, state, partner, openSeason],
  );

  if (!identity) {
    return (
      <main className="rules-page">
        <SignInPanel reason="Sign in to trade draft picks." />
      </main>
    );
  }

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
      await refetch();
    } catch (e) {
      setError(apiErrorMessage(e));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = (list: PickRef[], set: (next: PickRef[]) => void) => (ref: PickRef) => {
    setPreview(null);
    const on = list.some((entry) => sameRef(entry, ref));
    if (on) set(list.filter((entry) => !sameRef(entry, ref)));
    else if (list.length < MAX_PICKS_PER_SIDE) set([...list, ref]);
  };

  const resetComposer = () => {
    setComposing(false);
    setPartner('');
    setGive([]);
    setGet([]);
    setNote('');
    setPreview(null);
    setSendWarning(null);
    setEditing(null);
    setFromMock(null);
  };

  // Open the composer on a mock trade, to review it and send it for real.
  const startFromMock = (trade: MockTrade) => {
    resetComposer();
    setFromMock(trade);
    setComposing(true);
    setPartner(trade.recipient);
    setGive(trade.offer);
    setGet(trade.request);
    setNote(trade.note);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Keep the trade for yourself: nothing is sent, nobody is mailed.
  const keepAsMock = () =>
    act(async () => {
      await saveMockTrade(identity, { recipient: partner, offer: give, request: get, note });
      resetComposer();
      setTab('mock');
    });

  // Open the composer on an offer already sent, picks and message filled in.
  const startEdit = (proposal: PickTradeProposal) => {
    setEditing(proposal);
    setComposing(true);
    setPartner(proposal.recipient);
    setGive(proposal.offer);
    setGet(proposal.request);
    setNote(proposal.note);
    setPreview(null);
    setSendWarning(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const review = () =>
    act(async () => {
      setPreview(await previewPickTrade(identity, { recipient: partner, offer: give, request: get }));
    });

  const send = () =>
    act(async () => {
      if (editing) {
        await revisePickTrade(identity, editing.id, { version: editing.version, offer: give, request: get, note });
      } else {
        await sendPickTrade(identity, { recipient: partner, offer: give, request: get, note });
        // Sent for real: the mock it came from has done its job.
        if (fromMock) await deleteMockTrade(identity, fromMock.id);
      }
      resetComposer();
      setTab('active');
    });

  // Only the sender's own picks and own keepers. Warning about the other
  // side's would say which tier their hidden keeper is on.
  const askBeforeSending = () => {
    const warn = keeperResetWarning(dataset, state, owner, give, 'send');
    if (warn) setSendWarning(warn);
    else void send();
  };

  const proposals = data?.proposals ?? [];
  const inbox = proposals.filter((p) => p.status === 'pending' && p.recipient === owner);
  const sent = proposals.filter((p) => p.status === 'pending' && p.proposer === owner);
  // A commissioner also sees pending offers between two other members, stripped
  // of their picks, so they can clear one that is stuck.
  const stuck = proposals.filter(
    (p) => p.status === 'pending' && p.proposer !== owner && p.recipient !== owner,
  );
  const done = proposals.filter((p) => p.status !== 'pending');
  // Offers waiting on you first, then yours waiting on them.
  const active = [...inbox, ...sent, ...stuck];
  const shown = tab === 'active' ? active : tab === 'done' ? done : [];
  const ready = partner !== '' && give.length > 0 && get.length > 0;

  return (
    <main className="rules-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-yellow">
            <NavIcon name="swap" size={18} className="icon-in-heading" />
            PICK TRADES
          </h1>
          <p>
            Swap picks in the {draftYearLabel(openSeason)} with one other team. Picks only,
            nothing else.
          </p>
          <p className={windowNow === 'closed' ? 'trade-window trade-window-closed' : 'trade-window'}>
            {tradeWindowLine(windowNow)}
          </p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}

      {!composing && (
        <button
          type="button"
          className="rules-tool trade-start tap-btn"
          disabled={busy || windowNow === 'closed'}
          onClick={() => setComposing(true)}
        >
          + PROPOSE A TRADE
        </button>
      )}

      {composing && (
        <div className="rule-edit-form">
          {fromMock && (
            <p className="rule-edit-hint">
              Sending your mock trade with {fromMock.recipient} for real. Review it, then send. It leaves your mocks once it goes.
            </p>
          )}
          {editing && (
            <p className="rule-edit-hint">
              Changing your offer to {editing.recipient}. Resending replaces it and emails {editing.recipient}.
            </p>
          )}
          <label className="rule-edit-label">
            Trade with
            <select
              className="hub-input rule-edit-input"
              value={partner}
              disabled={editing !== null}
              onChange={(e) => {
                setPartner(e.target.value);
                setGet([]);
                setPreview(null);
              }}
            >
              <option value="">Pick a team</option>
              {OWNERS.filter((o) => o !== owner).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>

          <PickPicker
            heading="YOU GIVE"
            picks={myPicks}
            chosen={give}
            onToggle={toggle(give, setGive)}
          />
          {partner && (
            <PickPicker
              heading={`YOU GET FROM ${partner.toUpperCase()}`}
              picks={theirPicks}
              chosen={get}
              onToggle={toggle(get, setGet)}
            />
          )}

          <label className="rule-edit-label">
            Message (optional)
            <textarea
              className="hub-input rule-edit-textarea"
              rows={3}
              maxLength={MAX_TRADE_NOTE}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Say why this works for both of you."
            />
          </label>
          <p className="rule-edit-hint">
            The message is talk. Only the picks you tapped move.
          </p>

          {preview && (
            <ReviewPanel
              preview={preview}
              give={give}
              get={get}
              giver={owner}
              taker={partner}
              reader={owner}
              order={dataset}
              season={dataset.season}
            />
          )}

          <div className="rule-edit-actions">
            {!preview || !preview.check.ok ? (
              <button
                type="button"
                className="rule-edit-save tap-btn"
                disabled={busy || !ready}
                onClick={review}
              >
                {busy ? 'CHECKING...' : 'REVIEW THIS TRADE'}
              </button>
            ) : (
              <button
                type="button"
                className="rule-edit-save tap-btn"
                disabled={busy}
                onClick={askBeforeSending}
              >
                {busy ? 'SENDING...' : `${editing ? 'RESEND' : 'SEND'} IT TO ${partner.toUpperCase()}`}
              </button>
            )}
            {!editing && !fromMock && (
              <button
                type="button"
                className="rule-edit-cancel tap-btn"
                disabled={busy || !ready}
                onClick={() => void keepAsMock()}
                title="Keep it for yourself and draft off it in the mock draft. Nothing is sent."
              >
                SAVE AS MOCK
              </button>
            )}
            <button type="button" className="rule-edit-cancel tap-btn" onClick={resetComposer}>
              CANCEL
            </button>
          </div>
          {!editing && !fromMock && (
            <p className="rule-edit-hint">SAVE AS MOCK keeps it for you alone. Nothing goes to {partner || 'the other team'} and nobody is emailed.</p>
          )}

          {sendWarning && (
            <KeeperResetDialog
              warning={sendWarning}
              confirmLabel="SEND IT ANYWAY"
              busy={busy}
              onConfirm={() => {
                setSendWarning(null);
                void send();
              }}
              onCancel={() => setSendWarning(null)}
            />
          )}
        </div>
      )}

      <div className="audit-tabs trade-tabs">
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'active'}
          onClick={() => setTab('active')}
        >
          ACTIVE
          {/* The badge counts only offers waiting on you to answer. */}
          {inbox.length > 0 && <span className="audit-badge">{inbox.length}</span>}
        </button>
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'mock'}
          onClick={() => setTab('mock')}
        >
          MOCK
          {mocks.length > 0 && <span className="audit-badge">{mocks.length}</span>}
        </button>
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'done'}
          onClick={() => setTab('done')}
        >
          SETTLED
        </button>
      </div>

      <div className="vote-list">
        {shown.map((proposal) => (
          <TradeCard
            key={proposal.id}
            proposal={proposal}
            owner={owner}
            order={dataset}
            isCommish={identity.isCommissioner}
            busy={busy}
            resetWarning={
              // Accepting sends the picks this member was asked for, so those
              // are the ones that could be paying for their keepers.
              proposal.recipient === owner
                ? keeperResetWarning(dataset, state, owner, proposal.request, 'accept')
                : null
            }
            onAccept={(p) => act(() => acceptPickTrade(identity, p.id, p.version))}
            onReject={(p) => act(() => rejectPickTrade(identity, p.id))}
            onCancel={(p) => act(() => cancelPickTrade(identity, p.id))}
            onEdit={startEdit}
          />
        ))}
        {tab === 'mock' && mocks.map((trade) => (
          <article key={trade.id} className="panel trade-card trade-mock">
            <div className="trade-head">
              <span className="hub-heading trade-status">MOCK</span>
              <span className="trade-meta">with {trade.recipient} · {formatDay(trade.createdAt)} · only you see this</span>
            </div>
            <TradeSummary proposal={mockTradeProposal(trade)} reader={owner} order={dataset} season={trade.season} />
            {trade.note && <p className="trade-note">&ldquo;{trade.note}&rdquo;</p>}
            <div className="trade-actions trade-actions-thin">
              <button type="button" className="trade-pull tap-btn" disabled={busy} onClick={() => startFromMock(trade)}>
                SEND FOR REAL
              </button>
              <button type="button" className="trade-pull tap-btn" disabled={busy} onClick={() => void act(() => deleteMockTrade(identity, trade.id))}>
                DELETE
              </button>
            </div>
          </article>
        ))}
        {tab === 'mock' && (
          <div className="panel rules-empty">
            {mocks.length === 0 ? 'No mock trades. Build a trade and tap SAVE AS MOCK. ' : ''}
            Switch mock trades on in the <Link to="/mock">mock draft</Link> setup to draft off them.
          </div>
        )}
        {tab !== 'mock' && shown.length === 0 && (
          <div className="panel rules-empty">
            {tab === 'active'
              ? 'No open offers, to you or from you.'
              : 'No trades have been made in the app yet.'}
          </div>
        )}
        {/* The league's own trade record, so SETTLED is never a dead end. */}
        {tab === 'done' && <EarlierTrades />}
      </div>
    </main>
  );
}

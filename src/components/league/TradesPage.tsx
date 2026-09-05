import { useCallback, useEffect, useMemo, useState } from 'react';
import IdentityChip from './IdentityChip.js';
import EarlierTrades from './EarlierTrades.js';
import { useIdentity, useLeagueData } from '../../hooks/useLeague.js';
import { OWNERS } from '../../lib/league/data.js';
import {
  acceptPickTrade,
  apiErrorMessage,
  cancelPickTrade,
  fetchPickTrades,
  previewPickTrade,
  rejectPickTrade,
  sendPickTrade,
  type PickTradesResponse,
} from '../../lib/league/api.js';
import {
  assetOrigin,
  describeRef,
  groupPicksByOrigin,
  MAX_PICKS_PER_SIDE,
  MAX_TRADE_NOTE,
  ordinal,
  pickRefKey,
  pickTitle,
  sameRef,
  STATUS_LABEL,
  tradablePicksFor,
  tradeSidesFor,
  type PickRef,
  type PickTradeProposal,
  type TradablePick,
  type TradeAsset,
  type TradePreview,
} from '../../lib/league/pickTrades.js';

type Tab = 'inbox' | 'sent' | 'done';

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
  picks: TradablePick[];
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
                  R{entry.ref.round}
                  <span className="trade-chip-slot"> · {entry.label}</span>
                  {entry.onClock && <span className="trade-chip-note"> ON THE CLOCK</span>}
                  {entry.blockedBy === 'drafted' && <span className="trade-chip-note"> USED</span>}
                  {entry.blockedBy === 'keeper' && <span className="trade-chip-note"> KEEPER</span>}
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
/* One row per pick                                                    */
/* ------------------------------------------------------------------ */

/**
 * A round number on its own is ambiguous: a pick's identity is its round plus
 * the team it came from. So every row names both, and says which way it goes.
 */
function AssetRow({
  asset,
  season,
  incoming,
}: {
  asset: TradeAsset;
  season: number;
  incoming: boolean;
}) {
  return (
    <li className="trade-asset">
      <span className="trade-asset-badge" aria-hidden="true">
        <span className="trade-asset-round">{ordinal(asset.ref.round)}</span>
        <span className="trade-asset-year">{season}</span>
      </span>
      <span className="trade-asset-text">
        <strong className="trade-asset-title">{pickTitle(asset.ref)}</strong>
        <span className="trade-asset-origin">{assetOrigin(asset)}</span>
        <span className="trade-asset-dir">
          <span className="trade-asset-arrow" aria-hidden="true">
            {incoming ? '←' : '→'}
          </span>
          {incoming ? `From ${asset.from}` : `To ${asset.to}`}
        </span>
      </span>
    </li>
  );
}

function TradeColumn({
  heading,
  assets,
  season,
  incoming,
}: {
  heading: string;
  assets: TradeAsset[];
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
              season={season}
              incoming={incoming}
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
  season,
  named = false,
}: {
  proposal: Pick<PickTradeProposal, 'proposer' | 'recipient' | 'offer' | 'request'>;
  reader: string;
  season: number;
  named?: boolean;
}) {
  const sides = tradeSidesFor(proposal, reader);
  return (
    <div className="trade-sides">
      <TradeColumn
        heading={named ? `${reader} receives` : 'Receives'}
        assets={sides.receives}
        season={season}
        incoming
      />
      <TradeColumn
        heading={named ? `${reader} sends` : 'Sends'}
        assets={sides.sends}
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
  season,
}: {
  preview: TradePreview;
  give: PickRef[];
  get: PickRef[];
  giver: string;
  taker: string;
  reader: string;
  season: number;
}) {
  return (
    <div className="trade-review">
      <TradeSummary
        proposal={{ proposer: giver, recipient: taker, offer: give, request: get }}
        reader={reader}
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
                <strong>{describeRef(entry.ref)}</strong>{' '}
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
  isCommish,
  busy,
  onAccept,
  onReject,
  onCancel,
}: {
  proposal: PickTradeProposal;
  owner: string;
  isCommish: boolean;
  busy: boolean;
  onAccept: (p: PickTradeProposal) => void;
  onReject: (p: PickTradeProposal) => void;
  onCancel: (p: PickTradeProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<TradePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
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
        </span>
      </div>

      <TradeSummary
        proposal={proposal}
        reader={reader}
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
          season={proposal.season}
        />
      )}

      {pending && theirs && (
        <div className="trade-actions">
          <button
            type="button"
            className="trade-btn trade-btn-yes tap-btn"
            disabled={busy}
            onClick={() => (confirming ? onAccept(proposal) : setConfirming(true))}
          >
            {confirming ? 'TAP AGAIN TO TRADE' : 'ACCEPT THIS TRADE'}
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
      {confirming && pending && theirs && (
        <p className="trade-reason">The picks move as soon as you tap again.</p>
      )}

      {pending && (mine || isCommish) && (
        <div className="trade-actions trade-actions-thin">
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
  const [tab, setTab] = useState<Tab>('inbox');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [partner, setPartner] = useState('');
  const [give, setGive] = useState<PickRef[]>([]);
  const [get, setGet] = useState<PickRef[]>([]);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<TradePreview | null>(null);

  const owner = identity?.owner ?? '';

  const load = useCallback(async () => {
    if (!identity) return;
    try {
      setData(await fetchPickTrades(identity));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  const myPicks = useMemo(
    () => (owner ? tradablePicksFor(dataset, state, owner) : []),
    [dataset, state, owner],
  );
  const theirPicks = useMemo(
    () => (partner ? tradablePicksFor(dataset, state, partner) : []),
    [dataset, state, partner],
  );

  if (!identity) {
    return (
      <main className="rules-page">
        <div className="panel rules-status">
          <span className="hub-heading">SIGN IN</span>
          <p>Sign in from the home page to trade draft picks.</p>
        </div>
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
  };

  const review = () =>
    act(async () => {
      setPreview(await previewPickTrade(identity, { recipient: partner, offer: give, request: get }));
    });

  const send = () =>
    act(async () => {
      await sendPickTrade(identity, { recipient: partner, offer: give, request: get, note });
      resetComposer();
      setTab('sent');
    });

  const proposals = data?.proposals ?? [];
  const inbox = proposals.filter((p) => p.status === 'pending' && p.recipient === owner);
  const sent = proposals.filter((p) => p.status === 'pending' && p.proposer === owner);
  // A commissioner also sees pending offers between two other members, stripped
  // of their picks, so they can clear one that is stuck.
  const stuck = proposals.filter(
    (p) => p.status === 'pending' && p.proposer !== owner && p.recipient !== owner,
  );
  const done = proposals.filter((p) => p.status !== 'pending');
  const shown = tab === 'inbox' ? inbox : tab === 'sent' ? [...sent, ...stuck] : done;
  const ready = partner !== '' && give.length > 0 && get.length > 0;

  return (
    <main className="rules-page">
      <header className="rules-page-header">
        <div>
          <h1 className="hub-heading glow-yellow">🔁 PICK TRADES</h1>
          <p>Swap draft picks with one other team. Picks only, nothing else.</p>
        </div>
        <IdentityChip />
      </header>

      {error && <p className="rules-draft-error">{error}</p>}

      {!composing && (
        <button
          type="button"
          className="rules-tool trade-start tap-btn"
          disabled={busy}
          onClick={() => setComposing(true)}
        >
          + PROPOSE A TRADE
        </button>
      )}

      {composing && (
        <div className="rule-edit-form">
          <label className="rule-edit-label">
            Trade with
            <select
              className="hub-input rule-edit-input"
              value={partner}
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
                onClick={send}
              >
                {busy ? 'SENDING...' : `SEND IT TO ${partner.toUpperCase()}`}
              </button>
            )}
            <button type="button" className="rule-edit-cancel tap-btn" onClick={resetComposer}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      <div className="audit-tabs trade-tabs">
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'inbox'}
          onClick={() => setTab('inbox')}
        >
          INBOX
          {inbox.length > 0 && <span className="audit-badge">{inbox.length}</span>}
        </button>
        <button
          type="button"
          className="rules-tool tap-btn"
          aria-pressed={tab === 'sent'}
          onClick={() => setTab('sent')}
        >
          SENT
          {sent.length > 0 && <span className="audit-badge">{sent.length}</span>}
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
            isCommish={identity.isCommissioner}
            busy={busy}
            onAccept={(p) => act(() => acceptPickTrade(identity, p.id, p.version))}
            onReject={(p) => act(() => rejectPickTrade(identity, p.id))}
            onCancel={(p) => act(() => cancelPickTrade(identity, p.id))}
          />
        ))}
        {shown.length === 0 && (
          <div className="panel rules-empty">
            {tab === 'inbox'
              ? 'Nobody has offered you a trade.'
              : tab === 'sent'
                ? 'You have no offers out.'
                : 'No trades have been made in the app yet.'}
          </div>
        )}
        {/* The league's own trade record, so SETTLED is never a dead end. */}
        {tab === 'done' && <EarlierTrades />}
      </div>
    </main>
  );
}

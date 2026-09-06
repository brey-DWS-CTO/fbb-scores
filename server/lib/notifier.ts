/**
 * The league's email, above the mailer and below the routes.
 *
 * Two kinds of mail live here. Trades and keeper reveals go out as a side
 * effect of a route, after the state is saved and the answer is already on its
 * way back. Reminders go out on a clock, from the cron route.
 *
 * Three rules run through all of it:
 *  - A request never waits for mail. Sending is queued, and a failure is
 *    logged and dropped. A trade is done whether or not Resend answers.
 *  - An owner with no address is skipped, silently.
 *  - A reminder goes out once. The key is claimed in the store before the
 *    send, so a cron that fires twice mails nobody twice.
 */
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset, PickRef, PickTradeProposal } from '../../src/lib/keeper/types.js';
import { describeTrade, exactPickLabel } from '../../src/lib/league/pickTrades.js';
import {
  dueReminders,
  reminderCopy,
  type DueReminder,
} from '../../src/lib/league/notifications.js';
import {
  DRAFT_AT_ISO,
  claimSentNotice,
  getOwnerEmails,
  getState,
  listSentNotices,
} from './leagueStore.js';
import { sendMail, type MailContent } from './mailer.js';

const leagueDataset = rawDataset as unknown as LeagueDataset;

// ─── The queue ───────────────────────────────────────────────────────────────

let pending: Promise<void> = Promise.resolve();

/**
 * Start a send and forget it.
 *
 * The work begins now; nothing waits for it. Errors are swallowed on purpose,
 * because the thing that triggered the mail has already happened and cannot be
 * undone by a mail server having a bad day.
 */
function queueMail(what: string, work: () => Promise<void>): void {
  const run = work().catch((err) => {
    console.error(`[notify] ${what} failed:`, err instanceof Error ? err.message : err);
  });
  pending = pending.then(() => run);
}

/** Waits for every queued send. For tests, not for routes. */
export function mailSettled(): Promise<void> {
  return pending;
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/** Owner to address, leaving out everyone who has no address on file. */
async function addressBook(): Promise<Map<string, string>> {
  const rows = await getOwnerEmails();
  return new Map(rows.filter((row) => row.email !== '').map((row) => [row.owner, row.email]));
}

async function mailTo(owner: string, content: MailContent, origin: string): Promise<void> {
  const book = await addressBook();
  const address = book.get(owner);
  if (!address) return;
  await sendMail(address, content, origin, 'notify');
}

// ─── Trades ──────────────────────────────────────────────────────────────────

/**
 * Draft positions decide a pick's slot and never move, so the committed
 * dataset is enough to name the exact picks in an email.
 */
function sideLabel(refs: PickRef[]): string {
  if (refs.length === 0) return 'nothing';
  return refs.map((ref) => exactPickLabel(leagueDataset, ref)).join(', ');
}

function noteLine(proposal: PickTradeProposal): string[] {
  return proposal.note ? [`They said: "${proposal.note}"`] : [];
}

function tradeLink(origin: string): string {
  return `${origin}/trades`;
}

/** An offer landed in someone's inbox. Mails the person who has to answer. */
export function notifyTradeOffered(proposal: PickTradeProposal, origin: string): void {
  const theirs = sideLabel(proposal.offer);
  const yours = sideLabel(proposal.request);
  queueMail('trade offered', () =>
    mailTo(
      proposal.recipient,
      {
        subject: `${proposal.proposer} offered you a trade`,
        preheader: describeTrade(proposal, leagueDataset),
        heading: `${proposal.proposer} offered you a trade`,
        lines: [
          `${proposal.proposer} sends you ${theirs}.`,
          `${proposal.proposer} wants ${yours} back.`,
          ...noteLine(proposal),
        ],
        action: { label: 'SEE THE OFFER', href: tradeLink(origin) },
        notes: ['An offer does not stand forever. Answer it while it is live.'],
      },
      origin,
    ),
  );
}

/** A trade was taken. Mails the person who sent it. */
export function notifyTradeAccepted(proposal: PickTradeProposal, origin: string): void {
  queueMail('trade accepted', () =>
    mailTo(
      proposal.proposer,
      {
        subject: 'Your trade went through',
        preheader: describeTrade(proposal, leagueDataset),
        heading: 'Your trade went through',
        lines: [
          `${proposal.recipient} took your offer.`,
          `You give ${sideLabel(proposal.offer)}. You get ${sideLabel(proposal.request)}.`,
        ],
        action: { label: 'SEE THE PICKS', href: tradeLink(origin) },
      },
      origin,
    ),
  );
}

/**
 * An offer was turned down or pulled. Mails whoever did not do it, which is
 * both of them when a commissioner cleared something stuck.
 */
export function notifyTradeSettled(
  proposal: PickTradeProposal,
  action: 'reject' | 'cancel',
  actorOwner: string,
  origin: string,
): void {
  const others = [proposal.proposer, proposal.recipient].filter((owner) => owner !== actorOwner);
  const summary = describeTrade(proposal, leagueDataset);
  const byCommissioner = others.length === 2;
  const content: MailContent = byCommissioner
    ? {
        subject: 'The commissioner cleared a trade offer',
        preheader: summary,
        heading: 'That offer is closed',
        lines: [`The commissioner cleared the offer of ${summary}.`, 'No picks moved.'],
        action: { label: 'SEE YOUR TRADES', href: tradeLink(origin) },
      }
    : action === 'reject'
      ? {
          subject: `${proposal.recipient} turned down your trade`,
          preheader: summary,
          heading: `${proposal.recipient} said no`,
          lines: [`Your offer of ${summary} is closed.`, 'Send another one if you still want it.'],
          action: { label: 'SEE YOUR TRADES', href: tradeLink(origin) },
        }
      : {
          subject: `${proposal.proposer} pulled the trade back`,
          preheader: summary,
          heading: 'That offer is gone',
          lines: [`${proposal.proposer} pulled back the offer of ${summary}.`, 'No picks moved.'],
          action: { label: 'SEE YOUR TRADES', href: tradeLink(origin) },
        };

  for (const owner of others) {
    queueMail('trade settled', () => mailTo(owner, content, origin));
  }
}

// ─── Keepers ─────────────────────────────────────────────────────────────────

/** The commissioner opened the keeper lists. Everyone with an address hears. */
export function notifyKeepersRevealed(origin: string): void {
  queueMail('keepers revealed', async () => {
    const book = await addressBook();
    const content: MailContent = {
      subject: 'Keepers are out',
      preheader: 'Every team keeper list is public.',
      heading: 'Keepers are out',
      lines: [
        'The commissioner opened the keeper lists.',
        'Go and see who everybody kept.',
      ],
      action: { label: 'SEE THE KEEPERS', href: `${origin}/keepers` },
    };
    for (const address of book.values()) {
      await sendMail(address, content, origin, 'notify');
    }
  });
}

// ─── Reminders ───────────────────────────────────────────────────────────────

function reminderContent(reminder: DueReminder, origin: string): MailContent {
  const copy = reminderCopy(reminder);
  const keeperKind =
    reminder.kind === 'keepers-soon' || reminder.kind === 'keepers-last-call';
  return {
    subject: copy.subject,
    preheader: copy.body,
    heading: copy.heading,
    lines: [copy.body],
    action: keeperKind
      ? { label: 'PICK YOUR KEEPERS', href: `${origin}/keepers` }
      : { label: 'OPEN THE DRAFT ROOM', href: `${origin}/draft` },
  };
}

export interface ReminderRun {
  /** How many reminders the clock says are due and not yet sent. */
  due: number;
  /** How many actually went out on this run. */
  sent: number;
}

/**
 * Send every reminder the clock says is due.
 *
 * The key is claimed first. If the send then fails, the claim stands and that
 * reminder does not go out later: sending one warning twice to ten people is
 * worse than missing one, and the app itself still shows the deadline.
 */
export async function runDueReminders(now: Date, origin: string): Promise<ReminderRun> {
  const { state } = await getState();
  const book = await addressBook();
  const withKeepers = Object.entries(state.keepers)
    .filter(([, selections]) => selections.length > 0)
    .map(([owner]) => owner);

  const due = dueReminders({
    now,
    draftAt: new Date(DRAFT_AT_ISO),
    season: state.season,
    owners: [...book.keys()],
    ownersWithKeepers: withKeepers,
    alreadySent: await listSentNotices(state.season),
  });

  let sent = 0;
  for (const reminder of due) {
    const address = book.get(reminder.owner);
    if (!address) continue;
    const mine = await claimSentNotice(reminder.key, state.season);
    if (!mine) continue;
    const result = await sendMail(address, reminderContent(reminder, origin), origin, 'notify');
    if (result.ok) sent += 1;
  }
  return { due: due.length, sent };
}

/**
 * The league's email, above the mailer and below the routes.
 *
 * Two kinds of mail live here. Trades, party invites and keeper reveals go out as a side
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
import { waitUntil } from '@vercel/functions';
import rawDataset from '../../src/data/league-2027.json' with { type: 'json' };
import type { LeagueDataset, PickRef, PickTradeProposal } from '../../src/lib/keeper/types.js';
import { describeTrade, exactPickLabel } from '../../src/lib/league/pickTrades.js';
import {
  anyReminderWindowOpen,
  dueReminders,
  keeperDeadline,
  reminderCopy,
  type DueReminder,
} from '../../src/lib/league/notifications.js';
import {
  DRAFT_AT_ISO,
  claimSentNotice,
  getOwnerEmails,
  getState,
  issueLoginToken,
  listParties,
  listSentNotices,
} from './leagueStore.js';
import { sendMail, type MailContent } from './mailer.js';
import { shameEmailCopy, type DuesBoard } from '../../src/lib/league/dues.js';
import { dueAnnouncements } from '../../src/lib/league/announcements.js';
import { matchupLabel, partyHeadline, type HouseParty } from '../../src/lib/league/houseParty.js';
import { duePartyReminders, partiesDueNow, partyCheckDue, partyReminderCopy } from '../../src/lib/league/partyReminders.js';

const leagueDataset = rawDataset as unknown as LeagueDataset;

// ─── The queue ───────────────────────────────────────────────────────────────

let pending: Promise<void> = Promise.resolve();

/**
 * Start a send and forget it.
 *
 * The work begins now; nothing waits for it. Errors are swallowed on purpose,
 * because the thing that triggered the mail has already happened and cannot be
 * undone by a mail server having a bad day.
 *
 * On Vercel a function can be frozen the moment it answers, which would cut a
 * send off in flight and lose the mail with no error anywhere. `waitUntil`
 * tells the platform to keep the function alive until the send finishes. It
 * does nothing outside Vercel, so local and test runs are unchanged.
 */
function queueMail(what: string, work: () => Promise<void>): void {
  const run = work().catch((err) => {
    console.error(`[notify] ${what} failed:`, err instanceof Error ? err.message : err);
  });
  pending = pending.then(() => run);
  try {
    waitUntil(run);
  } catch {
    // Outside a Vercel request there is nothing to hold open, and the send is
    // already running. Losing this is not a reason to lose the send.
  }
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

// House party invitations

/** Send newly saved house party invitations alongside the in-app popup. */
export function notifyPartyInvited(party: HouseParty, owners: readonly string[], origin: string): void {
  if (owners.length === 0) return;
  const recipients = new Set(owners);
  queueMail('party invited', async () => {
    const book = await addressBook();
    for (const invite of party.invites ?? []) {
      if (!recipients.has(invite.owner)) continue;
      const address = book.get(invite.owner);
      if (!address) continue;
      // A retry or two simultaneous invite requests must not send two emails.
      if (!(await claimSentNotice(`party-invite-${party.id}-${invite.owner}`, party.season))) continue;
      const game = party.games[0];
      await sendMail(address, {
        subject: `${invite.by} invited you: ${game ? matchupLabel(game) : 'House party'}`,
        preheader: partyHeadline(party),
        heading: `${invite.by} invited you`,
        lines: [
          partyHeadline(party),
          ...(party.note ? [party.note] : []),
          ...party.games.slice(1).map((extra) => `Also watching: ${matchupLabel(extra)}.`),
        ],
        action: { label: 'OPEN PARTY & RSVP', href: `${origin}/party/${encodeURIComponent(party.id)}` },
        notes: ["Open the party to say I'M IN or CAN'T MAKE IT."],
      }, origin, 'notify');
    }
  });
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

/**
 * An offer landed in someone's inbox, or the proposer changed it and sent it
 * again. Mails the person who has to answer.
 */
export function notifyTradeOffered(proposal: PickTradeProposal, origin: string, revised = false): void {
  const theirs = sideLabel(proposal.offer);
  const yours = sideLabel(proposal.request);
  const headline = revised
    ? `${proposal.proposer} changed the trade offer`
    : `${proposal.proposer} offered you a trade`;
  queueMail(revised ? 'trade revised' : 'trade offered', () =>
    mailTo(
      proposal.recipient,
      {
        subject: headline,
        preheader: describeTrade(proposal, leagueDataset),
        heading: headline,
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

/** The keeper deadline in Pacific time, which is how the league says dates. */
function keeperDeadlineLabel(): string {
  const at = keeperDeadline(new Date(DRAFT_AT_ISO));
  return `${at.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })} Pacific`;
}

/**
 * The line an owner reads when a trade took the pick their keeper was paying
 * with. Their whole keeper list is gone and they pick again.
 */
function keeperResetLines(): string[] {
  return [
    'That trade moved a pick one of your keepers was paying for, so your keepers have been cleared.',
    `Pick them again by ${keeperDeadlineLabel()}.`,
  ];
}

function keeperLink(origin: string): string {
  return `${origin}/keepers`;
}

/**
 * A trade was taken. Mails the person who sent it, and tells either side whose
 * keepers the trade cleared that they have to pick again.
 */
export function notifyTradeAccepted(
  proposal: PickTradeProposal,
  origin: string,
  keepersReset: string[] = [],
): void {
  const proposerReset = keepersReset.includes(proposal.proposer);
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
          ...(proposerReset ? keeperResetLines() : []),
        ],
        action: proposerReset
          ? { label: 'PICK YOUR KEEPERS', href: keeperLink(origin) }
          : { label: 'SEE THE PICKS', href: tradeLink(origin) },
      },
      origin,
    ),
  );

  // Everyone else hears the trade went through, so no deal happens quietly.
  queueMail('trade announced', async () => {
    const book = await addressBook();
    const content: MailContent = {
      subject: `Trade: ${proposal.proposer} and ${proposal.recipient}`,
      preheader: describeTrade(proposal, leagueDataset),
      heading: 'A trade went through',
      lines: [
        `${proposal.proposer} gets ${sideLabel(proposal.request)}.`,
        `${proposal.recipient} gets ${sideLabel(proposal.offer)}.`,
      ],
      action: { label: 'SEE LEAGUE ACTIVITY', href: `${origin}/league` },
    };
    for (const [owner, address] of book) {
      if (owner === proposal.proposer || owner === proposal.recipient) continue;
      await sendMail(address, content, origin, 'notify');
    }
  });

  // The member who accepted gets no trade mail, because they were there. They
  // do get one when their own keepers went with it.
  if (!keepersReset.includes(proposal.recipient)) return;
  queueMail('keepers reset', () =>
    mailTo(
      proposal.recipient,
      {
        subject: 'Your keepers need picking again',
        preheader: describeTrade(proposal, leagueDataset),
        heading: 'Your keepers are cleared',
        lines: keeperResetLines(),
        action: { label: 'PICK YOUR KEEPERS', href: keeperLink(origin) },
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

// ─── The rule book ───────────────────────────────────────────────────────────

export interface SignRequestResult {
  /** Owners a note went out to. */
  sent: string[];
  /** Owners who were picked but have no address on file. */
  noAddress: string[];
}

/**
 * "Read it, sign it": one note to each member the commissioner picked.
 * Publishing is quiet on its own, so the commissioner can read the printed
 * copy first, send it to one person as a test, and then to the rest.
 */
export async function sendRulebookSignRequest(
  input: {
    revision: number;
    notes: string;
    publishedBy: string;
    owners: string[];
    /** "2026-27", the season the book is for. */
    seasonLabel: string;
    /** When the revision went out, ISO. */
    publishedAt: string;
  },
  origin: string,
): Promise<SignRequestResult> {
  const book = await addressBook();
  const sent = input.owners.filter((owner) => book.has(owner));
  const noAddress = input.owners.filter((owner) => !book.has(owner));
  const when = new Date(input.publishedAt);
  const stamp = `${String(when.getUTCMonth() + 1).padStart(2, '0')}-${String(when.getUTCDate()).padStart(2, '0')}-${when.getUTCFullYear()}`;
  const title = `The ${input.seasonLabel} Nerds Fantasy Basketball League Constitution`;
  const landing = `${origin}/rules/paper`;

  /**
   * The button is a personal sign-in link that lands on the printed copy, so
   * tapping it signs the member in and puts SIGN in front of them. A phone
   * holding a dead PIN was the way a signature failed to stick. If this
   * address cannot have another link right now, the button still opens the
   * copy and the page asks them to sign in.
   */
  const buttonFor = async (owner: string): Promise<string> => {
    try {
      const issued = await issueLoginToken(book.get(owner) as string, new Date());
      if (issued.ok && issued.token) {
        return `${origin}/sign-in/${encodeURIComponent(issued.token)}?next=${encodeURIComponent('/rules/paper')}`;
      }
    } catch (err) {
      console.error('[notify] could not issue a sign-in link for the sign request:', err instanceof Error ? err.message : err);
    }
    return landing;
  };

  const contentFor = (href: string): MailContent => ({
    subject: title,
    preheader: `Revision ${input.revision} has been released on ${stamp}.`,
    heading: 'The Nerds',
    lines: [
      `${title}, revision ${input.revision}, has been released on ${stamp}.`,
      'Get in here and pretend to read and sign it!',
    ],
    action: { label: 'READ AND SIGN', href },
    notes: ['This button signs you in on this device. It works once, for two days.'],
  });

  queueMail('rule book sign request', async () => {
    for (const owner of sent) {
      await sendMail(book.get(owner) as string, contentFor(await buttonFor(owner)), origin, 'notify');
    }
  });
  return { sent, noAddress };
}

// ─── Dues ────────────────────────────────────────────────────────────────────

/**
 * "Pay up": one note to each team the commissioner is shaming, each with its
 * own amount and the names still on the wall.
 */
export async function sendDuesShame(
  input: { owners: string[]; season: number; board: DuesBoard; payee: string },
  origin: string,
): Promise<SignRequestResult> {
  const book = await addressBook();
  const sent = input.owners.filter((owner) => book.has(owner));
  const noAddress = input.owners.filter((owner) => !book.has(owner));
  queueMail('dues shame', async () => {
    for (const owner of sent) {
      const copy = shameEmailCopy({ owner, season: input.season, board: input.board, payee: input.payee });
      const content: MailContent = {
        subject: copy.subject,
        preheader: copy.preheader,
        heading: copy.heading,
        lines: copy.lines,
        action: { label: copy.actionLabel, href: `${origin}/dues` },
        notes: copy.notes,
      };
      await sendMail(book.get(owner) as string, content, origin, 'notify');
    }
  });
  return { sent, noAddress };
}

// ─── Reminders ───────────────────────────────────────────────────────────────

function reminderContent(reminder: DueReminder, origin: string): MailContent {
  const copy = reminderCopy(reminder);
  const keeperKind = reminder.kind.startsWith('keepers-');
  return {
    subject: copy.subject,
    preheader: copy.lines[0],
    heading: copy.heading,
    lines: copy.lines,
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
  /** One-time announcements that went out on this run. */
  announced?: number;
  /** Morning-of house party reminders that went out on this run. */
  parties?: number;
}

// ─── House parties ───────────────────────────────────────────────────────────

/**
 * The morning-of party reminder, to everyone who said I'M IN.
 *
 * The parties are read only in the nine and ten o'clock hours Pacific, so
 * the database is asked once a day, twice at most, and never at three in
 * the morning. With no party today the run ends after that one read. The
 * key is claimed before the send, like every other reminder here.
 */
export async function runPartyReminders(now: Date, origin: string): Promise<number> {
  if (!partyCheckDue(now)) return 0;
  const season = leagueDataset.season;
  const parties = (await listParties(season)) as HouseParty[];
  if (partiesDueNow(now, parties).length === 0) return 0;
  const book = await addressBook();
  const due = duePartyReminders({ now, parties, owners: [...book.keys()], alreadySent: await listSentNotices(season) });
  let sent = 0;
  for (const reminder of due) {
    const address = book.get(reminder.owner);
    if (!address) continue;
    if (!(await claimSentNotice(reminder.key, season))) continue;
    const copy = partyReminderCopy(reminder.party, reminder.owner);
    const content: MailContent = {
      subject: copy.subject,
      preheader: copy.preheader,
      heading: copy.heading,
      lines: copy.lines,
      action: { label: 'OPEN THE PARTY', href: `${origin}/party/${encodeURIComponent(reminder.party.id)}` },
      notes: ['Plans changed? Open the party and tap CAN\'T MAKE IT.'],
    };
    const result = await sendMail(address, content, origin, 'notify');
    if (result.ok) sent += 1;
  }
  return sent;
}

// ─── Announcements ───────────────────────────────────────────────────────────

/**
 * One-time league news, each member once. Claimed before sending, like the
 * reminders: a failed send is not retried, so nobody ever gets it twice.
 */
export async function runAnnouncements(now: Date, origin: string): Promise<number> {
  const season = leagueDataset.season;
  const book = await addressBook();
  const due = dueAnnouncements({ now, owners: [...book.keys()], alreadySent: await listSentNotices(season) });
  let sent = 0;
  for (const item of due) {
    const address = book.get(item.owner);
    if (!address) continue;
    if (!(await claimSentNotice(item.key, season))) continue;
    const a = item.announcement;
    const content: MailContent = {
      subject: a.subject,
      preheader: a.preheader,
      heading: a.heading,
      lines: a.lines,
      action: { label: a.actionLabel, href: `${origin}${a.actionPath}` },
    };
    const result = await sendMail(address, content, origin, 'notify');
    if (result.ok) sent += 1;
  }
  return sent;
}

/**
 * Send every reminder the clock says is due.
 *
 * The key is claimed first. If the send then fails, the claim stands and that
 * reminder does not go out later: sending one warning twice to ten people is
 * worse than missing one, and the app itself still shows the deadline.
 */
export async function runDueReminders(now: Date, origin: string): Promise<ReminderRun> {
  const announced = await runAnnouncements(now, origin);
  const parties = await runPartyReminders(now, origin);
  // Most hours of the year nothing can be due. Say so without a query, so
  // the database can stay asleep.
  if (!anyReminderWindowOpen(now, new Date(DRAFT_AT_ISO))) return { due: 0, sent: 0, announced, parties };
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
  return { due: due.length, sent, announced, parties };
}

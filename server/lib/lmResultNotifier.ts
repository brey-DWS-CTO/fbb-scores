import { createHash } from 'node:crypto';
import { lmResultEmail } from '../../src/lib/league/lmResultEmail.js';
import type { LmAddRequest } from '../../src/lib/league/lmWeekend.js';
import { claimSentNotice, getOwnerEmails, listLmAddRequests, listSentNotices } from './leagueStore.js';
import { sendMail, type SendResult, type MailContent } from './mailer.js';

export interface LmResultMailRuntime {
  requests: () => Promise<LmAddRequest[]>;
  emails: typeof getOwnerEmails;
  sent: typeof listSentNotices;
  mark: typeof claimSentNotice;
  send: (to: string, content: MailContent, origin: string, tag: string, key: string) => Promise<SendResult>;
}

/** Persistent sent ledger + provider idempotency make failed sends retryable without duplicate mail. */
export async function flushLmResultEmails(season: number, now = new Date(), runtime?: LmResultMailRuntime): Promise<number> {
  const deps = runtime ?? {requests:()=>listLmAddRequests(season),emails:getOwnerEmails,sent:listSentNotices,mark:claimSentNotice,send:sendMail};
  // Never backfill old results or exceed the provider's 24-hour idempotency window.
  const requests = (await deps.requests()).filter(row => ['added','denied'].includes(row.status) && Date.parse(row.updatedAt) <= now.getTime() && Date.parse(row.updatedAt) > now.getTime()-24*60*60_000);
  if (!requests.length) return 0;
  const [emails, sent] = await Promise.all([deps.emails(),deps.sent(season)]);
  const book = new Map(emails.filter(row=>row.email).map(row=>[row.owner,row.email]));
  const seen = new Set(sent);
  const origin = (process.env.PUBLIC_APP_URL ?? 'https://fbb-scores.dowhatsolutions.com').replace(/\/+$/, '');
  let delivered = 0;
  let attempts = 0;
  for (const row of requests) {
    const key = `lm-result/${createHash('sha256').update(`${season}:${row.id}:${row.status}`).digest('hex')}`;
    const address = book.get(row.owner);
    const content = lmResultEmail(row,origin);
    if (!address || !content || seen.has(key)) continue;
    if (attempts++ >= 20) break;
    const result = await deps.send(address,content,origin,'lm-result',key);
    if (result.ok && !result.logged) { await deps.mark(key,season); seen.add(key); delivered++; }
  }
  return delivered;
}

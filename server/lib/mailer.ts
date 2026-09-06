/**
 * Sending mail.
 *
 * Resend when RESEND_API_KEY is set, which is production. Without a key the
 * mail is written to the server log instead, so local work needs no account
 * and no mail ever leaves the machine.
 *
 * There is no SDK here on purpose. Resend's send call is one POST, and one
 * fetch is cheaper to read than a dependency.
 *
 * Every email the league sends uses the one shell below: dark card, badge,
 * heading, a sentence or two, a button. A new email supplies words, never
 * markup, so the layout is fixed in one place and cannot drift five ways.
 */

const RESEND_ENDPOINT = process.env.RESEND_ENDPOINT ?? 'https://api.resend.com/emails';

export interface SendResult {
  ok: boolean;
  /** True when nothing was sent because no key is configured. */
  logged?: boolean;
  error?: string;
}

/** The one button in the card. */
export interface MailAction {
  label: string;
  href: string;
}

/** The words for one email. Everything else is the shell. */
export interface MailContent {
  subject: string;
  /** The line the inbox shows before anyone opens it. */
  preheader: string;
  heading: string;
  /** A sentence or two under the heading. */
  lines: string[];
  action?: MailAction;
  /** Small print under the button. */
  notes?: string[];
  /** Shown as "paste this" when the button will not open. */
  paste?: string;
  /** The plain-text sentences, when they need to differ from the HTML ones. */
  textLines?: string[];
}

function fromAddress(): string {
  return process.env.LEAGUE_MAIL_FROM ?? 'The Nerds <onboarding@resend.dev>';
}

/** Owner names and trade notes come from people, so nothing goes in raw. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textBody(content: MailContent): string {
  const parts = ['THE NERDS', ''];
  parts.push(...(content.textLines ?? content.lines));
  if (content.action) parts.push('', content.action.href);
  if (content.notes?.length) parts.push('', ...content.notes);
  return parts.join('\n');
}

/**
 * The shell.
 *
 * Written for mail clients, not browsers, so it is tables and inline styles.
 * A styled anchor is not a button in Outlook, and anything in a stylesheet is
 * thrown away. The logo is a transparent PNG with dark metal in it, so the
 * card behind it has to be dark or the badge loses its edges.
 */
function htmlBody(content: MailContent, origin: string): string {
  const bg = '#08080c';
  const card = '#12121a';
  const border = '#262633';
  const teal = '#00ffcc';
  const text = '#f0f0f5';
  const dim = '#8888aa';
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const rows: string[] = [];
  rows.push(`        <tr>
          <td align="center" style="padding:28px 24px 8px">
            <img src="${origin}/logo.png" width="220" alt="FBB Scores, The Nerds" style="display:block;width:220px;max-width:80%;height:auto;border:0" />
          </td>
        </tr>`);
  rows.push(`        <tr>
          <td align="center" style="padding:8px 28px 0;font-family:${font};font-size:20px;font-weight:700;color:${text}">
            ${esc(content.heading)}
          </td>
        </tr>`);
  if (content.lines.length > 0) {
    rows.push(`        <tr>
          <td align="center" style="padding:8px 28px 0;font-family:${font};font-size:15px;line-height:1.5;color:${dim}">
            ${content.lines.map(esc).join('<br />\n            ')}
          </td>
        </tr>`);
  }
  if (content.action) {
    rows.push(`        <tr>
          <td align="center" style="padding:22px 28px 0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${teal}" style="border-radius:10px">
                  <a href="${content.action.href}" style="display:inline-block;padding:15px 34px;font-family:${font};font-size:15px;font-weight:800;letter-spacing:0.08em;color:#08080c;text-decoration:none;border-radius:10px">${esc(content.action.label)}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>`);
  }
  if (content.notes?.length) {
    rows.push(`        <tr>
          <td align="center" style="padding:20px 28px 0;font-family:${font};font-size:13px;line-height:1.5;color:${dim}">
            ${content.notes.map(esc).join('<br />\n            ')}
          </td>
        </tr>`);
  }
  if (content.paste) {
    rows.push(`        <tr>
          <td align="center" style="padding:16px 24px 26px">
            <div style="font-family:${font};font-size:11px;color:#55556a;word-break:break-all;line-height:1.5">
              Button not working? Paste this:<br />${content.paste}
            </div>
          </td>
        </tr>`);
  } else {
    // The card still needs a floor under the last row it did print.
    rows.push(`        <tr>
          <td style="padding:0 24px 26px"></td>
        </tr>`);
  }

  return `<!-- Shown in the inbox list, before anyone opens anything. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};margin:0;padding:24px 12px">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px;background:${card};border:1px solid ${border};border-radius:16px">
${rows.join('\n')}
      </table>
      <div style="padding:16px 8px 0;font-family:${font};font-size:11px;letter-spacing:0.14em;color:#44445a">
        THE NERDS &middot; EST. 2010
      </div>
    </td>
  </tr>
</table>`;
}

/**
 * Send one email.
 *
 * `tag` only labels the log line. Failures log a status and never an address:
 * a log is read by more people than an inbox is.
 */
export async function sendMail(
  to: string,
  content: MailContent,
  origin: string,
  tag = 'mail',
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[${tag}] no mail key, would send to ${to}: ${content.subject}`);
    return { ok: true, logged: true };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        subject: content.subject,
        text: textBody(content),
        html: htmlBody(content, origin),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // Never log the address or the link on failure. The status is enough.
      console.error(`[${tag}] Resend refused the send: ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false, error: `Mail service returned ${res.status}` };
    }
    // The id is the thread to pull in the Resend dashboard when someone says
    // the mail never came. It identifies the message, not the person.
    const accepted = (await res.json()) as { id?: string };
    console.log(`[${tag}] Resend accepted the send, id ${accepted.id ?? 'unknown'}`);
    return { ok: true };
  } catch (err) {
    console.error(`[${tag}] Resend request failed:`, err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not reach the mail service' };
  }
}

/** The sign-in email. */
export async function sendLoginLink(
  to: string,
  link: string,
  minutes: number,
): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    // Local development. The link is the whole point, so make it easy to copy.
    console.log(`[auth] sign-in link for ${to}: ${link}`);
    return { ok: true, logged: true };
  }
  const content: MailContent = {
    subject: 'Your FBB Scores sign-in link',
    preheader: `Your sign-in link. It works once and runs out in ${minutes} minutes.`,
    heading: 'Tap to sign in',
    lines: ['No PIN to remember. This link signs you in on this phone.'],
    textLines: ['Tap this link to sign in to FBB Scores.'],
    action: { label: 'SIGN IN', href: link },
    notes: [
      `It works once and runs out in ${minutes} minutes.`,
      'If you did not ask for it, ignore this email. Nothing happens.',
    ],
    paste: link,
  };
  // The logo has to load from somewhere a mail client can reach, and the link
  // already points at exactly that host.
  return sendMail(to, content, new URL(link).origin, 'auth');
}

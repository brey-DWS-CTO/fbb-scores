/**
 * Sending sign-in links.
 *
 * Resend when RESEND_API_KEY is set, which is production. Without a key the
 * link is written to the server log instead, so local work needs no account
 * and no mail ever leaves the machine.
 *
 * There is no SDK here on purpose. Resend's send call is one POST, and one
 * fetch is cheaper to read than a dependency.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendResult {
  ok: boolean;
  /** True when nothing was sent because no key is configured. */
  logged?: boolean;
  error?: string;
}

function fromAddress(): string {
  return process.env.LEAGUE_MAIL_FROM ?? 'The Nerds <onboarding@resend.dev>';
}

function textBody(link: string, minutes: number): string {
  return [
    'THE NERDS',
    '',
    'Tap this link to sign in to FBB Scores.',
    '',
    link,
    '',
    `It works once and runs out in ${minutes} minutes.`,
    'If you did not ask for it, ignore this email. Nothing happens.',
  ].join('\n');
}

/**
 * The sign-in email.
 *
 * Written for mail clients, not browsers, so it is tables and inline styles.
 * A styled anchor is not a button in Outlook, and anything in a stylesheet is
 * thrown away. The logo is a transparent PNG with dark metal in it, so the
 * card behind it has to be dark or the badge loses its edges.
 */
function htmlBody(link: string, minutes: number, origin: string): string {
  const bg = '#08080c';
  const card = '#12121a';
  const border = '#262633';
  const teal = '#00ffcc';
  const text = '#f0f0f5';
  const dim = '#8888aa';
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return `<!-- Shown in the inbox list, before anyone opens anything. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your sign-in link. It works once and runs out in ${minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};margin:0;padding:24px 12px">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px;background:${card};border:1px solid ${border};border-radius:16px">
        <tr>
          <td align="center" style="padding:28px 24px 8px">
            <img src="${origin}/logo.png" width="220" alt="FBB Scores, The Nerds" style="display:block;width:220px;max-width:80%;height:auto;border:0" />
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 28px 0;font-family:${font};font-size:20px;font-weight:700;color:${text}">
            Tap to sign in
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 28px 0;font-family:${font};font-size:15px;line-height:1.5;color:${dim}">
            No PIN to remember. This link signs you in on this phone.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 28px 0">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${teal}" style="border-radius:10px">
                  <a href="${link}" style="display:inline-block;padding:15px 34px;font-family:${font};font-size:15px;font-weight:800;letter-spacing:0.08em;color:#08080c;text-decoration:none;border-radius:10px">SIGN IN</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 28px 0;font-family:${font};font-size:13px;line-height:1.5;color:${dim}">
            It works once and runs out in ${minutes} minutes.<br />
            If you did not ask for it, ignore this email. Nothing happens.
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 24px 26px">
            <div style="font-family:${font};font-size:11px;color:#55556a;word-break:break-all;line-height:1.5">
              Button not working? Paste this:<br />${link}
            </div>
          </td>
        </tr>
      </table>
      <div style="padding:16px 8px 0;font-family:${font};font-size:11px;letter-spacing:0.14em;color:#44445a">
        THE NERDS &middot; EST. 2010
      </div>
    </td>
  </tr>
</table>`;
}

export async function sendLoginLink(
  to: string,
  link: string,
  minutes: number,
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Local development. The link is the whole point, so make it easy to copy.
    console.log(`[auth] sign-in link for ${to}: ${link}`);
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
        subject: 'Your FBB Scores sign-in link',
        text: textBody(link, minutes),
        // The logo has to load from somewhere a mail client can reach, and the
        // link already points at exactly that host.
        html: htmlBody(link, minutes, new URL(link).origin),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // Never log the address or the link on failure. The status is enough.
      console.error(`[auth] Resend refused the send: ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false, error: `Mail service returned ${res.status}` };
    }
    // The id is the thread to pull in the Resend dashboard when someone says
    // the mail never came. It identifies the message, not the person.
    const accepted = (await res.json()) as { id?: string };
    console.log(`[auth] Resend accepted the send, id ${accepted.id ?? 'unknown'}`);
    return { ok: true };
  } catch (err) {
    console.error('[auth] Resend request failed:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not reach the mail service' };
  }
}

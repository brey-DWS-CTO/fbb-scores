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
    'Tap this link to sign in to FBB Scores.',
    '',
    link,
    '',
    `The link works once and expires in ${minutes} minutes.`,
    'If you did not ask for it, you can ignore this email.',
  ].join('\n');
}

function htmlBody(link: string, minutes: number): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#111">
  <p>Tap the button to sign in to FBB Scores.</p>
  <p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111;color:#fff;text-decoration:none;font-weight:700">Sign in</a></p>
  <p style="color:#555;font-size:14px">The link works once and expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.</p>
  <p style="color:#888;font-size:12px;word-break:break-all">${link}</p>
</div>`;
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
        html: htmlBody(link, minutes),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // Never log the address or the link on failure. The status is enough.
      console.error(`[auth] Resend refused the send: ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false, error: `Mail service returned ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[auth] Resend request failed:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Could not reach the mail service' };
  }
}

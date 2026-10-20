/**
 * One-line posts to the league's Slack channel through an incoming webhook.
 *
 * `SLACK_WEBHOOK_URL` in Vercel points at #fbb-scores. With it unset nothing
 * is sent and the caller never knows: a missing webhook must not break the
 * clock. A failed post is logged and swallowed for the same reason.
 */
import axios from 'axios';

export async function postToSlack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log(`[slack] no webhook, would have said: ${text}`);
    return false;
  }
  try {
    await axios.post(url, { text }, { timeout: 8_000 });
    return true;
  } catch (err) {
    console.error('[slack] post failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

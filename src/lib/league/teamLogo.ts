/**
 * Where a fantasy team's logo loads from. Owners set logos on ESPN, and two
 * kinds break in the browser:
 *
 * - A logo uploaded to ESPN needs an ESPN sign-in, so the browser gets a 401.
 *   Our server fetches it with the league's sign-in instead.
 * - Wikipedia serves thumbnails only at its standard widths. Any other width
 *   gets a 400, so we ask for 120px, which covers every size we draw.
 *
 * Pure. No server, no browser.
 */

const ESPN_UPLOAD = /^https:\/\/mystique-api\.fantasy\.espn\.com\/apis\/v1\/domains\/lm\/images\/([0-9a-f-]{36})$/i;
const WIKI_THUMB = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^?#]+\/thumb\/[^?#]+\/)\d+px-([^/?#]+)$/;

/** The id of a logo uploaded to ESPN, or null for any other address. */
export function espnUploadId(url: string): string | null {
  return ESPN_UPLOAD.exec(url)?.[1]?.toLowerCase() ?? null;
}

/** True for an id the logo route will fetch: one ESPN upload, nothing else. */
export function isEspnUploadId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

export function espnUploadUrl(id: string): string {
  return `https://mystique-api.fantasy.espn.com/apis/v1/domains/lm/images/${id}`;
}

/** The address the browser should load. Null when the team has no logo. */
export function teamLogoSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const upload = espnUploadId(url);
  if (upload) return `/api/espn/team-logo/${upload}`;
  const wiki = WIKI_THUMB.exec(url);
  if (wiki) return `${wiki[1]}120px-${wiki[2]}`;
  return url;
}

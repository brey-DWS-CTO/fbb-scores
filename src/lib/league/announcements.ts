/**
 * One-time league announcements, sent by the hourly mail run.
 *
 * Each goes to each member once. The send key is claimed before the mail goes
 * out, the same as the deadline reminders, so a retry or a second server can
 * never mail anyone twice. An announcement only goes out inside its window,
 * so an old one never surprises anyone after the fact.
 *
 * Pure. No server, no browser.
 */

export interface Announcement {
  id: string;
  /** Not before this moment. */
  from: string;
  /** Not after this moment. */
  until: string;
  subject: string;
  preheader: string;
  heading: string;
  lines: string[];
  actionLabel: string;
  /** Path in the app the button opens. */
  actionPath: string;
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: 'vault-2027',
    // 4 PM Pacific on 15 October 2026, when this ships.
    from: '2026-10-15T23:00:00.000Z',
    // The draft. After that, reveals mean nothing.
    until: '2026-10-18T21:00:00.000Z',
    subject: 'New: achievements, keeper reveals and prop bets 🏀',
    preheader: 'Tap the new VAULT button. Some of you have reveals waiting.',
    heading: 'The VAULT is open',
    lines: [
      'Achievements: 22 to earn. Each one reveals one keeper from a random team. Run mocks, make trade offers, vote, set props. Stuff you have already done counts, so some of you have reveals waiting.',
      'Prop bets: set an over/under on anyone, then take sides. You will never see the ones about you.',
      'Keepers due Saturday 2 PM. Draft Sunday 2 PM. Go spin!',
    ],
    actionLabel: 'OPEN THE VAULT',
    actionPath: '/achievements',
  },
];

export function announcementKey(id: string, owner: string): string {
  return `announce-${id}-${owner}`;
}

/** Who still needs which announcement right now. */
export function dueAnnouncements(input: {
  now: Date;
  owners: readonly string[];
  alreadySent: readonly string[];
  list?: readonly Announcement[];
}): Array<{ announcement: Announcement; owner: string; key: string }> {
  const sent = new Set(input.alreadySent);
  const at = input.now.getTime();
  const out: Array<{ announcement: Announcement; owner: string; key: string }> = [];
  for (const announcement of input.list ?? ANNOUNCEMENTS) {
    if (at < Date.parse(announcement.from) || at > Date.parse(announcement.until)) continue;
    for (const owner of input.owners) {
      const key = announcementKey(announcement.id, owner);
      if (!sent.has(key)) out.push({ announcement, owner, key });
    }
  }
  return out;
}

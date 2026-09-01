/**
 * Signing a published rule book.
 *
 * A signature binds four things to ONE frozen version: who signed, when, the
 * exact words they agreed to, and the version's fingerprint. It is written
 * once and never touched again, so the acknowledgement text is stored on the
 * row rather than read from here at display time. Change the wording later and
 * old signatures still show what those members actually agreed to.
 *
 * Signatures never carry forward. Publishing a new revision means the book
 * everyone agreed to no longer exists, so the whole league signs again. That
 * is the point of signing a version rather than a document.
 *
 * Pure and shared by client and server, so the count a member sees is the one
 * the server enforces.
 */

import type { Rulebook } from './rulebook.js';

/** The words a member agrees to. Stored on every signature as it stood then. */
export const ACKNOWLEDGEMENT =
  'I have read this revision of The Nerds constitution and I agree to play by it for this season.';

export interface RulebookSignature {
  season: number;
  /** The one immutable published version this binds to. */
  versionId: string;
  revision: number;
  /** The version's stored fingerprint, so a swapped book cannot pass as signed. */
  fingerprint: string;
  owner: string;
  acknowledgement: string;
  signedAt: string;
}

export type SignRefusal =
  | 'not-a-member'
  | 'nothing-published'
  | 'not-current'
  | 'wrong-fingerprint'
  | 'no-acknowledgement'
  | 'already-signed';

export interface SignCheck {
  ok: boolean;
  reason?: SignRefusal;
  message?: string;
}

/**
 * Whether `owner` may sign right now.
 *
 * Members sign the revision that is live. Signing an old one is refused, both
 * because it would say nothing about the rules in force and because it would
 * let a stale tab record agreement to a book nobody reads.
 */
export function canSign(input: {
  owner: string;
  members: string[];
  /** The latest published version, or null when nothing is published yet. */
  current: { versionId: string; fingerprint: string } | null;
  versionId: string;
  fingerprint: string;
  acknowledgement: string;
  signatures: RulebookSignature[];
}): SignCheck {
  if (!input.members.includes(input.owner)) {
    return { ok: false, reason: 'not-a-member', message: 'Only league members can sign.' };
  }
  if (!input.current) {
    return {
      ok: false,
      reason: 'nothing-published',
      message: 'Nothing is published yet, so there is nothing to sign.',
    };
  }
  if (input.versionId !== input.current.versionId) {
    return {
      ok: false,
      reason: 'not-current',
      message: 'A newer revision is out. Reload and sign that one.',
    };
  }
  if (input.fingerprint !== input.current.fingerprint) {
    return {
      ok: false,
      reason: 'wrong-fingerprint',
      message: 'That is not the book on file. Reload and try again.',
    };
  }
  if (!input.acknowledgement.trim()) {
    return {
      ok: false,
      reason: 'no-acknowledgement',
      message: 'A signature needs the words being agreed to.',
    };
  }
  if (signatureOf(input.signatures, input.owner, input.versionId)) {
    return { ok: false, reason: 'already-signed', message: 'You have already signed this revision.' };
  }
  return { ok: true };
}

/** One member's signature on one version, if it exists. */
export function signatureOf(
  signatures: RulebookSignature[],
  owner: string,
  versionId: string,
): RulebookSignature | undefined {
  return signatures.find((s) => s.owner === owner && s.versionId === versionId);
}

export interface SignatureStatus {
  versionId: string | null;
  /** Signatures on this version, in league order. */
  signed: RulebookSignature[];
  /** Members who have not signed this version, in league order. */
  missing: string[];
  total: number;
  complete: boolean;
}

/** Who has signed a given version and who has not. */
export function signatureStatus(
  members: string[],
  signatures: RulebookSignature[],
  versionId: string | null,
): SignatureStatus {
  const onVersion = versionId ? signatures.filter((s) => s.versionId === versionId) : [];
  const byOwner = new Map(onVersion.map((s) => [s.owner, s]));
  const signed = members
    .map((owner) => byOwner.get(owner))
    .filter((s): s is RulebookSignature => s !== undefined);
  const missing = members.filter((owner) => !byOwner.has(owner));
  return {
    versionId,
    signed,
    missing,
    total: members.length,
    complete: versionId !== null && missing.length === 0,
  };
}

/** A one-line count for a heading, a print block, or a chip. */
export function describeSignatures(status: SignatureStatus): string {
  if (!status.versionId) return 'Nothing published yet, so nobody has signed.';
  if (status.complete) return `All ${status.total} teams have signed.`;
  return `${status.signed.length} of ${status.total} teams have signed.`;
}

/** The row a signature becomes, built from the version being signed. */
export function makeSignature(input: {
  season: number;
  versionId: string;
  revision: number;
  fingerprint: string;
  owner: string;
  acknowledgement: string;
  signedAt: string;
}): RulebookSignature {
  return {
    season: input.season,
    versionId: input.versionId,
    revision: input.revision,
    fingerprint: input.fingerprint,
    owner: input.owner,
    acknowledgement: input.acknowledgement,
    signedAt: input.signedAt,
  };
}

/** The line the printed book carries under its title. */
export function printedRevisionLine(book: Rulebook, publishedAt: string | null): string {
  const when = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    : null;
  const state = book.status === 'published' ? 'Published' : 'Working draft, not ratified';
  return when ? `Revision ${book.revision} · ${state} ${when}` : `Revision ${book.revision} · ${state}`;
}

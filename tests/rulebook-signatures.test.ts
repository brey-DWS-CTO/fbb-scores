import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACKNOWLEDGEMENT,
  canSign,
  describeSignatures,
  makeSignature,
  printedRevisionLine,
  signatureOf,
  signatureStatus,
  type RulebookSignature,
} from '../src/lib/league/rulebookSignatures.js';
import { rulebook2027 } from '../src/lib/league/rulebookData.js';

const MEMBERS = ['Joel', 'Ryan', 'Patrick', 'Bryan', 'Kyle', 'Dustin', 'Aaron', 'Derek', 'Brey', 'Amy'];

const CURRENT = { versionId: 'rb-2027-r14-aaaa', fingerprint: 'rb_1111_x' };

function signature(owner: string, over: Partial<RulebookSignature> = {}): RulebookSignature {
  return makeSignature({
    season: 2027,
    versionId: CURRENT.versionId,
    revision: 14,
    fingerprint: CURRENT.fingerprint,
    owner,
    acknowledgement: ACKNOWLEDGEMENT,
    signedAt: '2026-09-02T00:00:00.000Z',
    ...over,
  });
}

const check = (over: Partial<Parameters<typeof canSign>[0]> = {}) =>
  canSign({
    owner: 'Ryan',
    members: MEMBERS,
    current: CURRENT,
    versionId: CURRENT.versionId,
    fingerprint: CURRENT.fingerprint,
    acknowledgement: ACKNOWLEDGEMENT,
    signatures: [],
    ...over,
  });

// ─── Who may sign ──────────────────────────────────────────────────────────

test('a member signs the revision in force', () => {
  assert.equal(check().ok, true);
});

test('a stranger cannot sign', () => {
  assert.equal(check({ owner: 'Stranger' }).reason, 'not-a-member');
});

test('there is nothing to sign before the first publish', () => {
  assert.equal(check({ current: null }).reason, 'nothing-published');
});

test('an old revision cannot be signed', () => {
  assert.equal(check({ versionId: 'rb-2027-r13-old' }).reason, 'not-current');
});

test('a book that does not match the version on file is refused', () => {
  assert.equal(check({ fingerprint: 'rb_9999_y' }).reason, 'wrong-fingerprint');
});

test('a signature needs the words being agreed to', () => {
  assert.equal(check({ acknowledgement: '   ' }).reason, 'no-acknowledgement');
});

test('nobody signs the same revision twice', () => {
  const again = check({ signatures: [signature('Ryan')] });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-signed');
});

test('somebody else signing does not use up your signature', () => {
  assert.equal(check({ signatures: [signature('Amy')] }).ok, true);
});

// ─── Standing ──────────────────────────────────────────────────────────────

test('status splits the league into signed and not signed, in league order', () => {
  const status = signatureStatus(MEMBERS, [signature('Amy'), signature('Joel')], CURRENT.versionId);
  assert.deepEqual(status.signed.map((s) => s.owner), ['Joel', 'Amy'], 'league order, not signing order');
  assert.equal(status.missing.length, 8);
  assert.equal(status.complete, false);
  assert.equal(describeSignatures(status), '2 of 10 teams have signed.');
});

test('a full league reads as complete', () => {
  const all = MEMBERS.map((owner) => signature(owner));
  const status = signatureStatus(MEMBERS, all, CURRENT.versionId);
  assert.equal(status.complete, true);
  assert.equal(describeSignatures(status), 'All 10 teams have signed.');
});

test('signatures never carry to a later revision', () => {
  const old = MEMBERS.map((owner) => signature(owner));
  const next = signatureStatus(MEMBERS, old, 'rb-2027-r15-bbbb');
  assert.equal(next.signed.length, 0, 'publishing again means signing again');
  assert.deepEqual(next.missing, MEMBERS);
  assert.equal(next.complete, false);
});

test('with nothing published nobody has signed anything', () => {
  const status = signatureStatus(MEMBERS, [signature('Amy')], null);
  assert.equal(status.signed.length, 0);
  assert.equal(status.complete, false);
  assert.equal(describeSignatures(status), 'Nothing published yet, so nobody has signed.');
});

test('a signature is found by owner and version together', () => {
  const rows = [signature('Amy'), signature('Amy', { versionId: 'rb-2027-r13-old' })];
  assert.equal(signatureOf(rows, 'Amy', CURRENT.versionId)?.versionId, CURRENT.versionId);
  assert.equal(signatureOf(rows, 'Joel', CURRENT.versionId), undefined);
});

test('a signature keeps the words as they read when it was made', () => {
  const row = signature('Amy', { acknowledgement: 'Older wording.' });
  assert.equal(row.acknowledgement, 'Older wording.');
  assert.notEqual(row.acknowledgement, ACKNOWLEDGEMENT);
});

// ─── The printed line ──────────────────────────────────────────────────────

test('the printed line says which revision and whether it is published', () => {
  const draft = printedRevisionLine(rulebook2027, null);
  assert.match(draft, /Revision 14/);
  assert.match(draft, /Working draft/);

  const published = printedRevisionLine(
    { ...rulebook2027, status: 'published' },
    '2026-09-02T00:00:00.000Z',
  );
  assert.match(published, /Published/);
  assert.match(published, /2026/);
});

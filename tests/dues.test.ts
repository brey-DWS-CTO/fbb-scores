import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUES_FULL,
  DUES_HALF,
  applyDuesAction,
  blankDuesRow,
  duesBoard,
  duesStatus,
  parseVenmoHandle,
  venmoPayUrl,
  type DuesAction,
  type DuesRow,
} from '../src/lib/league/dues.ts';

const NOW = '2026-10-11T18:00:00.000Z';
const blank = (owner: string) => blankDuesRow(2027, owner);

function run(row: DuesRow, action: DuesAction, actor: string, isCommissioner = false, rows: DuesRow[] = []) {
  return applyDuesAction({ row, action, actor, isCommissioner, now: NOW, rows });
}

function ok(result: ReturnType<typeof run>): DuesRow {
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.row;
}

test('a member marks their own team paid, and may take it back', () => {
  const paid = ok(run(blank('Joel'), 'paid', 'Joel'));
  assert.equal(duesStatus(paid), 'paid');
  assert.equal(paid.paidAt, NOW);
  const undone = ok(run(paid, 'unpaid', 'Joel'));
  assert.equal(duesStatus(undone), 'unpaid');
});

test('a member cannot mark another team paid', () => {
  const result = run(blank('Joel'), 'paid', 'Amy');
  assert.equal(result.ok, false);
  assert.equal(result.ok ? 0 : result.status, 403);
});

test('only a commissioner confirms, and a member cannot undo a confirmed payment', () => {
  const paid = ok(run(blank('Joel'), 'paid', 'Joel'));
  assert.equal(run(paid, 'verify', 'Joel').ok, false, 'members cannot confirm their own');
  assert.equal(run(paid, 'verify', 'Ryan').ok, false, 'Ryan is not a commissioner yet');
  const confirmed = ok(run(paid, 'verify', 'Brey', true));
  assert.equal(duesStatus(confirmed), 'verified');
  assert.equal(confirmed.verifiedBy, 'Brey');
  assert.equal(run(confirmed, 'unpaid', 'Joel').ok, false);
  assert.equal(duesStatus(ok(run(confirmed, 'unverify', 'Brey', true))), 'paid');
});

test('confirming a team that never tapped I PAID records it as paid', () => {
  const confirmed = ok(run(blank('Amy'), 'verify', 'Brey', true));
  assert.equal(confirmed.paidAt, NOW);
  assert.equal(duesStatus(confirmed), 'verified');
});

test('NOT RECEIVED clears a member claim', () => {
  const paid = ok(run(blank('Joel'), 'paid', 'Joel'));
  const cleared = ok(run(paid, 'unpaid', 'Brey', true));
  assert.equal(cleared.paidAt, null);
});

test('the half fee goes to two teams at most', () => {
  const a = ok(run(blank('Joel'), 'half', 'Brey', true));
  const b = ok(run(blank('Amy'), 'half', 'Brey', true, [a]));
  const third = run(blank('Kyle'), 'half', 'Brey', true, [a, b]);
  assert.equal(third.ok, false);
  assert.equal(run(blank('Kyle'), 'half', 'Kyle').ok, false, 'members cannot grant themselves half');
});

test('the board fills in teams with no row and adds up what is confirmed', () => {
  const joel = ok(run(blank('Joel'), 'verify', 'Brey', true));
  const amy = ok(run(ok(run(blank('Amy'), 'half', 'Brey', true)), 'paid', 'Amy'));
  const board = duesBoard(2027, ['Joel', 'Amy', 'Kyle'], [joel, amy]);
  assert.deepEqual(
    board.lines.map((l) => [l.owner, l.status, l.amount]),
    [
      ['Joel', 'verified', DUES_FULL],
      ['Amy', 'paid', DUES_HALF],
      ['Kyle', 'unpaid', DUES_FULL],
    ],
  );
  assert.equal(board.paid, 2);
  assert.equal(board.verified, 1);
  assert.equal(board.collected, DUES_FULL);
  assert.equal(board.expected, DUES_FULL * 2 + DUES_HALF);
});

test('a Venmo username comes out of a link, an @name, or a bare name', () => {
  assert.equal(parseVenmoHandle('https://venmo.com/u/keyes209'), 'keyes209');
  assert.equal(parseVenmoHandle('venmo.com/keyes209'), 'keyes209');
  assert.equal(parseVenmoHandle('@keyes209'), 'keyes209');
  assert.equal(parseVenmoHandle(' keyes209 '), 'keyes209');
  assert.equal(parseVenmoHandle('https://example.com/u/keyes209'), null);
  assert.equal(parseVenmoHandle('two words'), null);
  assert.equal(parseVenmoHandle(''), null);
});

test('the pay link fills in the amount and a note', () => {
  const url = new URL(venmoPayUrl('keyes209', 304, 'Nerds 2027 dues - Joel'));
  assert.equal(url.origin + url.pathname, 'https://venmo.com/u/keyes209');
  assert.equal(url.searchParams.get('txn'), 'pay');
  assert.equal(url.searchParams.get('amount'), '304');
  assert.equal(url.searchParams.get('note'), 'Nerds 2027 dues - Joel');
});

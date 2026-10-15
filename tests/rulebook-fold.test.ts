import assert from 'node:assert/strict';
import test from 'node:test';
import { foldProblem, foldedBook } from '../src/lib/league/rulebookFold.ts';

const r15 = { id: 'rb-2027-r15-a', revision: 15 };
const r16 = { id: 'rb-2027-r16-b', revision: 16 };

test('the newest revision folds into the one before it while nobody has signed it', () => {
  assert.equal(foldProblem(r16, r15, r16.id, 0), null);
});

test('a fold is refused once anyone signs, on a stale page, or with nothing before it', () => {
  assert.match(foldProblem(r16, r15, r16.id, 1) ?? '', /signed revision 16/);
  assert.match(foldProblem(r16, r15, r15.id, 0) ?? '', /newer revision/);
  assert.match(foldProblem(r15, null, r15.id, 0) ?? '', /first one/);
  assert.match(foldProblem(null, null, 'x', 0) ?? '', /Nothing is published/);
});

test('the folded book carries the older revision number and the newer text', () => {
  const book = { revision: 16, status: 'published', articles: [{ id: 'a' }] };
  assert.deepEqual(foldedBook(book, 15), { revision: 15, status: 'published', articles: [{ id: 'a' }] });
  assert.equal(book.revision, 16);
});

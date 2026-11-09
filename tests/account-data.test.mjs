import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the browser ES module without requiring a package manager or package.json.
const source = await readFile(new URL('../account-data.js', import.meta.url), 'utf8');
const { parseAccounts, serializeAccounts } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const row = { bank: '테스트은행', accountNumber: '001-234-567', name: '테스트', notes: '메모' };

test('backup round trip preserves leading zeros, Korean and punctuation', () => {
  assert.deepEqual(parseAccounts(serializeAccounts([row])), [row]);
});
test('empty list and UTF-8 BOM backups can be restored', () => {
  assert.deepEqual(parseAccounts('\uFEFF[]'), []);
});
test('optional notes defaults to an empty string', () => {
  const { notes, ...required } = row;
  assert.deepEqual(parseAccounts(JSON.stringify([required])), [{ ...required, notes: '' }]);
});
test('numeric account numbers are rejected instead of losing their formatting', () => {
  assert.throws(() => parseAccounts(JSON.stringify([{ ...row, accountNumber: 123 }])));
});
test('unsupported fields and malformed documents do not silently lose data', () => {
  for (const value of [null, {}, [null], [{ ...row, extra: 'retain me' }], [{ ...row, bank: ' ' }], [{ ...row, notes: 1 }]]) {
    assert.throws(() => parseAccounts(JSON.stringify(value)));
  }
  assert.throws(() => parseAccounts('{'));
});
test('deletions and edits appear in the exported snapshot', () => {
  const rows = [row, { ...row, name: '두번째' }];
  rows.splice(0, 1); rows[0].notes = '수정';
  assert.deepEqual(parseAccounts(serializeAccounts(rows)), [{ ...row, name: '두번째', notes: '수정' }]);
});

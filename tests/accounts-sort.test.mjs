import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../accounts-sort.js', import.meta.url), 'utf8');
const { sortedAccountView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const rows = [
  { bank: '하나은행', accountNumber: '001234567890123458', name: '홍길동', notes: '부서10' },
  { bank: '국민은행', accountNumber: '001234567890123457', name: '김가나', notes: '부서2' },
  { bank: '국민은행', accountNumber: '001234567890123456', name: '김가나', notes: '' }
];
test('sorts all account columns while preserving original indexes and stable ties', () => {
  assert.deepEqual(sortedAccountView(rows, 'bank').map(x => x.index), [1, 2, 0]);
  assert.deepEqual(sortedAccountView(rows, 'bank', 'descending').map(x => x.index), [0, 1, 2]);
  assert.deepEqual(sortedAccountView(rows, 'accountNumber').map(x => x.index), [2, 1, 0]);
  assert.deepEqual(sortedAccountView(rows, 'name').map(x => x.index), [1, 2, 0]);
  assert.deepEqual(sortedAccountView(rows, 'notes').map(x => x.index), [2, 1, 0]);
  assert.deepEqual(sortedAccountView(rows, 'order', 'descending').map(x => x.index), [2, 1, 0]);
});
test('display sorting preserves JSON order, long account strings and editing identity', () => {
  const before = JSON.stringify(rows);
  const firstVisible = sortedAccountView(rows, 'accountNumber')[0];
  assert.equal(firstVisible.row, rows[2]);
  assert.equal(firstVisible.index, 2);
  assert.equal(firstVisible.row.accountNumber, '001234567890123456');
  assert.equal(JSON.stringify(rows), before);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.mini.min.js');
const load = async path => import(`data:text/javascript;base64,${Buffer.from(await readFile(new URL(path, import.meta.url))).toString('base64')}`);
const { findAccounts, createTransferWorkbook } = await load('../transfer-data.js');
const { parseAccounts, serializeAccounts } = await load('../account-data.js');
const source = [
  { bank: '테스트은행', accountNumber: '001234567890123456', name: '테스트하나', notes: '교육위원회' },
  { bank: '가상은행', accountNumber: '00987654321', name: '테스트둘', notes: '교육부 ABC' },
  { bank: '가상은행', accountNumber: '003333', name: '=1+1', notes: '<메모>&자료' }
];

test('substring search covers each field, no matches, unique and multiple matches', () => {
  assert.deepEqual(findAccounts(source, '없는항목'), []);
  assert.deepEqual(findAccounts(source, '   '), []);
  assert.deepEqual(findAccounts(source, '테스트은행'), [source[0]]);
  assert.deepEqual(findAccounts(source, '1234567890123456'), [source[0]]);
  assert.deepEqual(findAccounts(source, '하나'), [source[0]]);
  assert.deepEqual(findAccounts(source, '교육'), source.slice(0, 2));
  assert.deepEqual(findAccounts(source, ' abc '), [source[1]]);
  assert.deepEqual(findAccounts(source, '교육'.normalize('NFD')), source.slice(0, 2));
});
test('search does not join fields or mutate the source', () => {
  assert.deepEqual(findAccounts(source, '테스트은행001'), []);
  const selected = { ...findAccounts(source, '하나')[0] };
  selected.notes = '작업 메모';
  assert.equal(source[0].notes, '교육위원회');
});
test('JSON round trip contains only four fields and keeps order and duplicate rows', () => {
  const rows = [source[1], source[0], source[1]];
  assert.deepEqual(parseAccounts(serializeAccounts(rows)), rows);
  assert.deepEqual(Object.keys(JSON.parse(serializeAccounts(rows))[0]), ['bank', 'accountNumber', 'name', 'notes']);
});
test('generated XLSX round trip preserves text account numbers and literal formula-like names', () => {
  const workbook = createTransferWorkbook(XLSX, source);
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
  assert.equal(new TextDecoder().decode(output.subarray(0, 2)), 'PK');
  const restored = XLSX.read(output, { type: 'buffer', cellNF: true });
  const sheet = restored.Sheets['주일경상비'];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [
    ['은행', '계좌번호', '이름', '기타'],
    ...source.map(row => [row.bank, row.accountNumber, row.name, row.notes])
  ]);
  assert.equal(sheet.B2.t, 's');
  assert.equal(sheet.B2.v, '001234567890123456');
  assert.equal(sheet.C4.t, 's');
  assert.equal(sheet.C4.v, '=1+1');
  assert.equal(sheet.C4.f, undefined);
  assert.equal(sheet['!autofilter'].ref, 'A1:D4');
});

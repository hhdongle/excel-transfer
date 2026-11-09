import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const browser = {};
runInNewContext(await readFile(new URL('../vendor/xlsx-style.bundle.js', import.meta.url), 'utf8'), browser);
const XLSX = browser.XLSX;
const reader = require('../vendor/xlsx.mini.min.js');
const accountSource = await readFile(new URL('../account-data.js', import.meta.url), 'utf8');
const accountURL = `data:text/javascript;base64,${Buffer.from(accountSource).toString('base64')}`;
const transferSource = (await readFile(new URL('../transfer-data.js', import.meta.url), 'utf8')).replace("'./account-data.js'", JSON.stringify(accountURL));
const { findAccounts, createTransferWorkbook, parseAmount, parseTransferRows, serializeTransferRows } = await import(`data:text/javascript;base64,${Buffer.from(transferSource).toString('base64')}`);
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
test('work JSON preserves amount, notes, order and duplicates without display numbers', () => {
  const rows = [{ ...source[1], amount: 7708000 }, { ...source[0], amount: null }, { ...source[1], amount: 200000 }];
  assert.deepEqual(parseTransferRows(serializeTransferRows(rows)), rows);
  assert.deepEqual(Object.keys(JSON.parse(serializeTransferRows(rows))[0]), ['bank', 'accountNumber', 'name', 'notes', 'amount']);
});
test('old four-field JSON can be imported with blank amounts', () => {
  assert.deepEqual(parseTransferRows(JSON.stringify(source)), source.map(row => ({ ...row, amount: null })));
});
test('amounts accept integers and correctly grouped commas, reject malformed and unsafe values', () => {
  assert.equal(parseAmount('7,708,000'), 7708000);
  assert.equal(parseAmount('200000'), 200000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(0), 0);
  for (const value of ['1,23', '-1', '1.5', '1e5', 'abc', true, 0.1, -1, Infinity, 1000000000000000]) assert.throws(() => parseAmount(value));
});
test('XLSX export requires positive amounts in all rows', () => {
  for (const amount of [undefined, null, '', 0, -1, 'bad']) assert.throws(() => createTransferWorkbook(XLSX, [{ ...source[0], amount }]));
});
test('export errors identify the actual row to focus for missing or invalid amounts', () => {
  for (const amount of [null, 0, 'invalid']) {
    assert.throws(() => createTransferWorkbook(XLSX, [
      { ...source[0], amount: 200000 }, { ...source[1], amount }
    ]), error => error.rowIndex === 1 && error.message.includes('2번'));
  }
});
test('XLSX matches four-column headerless layout and preserves typed amounts and text accounts', () => {
  const rows = source.map((row, index) => ({ ...row, amount: [200000, 7708000, 114385][index] }));
  const workbook = createTransferWorkbook(XLSX, rows);
  const originalSheet = workbook.Sheets['주일경상비'];
  assert.equal(originalSheet.B1.s.border.top.style, 'thin');
  assert.equal(originalSheet.D1.s.alignment.horizontal, 'right');
  assert.equal(originalSheet.D1.s.font.bold, true);
  assert.equal(originalSheet.D1.s.fill, undefined);
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
  assert.equal(new TextDecoder().decode(output.subarray(0, 2)), 'PK');
  const restored = reader.read(output, { type: 'buffer', cellNF: true });
  const sheet = restored.Sheets['주일경상비'];
  assert.deepEqual(reader.utils.sheet_to_json(sheet, { header: 1 }), rows.map(row => [row.bank, row.accountNumber, row.name, row.amount]));
  assert.equal(sheet.B1.t, 's');
  assert.equal(sheet.B1.v, '001234567890123456');
  assert.equal(sheet.C3.t, 's');
  assert.equal(sheet.C3.v, '=1+1');
  assert.equal(sheet.C3.f, undefined);
  assert.equal(sheet.D1.t, 'n');
  assert.equal(sheet.D1.v, 200000);
  assert.equal(sheet.D1.z, '#,##0');
  assert.equal(sheet.D2.w, '7,708,000');
  assert.equal(sheet['!ref'], 'A1:D3');
  assert.equal(sheet['!autofilter'], undefined);
});

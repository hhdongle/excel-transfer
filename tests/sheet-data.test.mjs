import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../sheet-data.js', import.meta.url), 'utf8');
const { parseTSV, serializeTSV, columnName } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('Excel TSV preserves leading zeros, Korean, empty cells and CRLF', () => {
  assert.deepEqual(parseTSV('은행\t계좌\t이름\r\n국민은행\t001234\t홍길동\r\n농협\t\t김철수\r\n'), [
    ['은행','계좌','이름'], ['국민은행','001234','홍길동'], ['농협','','김철수']
  ]);
  assert.deepEqual(parseTSV('a\t\r\n\t\r\n'), [['a',''],['','']]);
});
test('Excel quoted multiline cells and literal quotes round trip', () => {
  const rows = [['첫째\n둘째','탭\t포함','그는 "네"라고 말했다'],['001','', '=SUM(A1:A2)']];
  assert.deepEqual(parseTSV(serializeTSV(rows)), rows);
  assert.deepEqual(parseTSV('"a\nb"\t""\r\n'), [['a\nb','']]);
});
test('single cells, ragged rows and spreadsheet column letters', () => {
  assert.deepEqual(parseTSV(''), [['']]);
  assert.deepEqual(parseTSV('00123'), [['00123']]);
  assert.deepEqual(parseTSV('a\tb\nc'), [['a','b'],['c','']]);
  assert.equal(columnName(0),'A'); assert.equal(columnName(25),'Z');
  assert.equal(columnName(26),'AA'); assert.equal(columnName(99),'CV');
});

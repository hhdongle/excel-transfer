import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../income-resolution-data.js', import.meta.url), 'utf8');
const { createIncomeResolution } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const row = (name, amount) => [name,'0',String(amount),'0','0','0'];
const header = ['항목','예산','기간 결산','결산 누계','달성률(%)','차액'];
const input = () => [header,row('주일헌금',1000),row('      십일조',1000),row('기타수입',0),
  row('전기이월금',0),row('수입부 총계',1000),row('전기 이월',-200),row('수입 총계',800),[],header,
  row('인건비',300),row('      교역자생활비',200),row('            담임목사',200),row('      직원생활비',100),
  row('관리비',50),row('      영선비',50),row('차기이월금',0),row('지출부 총계',350),row('차기 이월',450),row('지출 총계',800)];
test('period amounts, negative carry and parent totals reconcile without double counting', () => {
  const data = input(), original = structuredClone(data);
  const result = createIncomeResolution(data);
  assert.equal(result[1][2],'1,000');
  assert.equal(result[1][5],'300');
  assert.equal(result[2][4],'관리비 - 영선비');
  assert.equal(result[2][5],'50');
  assert.ok(result.slice(1).every(row => row[6] === ''));
  assert.deepEqual(result.at(-1),['금주입금액','','650','','은행잔고','450','']);
  assert.deepEqual(data,original);
});
test('pasting away from A1 and empty rows preserves conversion', () => {
  const data = input();
  assert.deepEqual(createIncomeResolution([[],...data.map(row => ['',...row])]),createIncomeResolution(data));
});
test('missing tables, missing figures and inconsistent totals are rejected', () => {
  assert.throws(() => createIncomeResolution([]),/두 표/);
  const data = input(); data[1][2] = ''; assert.throws(() => createIncomeResolution(data),/금액/);
  const bad = input(); bad[2][2] = '900'; assert.throws(() => createIncomeResolution(bad),/수입 세부/);
  const balance = input(); balance.at(-2)[2] = '451'; assert.throws(() => createIncomeResolution(balance),/합계/);
});
test('lost expense indentation is rejected instead of double counting', () => {
  const data = input().map(row => row.map(value => String(value).trim()));
  assert.throws(() => createIncomeResolution(data),/지출 세부/);
});

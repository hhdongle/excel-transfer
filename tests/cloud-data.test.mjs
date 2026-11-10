import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, nextSunday, validateSunday } from '../cloud-data.js';

const account = {bank:'테스트은행', accountNumber:'001234567890123456', name:'가상 예금주', notes:'교육부'};
test('migration preserves strings, duplicates, order and isolates the saved snapshot', () => {
  const source = [account, {...account}];
  const record = makeRecord('accounts', source, null, 0, undefined, 'server-time');
  source[0].name = 'changed';
  assert.equal(record.rows[0].name, '가상 예금주');
  assert.equal(record.rows[0].accountNumber, '001234567890123456');
  assert.equal(record.rows.length, 2);
});
test('record version and original creation time are preserved and stale saves rejected', () => {
  const first = makeRecord('accounts', [], null, 0, undefined, 'first');
  const next = makeRecord('accounts', [], first, 1, undefined, 'next');
  assert.equal(next.version, 2); assert.equal(next.createdAt, 'first'); assert.equal(next.updatedAt, 'next');
  assert.throws(() => makeRecord('accounts', [], next, 1, undefined, 'third'), /다른 창/);
});
test('weekly snapshots accept draft amounts, preserve old four-field JSON and validate actual Sundays', () => {
  const record = makeRecord('week', [{...account, amount:200000}], null, 0, '2026-11-15', 'now');
  assert.equal(record.rows[0].amount, 200000);
  assert.equal(makeRecord('week', [account], null, 0, '2026-11-15', 'now').rows[0].amount, null);
  assert.equal(nextSunday('2026-11-10'), '2026-11-15');
  assert.equal(nextSunday('2026-11-15'), '2026-11-15');
  for (const date of ['2026-11-10','2026-02-30','bad','']) assert.throws(() => validateSunday(date));
});

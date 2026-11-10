import { parseAccounts } from './account-data.js';
import { parseTransferRows } from './transfer-data.js?v=20261109-export-feedback';

export function validateRows(kind, rows) {
  const text = JSON.stringify(rows);
  if (new TextEncoder().encode(text).length > 750000) throw new Error('한 번에 저장할 수 있는 자료 크기(750KB)를 초과했습니다.');
  const result = kind === 'accounts' ? parseAccounts(text) : parseTransferRows(text);
  if (result.length > 1000) throw new Error('한 목록에는 최대 1,000건까지 저장할 수 있습니다.');
  return result;
}

export function validateSunday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('주일 날짜를 선택하세요.');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 0) throw new Error('일요일 날짜를 선택하세요.');
  return value;
}

export function nextSunday(today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (7 - date.getUTCDay()) % 7);
  return date.toISOString().slice(0, 10);
}

export function makeRecord(kind, rows, previous, expectedVersion, date, now) {
  const version = previous?.version ?? 0;
  if (version !== expectedVersion) throw new Error('다른 창에서 저장했거나 기존 기록이 있습니다. JSON으로 현재 목록을 백업하고 최신 자료를 다시 불러오세요.');
  const copy = validateRows(kind, rows);
  const result = { schemaVersion: 1, rows: copy, count: copy.length, version: version + 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
  if (kind === 'week') result.date = validateSunday(date);
  return result;
}

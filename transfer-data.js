import { parseAccounts } from './account-data.js';

const fields = ['bank', 'accountNumber', 'name', 'notes'];

export function findAccounts(accounts, query) {
  const text = query.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
  if (!text) return [];
  return accounts.filter(row => fields.some(key => row[key].normalize('NFC').toLocaleLowerCase('ko-KR').includes(text)));
}

export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw new Error('금액은 0 이상의 원 단위 정수로 입력하세요.');
    value = Number(text.replaceAll(',', ''));
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 999999999999999) throw new Error('금액은 0~999,999,999,999,999 범위의 정수여야 합니다.');
  return value;
}

export function parseTransferRows(text) {
  const data = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(data)) throw new Error('JSON의 최상위 값은 작업 목록 배열이어야 합니다.');
  return data.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${index + 1}번 항목이 올바르지 않습니다.`);
    const { amount, ...account } = row;
    const validated = parseAccounts(JSON.stringify([account]))[0];
    try { return { ...validated, amount: parseAmount(amount) }; }
    catch (error) { throw new Error(`${index + 1}번: ${error.message}`); }
  });
}

export function serializeTransferRows(rows) {
  return JSON.stringify(parseTransferRows(JSON.stringify(rows)), null, 2) + '\n';
}

export function createTransferWorkbook(XLSX, rows) {
  if (!rows.length) throw new Error('작업 목록에 항목을 추가하세요.');
  const validated = parseTransferRows(JSON.stringify(rows));
  const missing = validated.findIndex(row => row.amount === null || row.amount <= 0);
  if (missing >= 0) throw new Error(`${missing + 1}번 항목에 1원 이상의 금액을 입력하세요.`);
  const values = validated.map(row => [row.bank, row.accountNumber, row.name, row.amount]);
  const sheet = XLSX.utils.aoa_to_sheet(values);
  sheet['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 34 }, { wch: 18 }];
  sheet['!rows'] = validated.map(() => ({ hpt: 22 }));
  const edge = { style: 'thin', color: { rgb: '000000' } };
  for (let index = 0; index < values.length; index++) {
    for (let column = 0; column < 4; column++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: index, c: column })];
      cell.t = column === 3 ? 'n' : 's';
      cell.z = column === 3 ? '#,##0' : '@';
      delete cell.f;
      cell.s = {
        font: { name: '맑은 고딕', sz: 11, bold: true, color: { rgb: '000000' } },
        border: { top: edge, bottom: edge, left: edge, right: edge },
        alignment: { horizontal: column === 3 ? 'right' : column === 0 ? 'center' : 'left', vertical: 'center' },
        numFmt: cell.z
      };
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '주일경상비');
  return workbook;
}

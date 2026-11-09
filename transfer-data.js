const fields = ['bank', 'accountNumber', 'name', 'notes'];

export function findAccounts(accounts, query) {
  const text = query.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
  if (!text) return [];
  return accounts.filter(row => fields.some(key => row[key].normalize('NFC').toLocaleLowerCase('ko-KR').includes(text)));
}

export function createTransferWorkbook(XLSX, rows) {
  const values = [['은행', '계좌번호', '이름', '기타'], ...rows.map(row => fields.map(key => row[key]))];
  const sheet = XLSX.utils.aoa_to_sheet(values);
  sheet['!cols'] = [{ wch: 18 }, { wch: 25 }, { wch: 28 }, { wch: 50 }];
  sheet['!autofilter'] = { ref: sheet['!ref'] };
  // All four data columns are strings. Keep leading zeros and formula-like text literal.
  for (let index = 1; index < values.length; index++) {
    for (let column = 0; column < 4; column++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: index, c: column })];
      cell.t = 's'; cell.z = '@'; delete cell.f;
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '주일경상비');
  return workbook;
}

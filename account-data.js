export function parseAccounts(text) {
  const data = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!Array.isArray(data)) throw new Error('JSON의 최상위 값은 계좌 목록 배열이어야 합니다.');
  return data.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${index + 1}번째 항목이 올바르지 않습니다.`);
    const allowed = ['bank', 'accountNumber', 'name', 'notes'];
    if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error(`${index + 1}번째 항목에 지원하지 않는 필드가 있습니다. bank, accountNumber, name, notes를 사용하세요.`);
    for (const key of ['bank', 'accountNumber', 'name']) {
      if (typeof row[key] !== 'string' || !row[key].trim() || row[key].length > 100) throw new Error(`${index + 1}번째 항목의 ${key}는 1~100자의 문자열이어야 합니다. 계좌번호는 따옴표로 감싸세요.`);
    }
    if (row.notes !== undefined && (typeof row.notes !== 'string' || row.notes.length > 1000)) throw new Error(`${index + 1}번째 항목의 notes는 1,000자 이하 문자열이어야 합니다.`);
    return { bank: row.bank, accountNumber: row.accountNumber, name: row.name, notes: row.notes ?? '' };
  });
}

export function serializeAccounts(rows) {
  return JSON.stringify(parseAccounts(JSON.stringify(rows)), null, 2) + '\n';
}

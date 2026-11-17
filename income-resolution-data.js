const nameOf = value => String(value ?? '').replace(/\s/g, '');
function amountOf(value, label) {
  const text = String(value ?? '').trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw new Error(`${label}: 기간 결산 금액을 확인하세요.`);
  const amount = Number(text.replaceAll(',', ''));
  if (!Number.isSafeInteger(amount)) throw new Error(`${label}: 금액 범위를 초과했습니다.`);
  return amount;
}

// 사이트의 수입/지출 집계표에서 기간 결산만 사용합니다. 부모 합계는 중복 합산하지 않습니다.
export function createIncomeResolution(matrix) {
  const headers = [];
  matrix.forEach((row, r) => row.forEach((value, c) => {
    if (nameOf(value) === '항목' && nameOf(row[c + 2]) === '기간결산') headers.push([r, c]);
  }));
  if (headers.length !== 2) throw new Error('수입과 지출의 제목 행(항목·예산·기간 결산)을 포함해 두 표를 모두 붙여 넣으세요.');
  const read = (start, stop, col) => matrix.slice(start + 1, stop)
    .filter(row => nameOf(row[col]))
    .map(row => {
      const raw = String(row[col]);
      return { name: raw.trim(), key: nameOf(raw), indent: raw.length - raw.trimStart().length,
        amount: amountOf(row[col + 2], raw.trim()) };
    });
  const income = read(headers[0][0], headers[1][0], headers[0][1]);
  const expense = read(headers[1][0], matrix.length, headers[1][1]);
  const find = (rows, key) => {
    const matches = rows.filter(row => row.key === key);
    if (matches.length !== 1) throw new Error(`「${key}」 항목이 정확히 하나 있어야 합니다.`);
    return matches[0].amount;
  };
  const total = find(income, '수입부총계'), carry = find(income, '전기이월');
  const spent = find(expense, '지출부총계');
  const bank = find(expense, '차기이월');
  if (total + carry !== find(income, '수입총계') || total + carry - spent !== bank)
    throw new Error('수입·지출·이월금 합계가 맞지 않습니다. 같은 기간의 두 표인지 확인하세요.');
  const excludedIncome = new Set(['주일헌금','절기헌금','목적헌금','선교헌금','전기이월금','수입부총계','전기이월','수입총계']);
  const leaves = income.filter(row => !excludedIncome.has(row.key));
  if (leaves.reduce((sum, row) => sum + row.amount, 0) !== total)
    throw new Error('수입 세부 항목의 합계가 수입부 총계와 다릅니다. 원본 전체를 확인하세요.');
  const rows = Array.from({length: 33}, () => Array(7).fill(''));
  rows[0] = ['적   요', '', '금   액', '비   고', '과  목', '금액', '적  요'];
  const format = value => value.toLocaleString('en-US');
  const positions = new Map([
    ['십일조',1], ['일반주일',2], ['교회학교',3], ['특별감사',4], ['구역',5], ['일천번제',6],
    ['부활절',7], ['맥추절',8], ['추수감사절',9], ['일반선교헌금',10], ['미얀마',11],
    ['마카오',12], ['전도목적',13], ['개척교회',14], ['사랑의헌금',15], ['창고이야기',18], ['기타수입',19]
  ]);
  const aliases = { 십일조:'십일조헌금', 일반주일:'일반주일헌금', 일반선교헌금:'일반선교', 사랑의헌금:'사랑의 헌금' };
  let extra = 22;
  for (const item of leaves) {
    if (item.amount === 0 && !['십일조','일반주일','교회학교','특별감사','일천번제','맥추절','일반선교헌금','미얀마','마카오','전도목적','개척교회','사랑의헌금','창고이야기','기타수입'].includes(item.key)) continue;
    const index = positions.get(item.key) ?? extra++;
    while (rows.length <= index + 5) rows.push(Array(7).fill(''));
    rows[index][0] = aliases[item.key] ?? item.name;
    rows[index][2] = format(item.amount);
  }
  rows[17][2] = '주일헌금소계';
  rows[17][3] = format(leaves.filter(row => !['창고이야기','기타수입'].includes(row.key)).reduce((sum,row) => sum + row.amount,0));
  rows[21][2] = '목적헌금소계'; rows[21][3] = format(total);
  const details = [], stack = [];
  const stop = expense.findIndex(row => row.key === '차기이월금' || row.key === '지출부총계');
  const accounts = expense.slice(0, stop < 0 ? expense.length : stop);
  for (let i = 0; i < accounts.length; i++) {
    const item = accounts[i];
    while (stack.length && stack.at(-1).indent >= item.indent) stack.pop();
    const path = [...stack.map(row => row.name), item.name];
    const payroll = item.key === '인건비';
    const inPayroll = stack.some(row => row.key === '인건비');
    const hasChildren = accounts[i+1]?.indent > item.indent;
    if (item.amount !== 0 && !inPayroll && (payroll || !hasChildren))
      details.push([payroll ? '인건비 - 교역자생활비 - 담임목사 외' : path.join(' - '), item.amount]);
    stack.push(item);
  }
  if (details.reduce((sum,row) => sum + row[1],0) !== spent)
    throw new Error('지출 세부 합계가 지출부 총계와 다릅니다. 항목 앞의 들여쓰기를 포함해 복사하세요.');
  // 출력 예시처럼 목회활동비를 인건비 앞에 놓습니다.
  const pastoral = details.findIndex(row => row[0] === '예배비 - 목회연구비 - 목회활동비');
  if (pastoral > 0) details.unshift(...details.splice(pastoral,1));
  const bottom = Math.max(29, extra, details.length + 1);
  while (rows.length < bottom + 4) rows.push(Array(7).fill(''));
  details.forEach((item,i) => { rows[i+1][4] = item[0]; rows[i+1][5] = format(item[1]); });
  rows[bottom][0] = '금주헌금합계'; rows[bottom][2] = format(total);
  rows[bottom+1][0] = '전기이월금'; rows[bottom+1][2] = format(carry);
  rows[bottom+2] = ['합        계','',format(total+carry),'','합        계',format(spent),''];
  rows[bottom+3] = ['금주입금액','',format(total-spent),'','은행잔고',format(bank),''];
  return rows;
}

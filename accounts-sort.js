const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

export function sortedAccountView(rows, key = 'order', direction = 'ascending') {
  const sign = direction === 'descending' ? -1 : 1;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const result = key === 'order' ? a.index - b.index : collator.compare(a.row[key], b.row[key]);
    return result ? result * sign : a.index - b.index;
  });
}

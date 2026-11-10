// Excel's clipboard text is TSV, with quotes around embedded tabs/newlines.
export function parseTSV(text) {
  const rows = []; let row = [], value = '', quoted = false, start = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"' && start) { quoted = true; start = false; }
    else if (ch === '\t') { row.push(value); value = ''; start = true; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = ''; start = true;
    } else { value += ch; start = false; }
  }
  if (row.length || value || !rows.length || !/[\r\n]$/.test(text) || quoted) { row.push(value); rows.push(row); }
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return rows.map(r => Array.from({ length: width }, (_, c) => r[c] ?? ''));
}

export function serializeTSV(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join('\t')).join('\r\n');
}

export function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}

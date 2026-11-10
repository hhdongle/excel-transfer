import { parseTSV, serializeTSV, columnName } from './sheet-data.js';

const MAX_ROWS = 2000, MAX_COLS = 100, MAX_CELLS = 40000;
let hasData = false;
const sheetsData = [];
window.addEventListener('beforeunload', event => { if (hasData) { event.preventDefault(); event.returnValue = ''; } });

for (const section of document.querySelectorAll('.sheet')) {
  const viewport = section.querySelector('.grid-scroll');
  const status = section.querySelector('.sheet-status');
  const info = section.querySelector('.selection-info');
  const title = section.querySelector('h2').textContent;
  let height = 50, width = 12, anchor = [0, 0], end = [0, 0], dragging = false, editor = null;
  const data = new Map();
  sheetsData.push(data);
  const cellNodes = new Map();
  const undoStack = [], redoStack = [];
  const capture = () => ({ height, width, anchor: [...anchor], end: [...end] });
  function historyButtons() {
    section.querySelector('[data-action="undo"]').disabled = !undoStack.length;
    section.querySelector('[data-action="redo"]').disabled = !redoStack.length;
  }
  function change(label, apply) {
    const before = capture(), previous = new Map(data);
    apply();
    const changes = [];
    for (const id of new Set([...previous.keys(), ...data.keys()])) {
      const oldValue = previous.get(id), newValue = data.get(id);
      if (oldValue !== newValue) changes.push({ id, oldValue, newValue });
    }
    if (changes.length || before.height !== height || before.width !== width) {
      undoStack.push({ label, changes, before, after: capture() });
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
    }
    hasData = sheetsData.some(sheet => sheet.size > 0);
    historyButtons();
  }
  function restore(redo = false) {
    const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
    const entry = from.pop();
    if (!entry) { status.textContent = `${redo ? '다시 실행할' : '되돌릴'} 작업이 없습니다.`; return; }
    for (const item of entry.changes) {
      const text = redo ? item.newValue : item.oldValue;
      if (text === undefined) data.delete(item.id); else data.set(item.id, text);
    }
    const state = redo ? entry.after : entry.before;
    height = state.height; width = state.width; anchor = [...state.anchor]; end = [...state.end];
    to.push(entry); render(); viewport.focus({ preventScroll: true });
    hasData = sheetsData.some(sheet => sheet.size > 0);
    historyButtons(); status.textContent = `${entry.label} 작업을 ${redo ? '다시 실행했습니다' : '되돌렸습니다'}.`;
  }
  const key = (r, c) => `${r}:${c}`;
  const value = (r, c) => data.get(key(r, c)) ?? '';
  const cell = (r, c) => cellNodes.get(key(r, c));
  const range = () => [Math.min(anchor[0], end[0]), Math.min(anchor[1], end[1]), Math.max(anchor[0], end[0]), Math.max(anchor[1], end[1])];
  function setValue(r, c, text) {
    if (text) data.set(key(r, c), text); else data.delete(key(r, c));
    const target = cell(r, c); if (target) target.querySelector('.cell-text').textContent = text;
    hasData = sheetsData.some(sheet => sheet.size > 0);
  }
  function paint(scroll = false) {
    viewport.querySelectorAll('.selected, .active').forEach(td => td.classList.remove('selected', 'active'));
    const [r1, c1, r2, c2] = range();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cell(r, c)?.classList.add('selected');
    cell(...end)?.classList.add('active');
    info.textContent = `${columnName(c1)}${r1 + 1}${r1 === r2 && c1 === c2 ? '' : `:${columnName(c2)}${r2 + 1}`} · ${(r2-r1+1)*(c2-c1+1)}셀`;
    if (scroll) cell(...end)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function render() {
    cellNodes.clear();
    const table = document.createElement('table'); table.setAttribute('role', 'grid'); table.setAttribute('aria-label', title);
    const head = table.createTHead().insertRow(); head.append(document.createElement('th'));
    for (let c = 0; c < width; c++) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = columnName(c); head.append(th); }
    const body = table.createTBody();
    for (let r = 0; r < height; r++) {
      const tr = body.insertRow(), th = document.createElement('th'); th.scope = 'row'; th.textContent = r + 1; tr.append(th);
      for (let c = 0; c < width; c++) {
        const td = tr.insertCell(); td.dataset.row = r; td.dataset.col = c;
        cellNodes.set(key(r,c), td);
        td.setAttribute('role', 'gridcell'); td.setAttribute('aria-label', `${title} ${columnName(c)}${r+1}`);
        const span = document.createElement('span'); span.className = 'cell-text'; span.textContent = value(r, c); td.append(span);
      }
    }
    viewport.replaceChildren(table); paint();
  }
  function select(r, c, extend = false, scroll = true) {
    end = [Math.max(0, Math.min(height - 1, r)), Math.max(0, Math.min(width - 1, c))];
    if (!extend) anchor = [...end];
    paint(scroll);
  }
  function finish(commit = true) {
    if (!editor) return;
    const input = editor; editor = null;
    if (commit) change('셀 입력·수정', () => setValue(...anchor, input.value));
    input.remove();
  }
  function edit(initial) {
    finish(); anchor = [...end]; paint();
    editor = document.createElement('textarea'); editor.rows = 1; editor.className = 'cell-editor';
    editor.setAttribute('aria-label', `${title} ${columnName(end[1])}${end[0]+1} 편집`);
    editor.value = initial ?? value(...end); cell(...end).append(editor);
    editor.addEventListener('blur', () => finish());
    editor.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && event.altKey) return;
      if (['Enter', 'Tab', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); finish(event.key !== 'Escape'); viewport.focus();
        if (event.key !== 'Escape') select(end[0] + (event.key === 'Enter' ? (event.shiftKey ? -1 : 1) : 0), end[1] + (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0));
      }
    });
    editor.focus(); if (initial === undefined) editor.select();
  }
  function selectedData() {
    const [r1, c1, r2, c2] = range();
    return Array.from({ length: r2-r1+1 }, (_, i) => Array.from({ length: c2-c1+1 }, (_, j) => value(r1+i, c1+j)));
  }
  function paste(text) {
    if (text.length > 5 * 1024 * 1024) { status.textContent = '한 번에 5MB 이하의 데이터를 붙여 넣어 주세요.'; return; }
    const matrix = parseTSV(text), [r, c] = range(), nextHeight = Math.max(height, r + matrix.length), nextWidth = Math.max(width, c + matrix[0].length);
    if (nextHeight > MAX_ROWS || nextWidth > MAX_COLS || nextHeight * nextWidth > MAX_CELLS) { status.textContent = '시트 한도는 2,000행 · 100열 · 전체 40,000셀입니다. 범위를 줄여 주세요.'; return; }
    finish();
    change('붙여넣기', () => {
      height = nextHeight; width = nextWidth;
      matrix.forEach((row, i) => row.forEach((text, j) => { if (text) data.set(key(r+i,c+j),text); else data.delete(key(r+i,c+j)); }));
      anchor = [r,c]; end = [r+matrix.length-1,c+matrix[0].length-1];
    });
    render(); viewport.focus();
    status.textContent = `${matrix.length}행 × ${matrix[0].length}열을 붙여 넣었습니다.`;
  }
  viewport.addEventListener('pointerdown', event => {
    if (event.target === editor || event.button !== 0) return;
    const td = event.target.closest('td[data-row]'); if (!td) return;
    finish(); viewport.focus({ preventScroll: true }); select(Number(td.dataset.row), Number(td.dataset.col), event.shiftKey, false); dragging = true; event.preventDefault();
  });
  viewport.addEventListener('pointerover', event => {
    if (!dragging) return;
    const td = event.target.closest('td[data-row]'); if (td) select(Number(td.dataset.row), Number(td.dataset.col), true, false);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  viewport.addEventListener('dblclick', event => { if (event.target.closest('td[data-row]') && !editor) edit(); });
  viewport.addEventListener('keydown', event => {
    if (!editor && (event.ctrlKey || event.metaKey) && !event.altKey) {
      const letter = event.key.toLowerCase();
      if (letter === 'z' || letter === 'y') {
        event.preventDefault(); restore(letter === 'y' || event.shiftKey); return;
      }
    }
    if (!editor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); anchor = [0,0]; end = [height-1,width-1]; paint(); return;
    }
    if (editor || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Process' || event.keyCode === 229) { edit(''); return; }
    if (event.isComposing) return;
    const moves = { ArrowUp: [-1,0], ArrowDown: [1,0], ArrowLeft: [0,-1], ArrowRight: [0,1], Tab: [0,event.shiftKey ? -1 : 1], Enter: [event.shiftKey ? -1 : 1,0] };
    if (moves[event.key]) { event.preventDefault(); const [r,c] = moves[event.key]; select(end[0]+r, end[1]+c, event.shiftKey && event.key.startsWith('Arrow')); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); clear(); }
    else if (event.key === 'F2') { event.preventDefault(); edit(); }
    else if (event.key.length === 1) { edit(''); /* Let the original key's default action type into the editor, including IME. */ }
  });
  viewport.addEventListener('copy', event => {
    if (editor) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', serializeTSV(selectedData()));
    status.textContent = '선택 영역을 복사했습니다. 엑셀이나 다른 시트에 붙여 넣으세요.';
  });
  viewport.addEventListener('paste', event => {
    if (editor) return;
    event.preventDefault(); paste(event.clipboardData.getData('text/plain'));
  });
  function clear() {
    finish(); const [r1,c1,r2,c2] = range();
    change('내용 삭제', () => {
      for (let r=r1;r<=r2;r++) for (let c=c1;c<=c2;c++) setValue(r,c,'');
    });
    status.textContent = '선택한 셀의 내용을 지웠습니다.'; viewport.focus();
  }
  section.querySelector('.toolbar').addEventListener('click', async event => {
    const action = event.target.closest('button')?.dataset.action; if (!action) return;
    finish();
    if (action === 'undo' || action === 'redo') restore(action === 'redo');
    if (action === 'clear') clear();
    if (action === 'copy') {
      try { await navigator.clipboard.writeText(serializeTSV(selectedData())); status.textContent = '선택 영역을 복사했습니다. 엑셀에 붙여 넣으세요.'; }
      catch { status.textContent = '브라우저에서 복사를 허용하지 않습니다. 셀 영역에서 Ctrl+C를 눌러 주세요.'; }
      viewport.focus();
    }
    if (action === 'paste') {
      try { paste(await navigator.clipboard.readText()); }
      catch { status.textContent = '브라우저에서 읽기를 허용하지 않습니다. 시작 셀을 클릭하고 Ctrl+V를 눌러 주세요.'; viewport.focus(); }
    }
    if (action === 'rows' || action === 'cols') {
      const h = height + (action === 'rows' ? 50 : 0), w = width + (action === 'cols' ? 5 : 0);
      if (h > MAX_ROWS || w > MAX_COLS || h*w > MAX_CELLS) { status.textContent = '더 이상 늘릴 수 없습니다. 시트 한도는 전체 40,000셀입니다.'; return; }
      change(action === 'rows' ? '행 추가' : '열 추가', () => { height=h; width=w; });
      render(); status.textContent = `${height}행 × ${width}열로 늘렸습니다.`;
    }
  });
  render(); historyButtons();
}

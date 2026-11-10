import { parseAccounts } from './account-data.js';
import { findAccounts, createTransferWorkbook, parseAmount, parseTransferRows, serializeTransferRows } from './transfer-data.js?v=20261109-export-feedback';

import { mountCloudAuth, cloudError } from './cloud-client.js';
import { nextSunday, validateSunday } from './cloud-data.js';
const $ = id => document.getElementById(id);
let source = [], rows = [], busy = false, dirty = false;
let cloudUser = null, generation = 0, loadedWeek = null;
let toastTimer;

function showToast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
}

function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}

function exportFeedback(text, error = false) {
  $('export-message').hidden = false;
  $('export-message').textContent = text;
  $('export-message').classList.toggle('error', error);
}

function exportFailure(error) {
  exportFeedback(`엑셀을 생성하지 못했습니다. ${error.message || '다시 시도하세요.'}`, true);
  const input = Number.isInteger(error.rowIndex) ? $('grid-rows').querySelectorAll('.amount-input')[error.rowIndex] : null;
  if (input) {
    input.setAttribute('aria-invalid', 'true'); input.title = error.message;
    input.focus(); input.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  } else $('export-message').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function controls() {
  for (const id of ['cloud-source', 'week-save', 'week-refresh', 'week-list']) $(id).disabled = busy || !cloudUser;
  $('week-load').disabled = busy || !cloudUser || !$('week-list').value;
  $('week-date').disabled = busy;
  $('week-new').disabled = busy;
  $('source-file').disabled = busy;
  $('import-json').disabled = busy;
  $('query').disabled = busy || !source.length;
  $('search').disabled = busy || !source.length;
  for (const id of ['export-json', 'export-excel', 'clear']) $(id).disabled = busy || !rows.length;
  $('grid-rows').querySelectorAll('button, input').forEach(control => control.disabled = busy);

}

function cells(tr, row) {
  for (const key of ['bank', 'accountNumber', 'name', 'notes']) {
    const td = document.createElement('td'); td.textContent = row[key];
    if (key === 'accountNumber') td.className = 'account-number';
    tr.append(td);
  }
}

function ask(text) {
  $('confirm-text').textContent = text;
  $('confirm-dialog').showModal();
  return new Promise(resolve => {
    $('confirm-yes').onclick = () => $('confirm-dialog').close('yes');
    $('confirm-no').onclick = () => $('confirm-dialog').close('no');
    $('confirm-dialog').onclose = () => resolve($('confirm-dialog').returnValue === 'yes');
    // Esc must cancel, including after an earlier successful confirmation.
    $('confirm-dialog').oncancel = () => { $('confirm-dialog').returnValue = 'no'; };
  });
}

function renderGrid() {
  $('grid-count').textContent = `${rows.length}건`;
  $('dirty').textContent = dirty ? 'JSON 백업 필요' : '변경 사항 없음';
  $('empty').hidden = rows.length > 0;
  $('grid-rows').replaceChildren();
  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    const order = document.createElement('td'); order.textContent = String(index + 1); tr.append(order);
    cells(tr, row);
    const amountCell = document.createElement('td');
    const amount = document.createElement('input');
    amount.className = 'amount-input'; amount.type = 'text'; amount.inputMode = 'numeric'; amount.autocomplete = 'off';
    amount.placeholder = '금액 입력'; amount.setAttribute('aria-label', `${index + 1}번 ${row.name} 금액`);
    amount.value = row.amount === null || row.amount === undefined ? '' : typeof row.amount === 'number' ? row.amount.toLocaleString('ko-KR') : row.amount;
    amount.oninput = () => {
      try { row.amount = parseAmount(amount.value); amount.removeAttribute('aria-invalid'); amount.title = ''; }
      catch (error) { row.amount = amount.value; amount.setAttribute('aria-invalid', 'true'); amount.title = error.message; }
      dirty = true; $('dirty').textContent = 'JSON 백업 필요'; renderTotal();
      $('export-message').hidden = true;
    };
    amount.onblur = () => { if (typeof row.amount === 'number') amount.value = row.amount.toLocaleString('ko-KR'); };
    amount.onkeydown = event => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        $('query').focus();
      }
    };
    amountCell.append(amount); tr.append(amountCell);
    const actions = document.createElement('td');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = '삭제';
    remove.setAttribute('aria-label', `${index + 1}번 ${row.name} 삭제`);
    remove.onclick = async () => {
      if (!await ask(`${index + 1}번 ${row.name} 항목을 작업 목록에서 삭제할까요? 계좌 원본에는 영향을 주지 않습니다.`)) return;
      rows.splice(index, 1); dirty = true; renderGrid(); message('작업 목록에서 삭제했습니다.');
    };
    actions.append(remove); tr.append(actions); $('grid-rows').append(tr);
  });
  renderTotal(); controls();
}

function renderTotal() {
  let total = 0n, pending = 0;
  for (const row of rows) {
    try { const value = parseAmount(row.amount); if (value === null || value <= 0) pending++; else total += BigInt(value); }
    catch { pending++; }
  }
  $('amount-total').textContent = `합계 ${total.toLocaleString('ko-KR')}원${pending ? ` · 금액 확인 필요 ${pending}건` : ''}`;
  if (dirty) $('week-status').textContent = '현재 작업에 변경 내용이 있습니다. 날짜를 확인하고 주일별 저장을 누르세요.';
}

function add(row) {
  rows.push({ ...row, amount: null }); dirty = true; renderGrid();
  message('추가된 항목의 금액을 입력하고 Enter를 누르면 계좌 검색으로 돌아갑니다.');
  showToast(`${row.name} 항목이 추가되었습니다. 현재 ${rows.length}건`);
  $('query').value = '';
  $('grid-rows').lastElementChild.querySelector('.amount-input').focus();
}

function setSource(parsed, name) {
  source = parsed;
  $('source-count').textContent = `${source.length}건`;
  $('source-info').textContent = `불러온 원본: ${name} · ${source.length}건`;
  $('query').value = ''; controls();
  message(source.length ? `계좌 원본 ${source.length}건을 불러왔습니다. 검색어를 입력하고 Enter를 누르세요.` : '원본 JSON은 빈 목록입니다. 계좌정보가 있는 파일을 불러오세요.');
}

async function run(action, onError = error => message(error.message || '처리에 실패했습니다.', true)) {
  if (busy) return;
  busy = true; controls();
  let failure;
  try { await action(); }
  catch (error) { failure = new Error(cloudError(error)); failure.rowIndex = error.rowIndex; }
  finally { busy = false; controls(); }
  if (failure) onError(failure);
}

async function readLocal(file, parser = parseAccounts) {
  if (file.size > 5 * 1024 * 1024) throw new Error('5MB 이하의 JSON을 선택하세요.');
  return parser(await file.text());
}

const session = mountCloudAuth($('cloud-auth'), {
  canLeave: () => !busy && (!dirty || ask('저장하지 않은 작업 목록이 있습니다. JSON 백업 또는 주일별 저장을 완료했나요? 로그아웃하면 화면 자료가 지워집니다.')),
  onUser: async user => {
    const previous = cloudUser, ticket = ++generation;
    cloudUser = user; loadedWeek = null;
    $('week-list').replaceChildren(new Option('저장된 주일 선택', ''));
    if (!user) {
      if (previous) { source = []; rows = []; dirty = false; setSource([], '로그아웃'); renderGrid(); }
      controls(); return;
    }
    await run(async () => {
      const {store} = await session.getCloud();
      const accounts = await store.readAccounts(user.uid);
      if (ticket !== generation) return;
      setSource(accounts.rows, 'Firestore 계좌정보');
      await refreshWeeks();
      message(accounts.exists ? `Firestore 계좌정보 ${source.length}건을 자동으로 불러왔습니다.` : '서버에 계좌정보가 없습니다. 계좌정보 입력 페이지에서 기존 JSON을 이전하세요.');
    });
  }
});
async function refreshWeeks() {
  const ticket = generation, {store} = await session.getCloud();
  const records = await store.listWeeks(cloudUser.uid);
  if (ticket !== generation) return;
  $('week-list').replaceChildren(new Option('저장된 주일 선택', ''));
  records.forEach(item => $('week-list').add(new Option(`${item.date} · ${item.count}건`, item.date)));
  if (loadedWeek && records.some(item => item.date === loadedWeek.date)) $('week-list').value = loadedWeek.date;
}
function weekFailure(error) {
  $('week-status').textContent = `저장·조회 실패: ${error.message}`;
  message(error.message, true);
}
$('cloud-source').onclick = () => run(async () => {
  const ticket = generation, {store} = await session.getCloud();
  const data = await store.readAccounts(cloudUser.uid);
  if (ticket === generation) setSource(data.rows, 'Firestore 계좌정보');
});
$('week-date').value = nextSunday();
$('week-list').onchange = controls;
$('week-refresh').onclick = () => run(refreshWeeks);
$('week-save').onclick = () => run(async () => {
  const date = validateSunday($('week-date').value), ticket = generation;
  if (loadedWeek?.date === date && !await ask(`${date}에 저장된 기록을 현재 작업 목록으로 수정할까요?`)) return;
  const expected = loadedWeek?.date === date ? loadedWeek.version : 0;
  const {store} = await session.getCloud();
  const version = await store.saveWeek(cloudUser.uid, date, rows, expected);
  if (ticket !== generation) return;
  loadedWeek = {date, version}; dirty = false; renderGrid();
  $('week-status').textContent = `${date} · ${rows.length}건 저장 완료 (버전 ${version})`;
  await refreshWeeks(); showToast(`${date} 기록이 저장되었습니다.`);
}, weekFailure);
$('week-load').onclick = async () => {
  const date = $('week-list').value; if (!date) return;
  if (rows.length && !await ask('현재 작업 목록을 선택한 주일의 기록으로 교체할까요? 미저장 자료는 JSON으로 먼저 백업하세요.')) return;
  run(async () => {
    const ticket = generation, {store} = await session.getCloud();
    const data = await store.readWeek(cloudUser.uid, date);
    if (ticket !== generation) return;
    if (!data.exists) throw new Error('선택한 기록이 없습니다. 목록을 새로고침하세요.');
    rows = data.rows; loadedWeek = {date, version: data.version}; $('week-date').value = date;
    dirty = false; renderGrid(); $('week-status').textContent = `${date} · ${rows.length}건 불러옴 (버전 ${data.version})`;
    message('당시 계좌정보와 금액으로 복원했습니다. 현재 기준 계좌를 수정해도 과거 기록은 유지됩니다.');
  }, weekFailure);
};
$('week-new').onclick = async () => {
  if (rows.length && !await ask('작업 목록을 비우고 새 주일 작업을 시작할까요? 저장한 과거 기록은 유지됩니다.')) return;
  rows = []; loadedWeek = null; dirty = false; $('week-date').value = nextSunday();
  $('week-list').value = ''; $('week-status').textContent = '새 작업입니다. 주일 날짜를 확인하고 작업 후 저장하세요.'; renderGrid();
};
$('source-file').onchange = event => {
  const file = event.target.files[0]; if (!file) return;
  run(async () => setSource(await readLocal(file), file.name)).finally(() => event.target.value = '');
};

$('search-form').onsubmit = event => {
  event.preventDefault();
  if (busy || !source.length) return;
  const query = $('query').value.trim();
  if (!query) { message('검색할 문자열을 입력하세요.', true); $('query').focus(); return; }
  const found = findAccounts(source, query);
  if (!found.length) { message(`“${query}”를 포함하는 항목이 없습니다.`, true); return; }
  if (found.length === 1) { add(found[0]); return; }
  $('matches-summary').textContent = `“${query}”를 포함하는 ${found.length}건 중 추가할 항목을 선택하세요.`;
  $('match-rows').replaceChildren();
  found.forEach(row => {
    const tr = document.createElement('tr'); cells(tr, row);
    const td = document.createElement('td'), button = document.createElement('button');
    button.type = 'button'; button.textContent = '선택'; button.setAttribute('aria-label', `${row.bank} ${row.accountNumber} ${row.name} ${row.notes} 선택`);
    button.onclick = () => { $('matches').close('selected'); add(row); };
    td.append(button); tr.append(td); $('match-rows').append(tr);
  });
  $('matches').returnValue = '';
  $('matches').showModal();
};
// Do not submit a search while Enter is still confirming Korean IME composition.
$('query').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
});
$('close-matches').onclick = () => $('matches').close();
$('matches').addEventListener('close', () => {
  if ($('matches').returnValue !== 'selected') $('query').focus();
});

function dateSuffix() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()); }
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-json').onclick = () => run(async () => {
  if (!rows.length) return;
  download(new Blob([serializeTransferRows(rows)], { type: 'application/json;charset=utf-8' }), `주일경상비_${dateSuffix()}.json`);
  dirty = false; renderGrid(); message(`${rows.length}건의 작업 목록 JSON을 내보냈습니다. 다운로드된 파일을 확인하세요.`);
});
$('import-json').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if (rows.length && !await ask('하단 작업 목록을 JSON 파일의 내용으로 교체할까요? 필요한 내용은 먼저 JSON Export로 보관하세요.')) { event.target.value = ''; return; }
  await run(async () => {
    const parsed = await readLocal(file, parseTransferRows); rows = parsed; dirty = false; renderGrid();
    $('week-status').textContent = 'JSON에서 가져온 작업 목록입니다. 날짜를 확인하고 주일별 저장을 누르세요.';
    message(`${file.name}에서 작업 목록 ${rows.length}건을 불러왔습니다. 계좌 원본은 유지됩니다.`);
  });
  event.target.value = '';
};
$('export-excel').onclick = () => run(async () => {
  if (!rows.length) return;
  if (!window.XLSX) throw new Error('엑셀 모듈을 불러오지 못했습니다. 현재 목록은 JSON으로 백업한 뒤 페이지를 다시 열어주세요.');
  const workbook = createTransferWorkbook(window.XLSX, rows);
  const data = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  download(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `주일경상비_${dateSuffix()}.xlsx`);
  const text = `은행·계좌번호·이름·금액 ${rows.length}건의 엑셀을 생성했습니다. 다운로드된 파일을 확인하세요.`;
  message(text); exportFeedback(text);
}, exportFailure);
$('clear').onclick = async () => {
  if (!await ask(`작업 목록 ${rows.length}건을 모두 비울까요? 계좌 원본은 유지됩니다.`)) return;
  rows = []; dirty = true; renderGrid(); message('작업 목록을 비웠습니다.');
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
setInterval(() => { if (!busy) controls(); }, 10000);
renderGrid();

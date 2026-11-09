import { parseAccounts } from './account-data.js';
import { findAccounts, createTransferWorkbook, parseAmount, parseTransferRows, serializeTransferRows } from './transfer-data.js?v=20261109-export-feedback';

const CLIENT_ID = '166586757984-g0dchsm57vsd77v3kp9f2r1udi8doc4n.apps.googleusercontent.com';
const $ = id => document.getElementById(id);
let source = [], rows = [], token = '', expires = 0, busy = false, dirty = false;

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
  const connected = Boolean(token && Date.now() < expires);
  $('connect').disabled = busy;
  $('disconnect').disabled = busy || !token;
  $('refresh').disabled = busy || !connected;
  $('drive-files').disabled = busy || !connected;
  $('load-drive').disabled = busy || !connected || !$('drive-files').value;
  $('source-file').disabled = busy;
  $('import-json').disabled = busy;
  $('query').disabled = busy || !source.length;
  $('search').disabled = busy || !source.length;
  for (const id of ['export-json', 'export-excel', 'clear']) $(id).disabled = busy || !rows.length;
  $('grid-rows').querySelectorAll('button, input').forEach(control => control.disabled = busy);
  $('connection').textContent = connected ? 'Drive 연결됨' : '연결 안 됨';
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
        const next = $('grid-rows').querySelectorAll('.amount-input')[index + 1];
        if (next) next.focus(); else amount.blur();
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
}

function add(row) {
  rows.push({ ...row, amount: null }); dirty = true; renderGrid();
  message(`${row.bank} / ${row.name} 항목을 추가했습니다. 현재 ${rows.length}건입니다.`);
  $('query').value = ''; $('query').focus();
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
  catch (error) { failure = error; }
  finally { busy = false; controls(); }
  if (failure) onError(failure);
}

async function readLocal(file, parser = parseAccounts) {
  if (file.size > 5 * 1024 * 1024) throw new Error('5MB 이하의 JSON을 선택하세요.');
  return parser(await file.text());
}

async function drive(path) {
  if (!token || Date.now() >= expires) { token = ''; throw new Error('Google 인증이 만료되었습니다. Drive에 다시 연결하세요. 현재 작업 목록은 유지됩니다.'); }
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    if (response.status === 401) token = '';
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Drive 불러오기 실패 (${response.status}): ${detail.error?.message || '권한과 네트워크를 확인하세요.'}`);
  }
  return response;
}

async function listDriveFiles() {
  let next = '', files = [];
  const selected = $('drive-files').value;
  do {
    const params = new URLSearchParams({ q: "trashed = false and (mimeType = 'application/json' or name contains '.json')", fields: 'nextPageToken,files(id,name)', pageSize: '100', orderBy: 'modifiedTime desc' });
    if (next) params.set('pageToken', next);
    const data = await (await drive(`files?${params}`)).json(); files.push(...data.files); next = data.nextPageToken;
  } while (next);
  $('drive-files').replaceChildren(new Option('파일 선택', ''));
  files.forEach(file => $('drive-files').add(new Option(`${file.name} · ${file.id.slice(-6)}`, file.id)));
  if (files.some(file => file.id === selected)) $('drive-files').value = selected;
  message(files.length ? '계좌 원본 JSON을 선택하고 원본 불러오기를 누르세요.' : '연결 가능한 JSON이 없습니다. 계좌정보 입력 페이지에서 생성하거나 PC의 JSON을 불러오세요.');
}

$('connect').onclick = () => {
  if (!window.google?.accounts?.oauth2) { message('Google 로그인 모듈을 불러오는 중입니다. 잠시 후 다시 누르세요.', true); return; }
  google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: 'https://www.googleapis.com/auth/drive.file',
    callback: response => {
      if (response.error) { message(`Google 연결 실패: ${response.error_description || response.error}`, true); return; }
      token = response.access_token; expires = Date.now() + Number(response.expires_in) * 1000 - 30000;
      $('drive-files').replaceChildren(new Option('파일 선택', ''));
      run(listDriveFiles);
    },
    error_callback: error => message(`로그인 창이 닫혔거나 열리지 않았습니다 (${error.type}). 팝업을 허용하고 다시 연결하세요.`, true)
  }).requestAccessToken({ prompt: 'select_account' });
};
$('disconnect').onclick = () => {
  token = ''; expires = 0; $('drive-files').replaceChildren(new Option('파일 선택', '')); controls();
  message('Drive 연결을 해제했습니다. 이미 불러온 계좌 원본과 작업 목록은 화면에 유지됩니다.');
};
$('drive-files').onchange = controls;
$('refresh').onclick = () => run(listDriveFiles);
$('load-drive').onclick = () => {
  const id = $('drive-files').value;
  if (!id) return;
  const name = $('drive-files').selectedOptions[0].textContent;
  run(async () => {
    const response = await drive(`files/${encodeURIComponent(id)}?alt=media`);
    const text = await response.text();
    if (new Blob([text]).size > 5 * 1024 * 1024) throw new Error('5MB 이하의 계좌 원본을 선택하세요.');
    setSource(parseAccounts(text), name);
  });
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
    button.onclick = () => { $('matches').close(); add(row); };
    td.append(button); tr.append(td); $('match-rows').append(tr);
  });
  $('matches').showModal();
};
// Do not submit a search while Enter is still confirming Korean IME composition.
$('query').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
});
$('close-matches').onclick = () => $('matches').close();
$('matches').addEventListener('close', () => $('query').focus());

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

import { parseAccounts, serializeAccounts } from './account-data.js';
import { sortedAccountView } from './accounts-sort.js';

const CLIENT_ID = '166586757984-g0dchsm57vsd77v3kp9f2r1udi8doc4n.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const $ = id => document.getElementById(id);
let rows = [], editing = -1, dirty = false, token = '', expires = 0, current = null, busy = false;
let sortKey = 'order', sortDirection = 'ascending';

function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}

function authState() {
  const connected = Boolean(token && Date.now() < expires);
  document.querySelectorAll('[data-auth]').forEach(button => button.disabled = busy || !connected);
  $('files').disabled = busy || !connected;
  $('disconnect').disabled = busy || !token;
  $('connect').disabled = busy;
  $('connection').textContent = connected ? 'Drive 연결됨' : '연결 안 됨 / 재연결 필요';
  $('save').disabled = busy || !connected || !current;
  $('load').disabled = busy || !connected || !$('files').value;
}

function render() {
  $('count').textContent = `${rows.length}건`;
  $('dirty').textContent = dirty ? '저장하지 않은 변경 내용 있음' : '변경 사항 없음';
  $('file-info').replaceChildren();
  if (current) {
    const link = document.createElement('a');
    link.href = `https://drive.google.com/file/d/${encodeURIComponent(current.id)}/view`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = current.name;
    $('file-info').append('연결된 파일: ', link);
  } else $('file-info').textContent = '현재 연결된 파일이 없습니다.';
  $('rows').replaceChildren();
  document.querySelectorAll('[data-sort]').forEach(button => {
    const active = button.dataset.sort === sortKey;
    button.closest('th').setAttribute('aria-sort', active ? sortDirection : 'none');
    button.querySelector('.sort-indicator').textContent = active ? (sortDirection === 'ascending' ? '▲' : '▼') : '↕';
    const next = active && sortDirection === 'ascending' ? '내림차순' : '오름차순';
    button.setAttribute('aria-label', `${button.dataset.label} ${next} 정렬`);
  });
  sortedAccountView(rows, sortKey, sortDirection).forEach(({ row, index }) => {
    const tr = document.createElement('tr');
    const order = document.createElement('td');
    order.textContent = String(index + 1);
    tr.append(order);
    for (const key of ['bank', 'accountNumber', 'name', 'notes']) {
      const td = document.createElement('td'); td.textContent = row[key]; tr.append(td);
    }
    const actions = document.createElement('td');
    for (const [text, callback] of [
      ['수정', () => {
        editing = index;
        for (const [id, key] of [['bank','bank'],['account','accountNumber'],['name','name'],['notes','notes']]) $(id).value = rows[index][key];
        $('submit').textContent = '수정 반영'; $('cancel').hidden = false; $('bank').focus();
      }],
      ['삭제', () => {
        if (!confirm(`${row.name}님의 계좌를 목록에서 삭제할까요? Drive에는 저장 버튼을 누른 뒤 반영됩니다.`)) return;
        rows.splice(index, 1); resetForm(); dirty = true; render();
      }]
    ]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = text; button.onclick = callback; actions.append(button);
    }
    tr.append(actions); $('rows').append(tr);
  });
  $('empty').hidden = rows.length !== 0;
  authState();
}

function resetForm() {
  editing = -1; $('account-form').reset(); $('submit').textContent = '목록에 추가'; $('cancel').hidden = true;
}

function replaceAllowed() {
  return (!dirty && !$('bank').value && !$('account').value && !$('name').value && !$('notes').value) || confirm('저장하지 않은 목록 변경이나 입력 중인 내용이 사라집니다. 계속할까요?');
}

async function run(action) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button, input, select')].map(el => [el, el.disabled]);
  controls.forEach(([el]) => el.disabled = true);
  try { await action(); }
  catch (error) { message(error.message || '처리 중 오류가 발생했습니다.', true); }
  finally { busy = false; controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; }); authState(); }
}

async function api(path, options = {}, upload = false) {
  if (!token || Date.now() >= expires) { token = ''; throw new Error('Google 인증이 만료되었습니다. Drive에 다시 연결한 뒤 재시도하세요. 입력 내용은 유지됩니다.'); }
  const response = await fetch(`https://www.googleapis.com/${upload ? 'upload/' : ''}drive/v3/${path}`, {
    ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    if (response.status === 401) { token = ''; throw new Error('인증이 만료되었습니다. Google Drive 연결을 다시 눌러주세요.'); }
    if (response.status === 412) throw new Error('다른 곳에서 파일이 변경됐습니다. 현재 목록을 JSON으로 백업한 뒤 다시 불러오세요.');
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Drive 요청 실패 (${response.status}): ${detail.error?.message || '권한, API 활성화 및 네트워크 상태를 확인하세요.'}`);
  }
  return response;
}

async function metadata(id) {
  const response = await api(`files/${encodeURIComponent(id)}?fields=id,name,version,trashed,capabilities(canEdit)`);
  const data = await response.json();
  if (data.trashed) throw new Error('휴지통에 있는 파일입니다. Drive에서 복원한 뒤 다시 시도하세요.');
  if (!data.capabilities?.canEdit) throw new Error('이 파일에 대한 수정 권한이 없습니다.');
  return { ...data, etag: response.headers.get('ETag') };
}

async function listFiles() {
  let next = '', files = [];
  do {
    const params = new URLSearchParams({ q: "trashed = false and (mimeType = 'application/json' or name contains '.json')", fields: 'nextPageToken,files(id,name)', pageSize: '100', orderBy: 'modifiedTime desc' });
    if (next) params.set('pageToken', next);
    const data = await (await api(`files?${params}`)).json(); files.push(...data.files); next = data.nextPageToken;
  } while (next);
  $('files').replaceChildren(new Option('파일을 선택하세요', ''));
  files.forEach(file => $('files').add(new Option(`${file.name} · ${file.id.slice(-6)}`, file.id)));
  if (current && files.some(file => file.id === current.id)) $('files').value = current.id;
  authState();
}

$('connect').onclick = () => {
  if (!window.google?.accounts?.oauth2) { message('Google 로그인 모듈을 불러오는 중입니다. 잠시 후 다시 누르거나 Google 접속 차단 여부를 확인하세요.', true); return; }
  if (token && !replaceAllowed()) return;
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE,
    callback: response => {
      if (response.error) { message(`Google 연결 실패: ${response.error_description || response.error}`, true); authState(); return; }
      token = response.access_token; expires = Date.now() + Number(response.expires_in) * 1000 - 30000;
      // A new connection may use a different Google account. Never carry its file target across accounts.
      current = null; $('files').replaceChildren(new Option('파일을 선택하세요', '')); render();
      run(async () => { await listFiles(); message('Drive에 연결했습니다. 새 JSON을 만들거나 기존 목록에서 파일을 불러오세요.'); });
    },
    error_callback: error => message(`로그인 창이 닫혔거나 열리지 않았습니다 (${error.type}). 팝업을 허용하고 다시 연결하세요.`, true)
  });
  client.requestAccessToken({ prompt: 'select_account' });
};

$('disconnect').onclick = () => {
  token = ''; expires = 0; current = null; $('files').replaceChildren(new Option('파일을 선택하세요', '')); render();
  message('이 페이지의 Drive 연결을 해제했습니다. 입력 목록은 화면에 유지됩니다.');
};
$('files').onchange = authState;
$('refresh').onclick = () => run(async () => { await listFiles(); message('연결 가능한 파일 목록을 새로 불러왔습니다.'); });
$('load').onclick = () => {
  if (!$('files').value || !replaceAllowed()) return;
  const id = $('files').value;
  run(async () => {
    const before = await metadata(id);
    const text = await (await api(`files/${encodeURIComponent(id)}?alt=media`)).text();
    const parsed = parseAccounts(text);
    const after = await metadata(id);
    if (before.version !== after.version) throw new Error('불러오는 중 파일이 변경됐습니다. 다시 불러오세요.');
    rows = parsed; current = after; dirty = false; resetForm(); render(); message(`${after.name}에서 ${rows.length}건을 불러왔습니다.`);
  });
};
$('create').onclick = () => {
  if (current && !confirm('현재 파일과 별도로 새 계좌정보.json 파일을 만들까요? 같은 이름의 파일이 여러 개 생길 수 있습니다.')) return;
  run(async () => {
    const boundary = `excel_transfer_${crypto.randomUUID().replaceAll('-', '')}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: '계좌정보.json', mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${serializeAccounts(rows)}\r\n--${boundary}--\r\n`;
    const created = await (await api('files?uploadType=multipart&fields=id,name,version', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, true)).json();
    // Retain the created ID even if a follow-up request fails; do not silently create duplicates.
    current = created; dirty = false; render();
    if (![...$('files').options].some(option => option.value === created.id)) $('files').add(new Option(`${created.name} · ${created.id.slice(-6)}`, created.id));
    $('files').value = created.id;
    message(`내 드라이브에 ${created.name}을 만들고 현재 목록 ${rows.length}건을 저장했습니다. 연결된 파일 링크에서 위치를 확인할 수 있습니다.`);
  });
};
$('save').onclick = () => run(async () => {
  if (!current) throw new Error('먼저 새 JSON을 만들거나 파일을 불러오세요.');
  const latest = await metadata(current.id);
  if (!current.version || latest.version !== current.version) throw new Error('Drive 파일이 다른 곳에서 변경됐습니다. JSON으로 현재 목록을 백업한 뒤 파일을 다시 불러오세요.');
  const headers = { 'Content-Type': 'application/json; charset=UTF-8' };
  if (latest.etag) headers['If-Match'] = latest.etag;
  const saved = await (await api(`files/${encodeURIComponent(current.id)}?uploadType=media&fields=id,name,version`, { method: 'PATCH', headers, body: serializeAccounts(rows) }, true)).json();
  current = saved; dirty = false; render(); message(`${saved.name}에 ${rows.length}건을 저장했습니다.`);
});

$('account-form').onsubmit = event => {
  event.preventDefault();
  const row = { bank: $('bank').value.trim(), accountNumber: $('account').value.trim(), name: $('name').value.trim(), notes: $('notes').value.trim() };
  try { parseAccounts(JSON.stringify([row])); } catch (error) { message(error.message, true); return; }
  if (editing === -1) rows.push(row); else rows[editing] = row;
  resetForm(); dirty = true; render(); message('목록에 반영했습니다. Drive에 저장하거나 JSON으로 다운로드하세요.');
};
$('cancel').onclick = resetForm;
document.querySelectorAll('[data-sort]').forEach(button => {
  button.onclick = () => {
    if (busy) return;
    const key = button.dataset.sort;
    sortDirection = sortKey === key && sortDirection === 'ascending' ? 'descending' : 'ascending';
    sortKey = key; render();
  };
});
$('export').onclick = () => {
  const blob = new Blob([serializeAccounts(rows)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  link.download = `계좌정보_${date}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  message('현재 목록을 JSON으로 다운로드했습니다. Drive 저장 상태는 별도로 확인하세요.');
};
$('import').onchange = event => {
  const file = event.target.files[0]; if (!file) return;
  if (!replaceAllowed()) { event.target.value = ''; return; }
  run(async () => {
    if (file.size > 5 * 1024 * 1024) throw new Error('5MB 이하의 JSON 파일을 선택하세요.');
    const parsed = parseAccounts(await file.text());
    rows = parsed; dirty = true; resetForm(); render(); message(`${file.name}에서 ${rows.length}건을 가져왔습니다. Drive에 저장하려면 저장 버튼을 누르세요.`);
  }).finally(() => { event.target.value = ''; });
};
window.addEventListener('beforeunload', event => {
  if (dirty || $('bank').value || $('account').value || $('name').value || $('notes').value) { event.preventDefault(); event.returnValue = ''; }
});
setInterval(() => { if (!busy) authState(); }, 10000);
render();

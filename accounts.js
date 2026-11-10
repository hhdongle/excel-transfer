import { parseAccounts, serializeAccounts } from './account-data.js';
import { sortedAccountView } from './accounts-sort.js';
import { mountCloudAuth, cloudError } from './cloud-client.js';

const $ = id => document.getElementById(id);
let rows = [], editing = -1, dirty = false, busy = false;
let sortKey = 'order', sortDirection = 'ascending';
let cloudUser = null, version = 0, generation = 0;
function message(text, error = false) {
  $('message').textContent = text; $('message').classList.toggle('error', error);
}
function authState() {
  for (const id of ['cloud-save', 'cloud-reload']) $(id).disabled = busy || !cloudUser;
  document.querySelectorAll('#account-form input, #account-form button, [data-sort], #rows button, #import, #export').forEach(el => el.disabled = busy);
}
function render() {
  $('count').textContent = `${rows.length}건`;
  $('dirty').textContent = dirty ? '저장하지 않은 변경 내용 있음' : '변경 사항 없음';
  $('file-info').replaceChildren();
  if (cloudUser) {
    $('file-info').textContent = `Firestore · ${rows.length}건 · 서버 버전 ${version}`;
  } else $('file-info').textContent = '로그인 전입니다. JSON으로 작업하거나 로그인해 서버 자료를 불러오세요.';
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
        if (!confirm(`${row.name}님의 계좌를 목록에서 삭제할까요? 로그인 중이면 Firestore에도 반영됩니다.`)) return;
        rows.splice(index, 1); resetForm(); dirty = true; render();
        run(persistAccounts);
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
  busy = true; authState();
  try { await action(); }
  catch (error) { message(cloudError(error), true); }
  finally { busy = false; authState(); }
}
const session = mountCloudAuth($('cloud-auth'), {
  canLeave: () => !busy && replaceAllowed(),
  onUser: async user => {
    const ticket = ++generation, previous = cloudUser;
    cloudUser = user; version = 0;
    if (!user) {
      if (previous) { rows = []; dirty = false; resetForm(); }
      render(); return;
    }
    await run(async () => {
      const {store} = await session.getCloud();
      const loaded = await store.readAccounts(user.uid);
      if (ticket !== generation) return;
      version = loaded.version;
      if (!dirty) { rows = loaded.rows; }
      render();
      message(dirty ? `현재 입력 목록은 유지했습니다. 서버에는 ${loaded.rows.length}건이 있습니다. 이전하려면 Firestore에 저장을 누르세요.` : loaded.exists ? `Firestore에서 ${rows.length}건을 자동으로 불러왔습니다.` : '서버에 계좌정보가 없습니다. 기존 JSON을 불러온 뒤 Firestore에 저장하세요.');
    });
  }
});
async function persistAccounts() {
  if (!cloudUser) { message('목록에 반영했습니다. 로그인 후 Firestore에 저장하거나 JSON으로 백업하세요.'); return; }
  const user = cloudUser, ticket = generation;
  const {store} = await session.getCloud();
  const savedVersion = await store.saveAccounts(user.uid, rows, version);
  if (ticket !== generation) return;
  version = savedVersion; dirty = false; render(); message(`${rows.length}건을 Firestore에 저장했습니다.`);
}
$('cloud-save').onclick = () => {
  if (!confirm(`현재 목록 ${rows.length}건으로 서버 계좌정보를 저장할까요? 기존 자료는 JSON으로 먼저 백업할 수 있습니다.`)) return;
  run(persistAccounts);
};
$('cloud-reload').onclick = () => {
  if (!cloudUser || !replaceAllowed()) return;
  run(async () => {
    const ticket = generation, {store} = await session.getCloud();
    const loaded = await store.readAccounts(cloudUser.uid);
    if (ticket !== generation) return;
    rows = loaded.rows; version = loaded.version; dirty = false; resetForm(); render(); message(`${rows.length}건을 서버에서 불러왔습니다.`);
  });
};
$('account-form').onsubmit = event => {
  event.preventDefault(); if (busy) return;
  const row = {bank: $('bank').value.trim(), accountNumber: $('account').value.trim(), name: $('name').value.trim(), notes: $('notes').value.trim()};
  try { parseAccounts(JSON.stringify([row])); } catch(error) { message(error.message, true); return; }
  if (editing === -1) rows.push(row); else rows[editing] = row;
  resetForm(); dirty = true; render(); run(persistAccounts);
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
  const blob = new Blob([serializeAccounts(rows)], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `계좌정보_${new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul'}).format(new Date())}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  message('현재 계좌정보 JSON을 내보냈습니다. 서버 저장 상태는 별도로 확인하세요.');
};
$('import').onchange = event => {
  const file = event.target.files[0]; if (!file) return;
  if (!replaceAllowed()) { event.target.value = ''; return; }
  run(async () => {
    if (file.size > 750000) throw new Error('750KB 이하의 JSON 파일을 선택하세요.');
    const parsed = parseAccounts(await file.text());
    if (parsed.length > 1000) throw new Error('최대 1,000건까지 이전할 수 있습니다.');
    rows = parsed; dirty = true; resetForm(); render();
    message(`${file.name}에서 ${rows.length}건을 가져왔습니다. 내용을 확인하고 Firestore에 저장을 눌러 이전하세요.`);
  }).finally(() => event.target.value = '');
};
window.addEventListener('beforeunload', event => {
  if (dirty || $('bank').value || $('account').value || $('name').value || $('notes').value) { event.preventDefault(); event.returnValue = ''; }
});
render();

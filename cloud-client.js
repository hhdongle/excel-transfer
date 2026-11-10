import { firebaseConfig, OWNER_UID } from './firebase-config.js';
import { createCloudStore } from './cloud-store.js';

let promise;
export function getCloud() {
  if (!promise) promise = import('./firebase-sdk.js').then(sdk => {
    const testing = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('emulators') === '1';
    const app = sdk.initializeApp(testing ? {...firebaseConfig, projectId: 'demo-excel-transfer', apiKey: 'demo-key'} : firebaseConfig), auth = sdk.getAuth(app), db = sdk.getFirestore(app);
    if (testing) {
      sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
      sdk.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { sdk, auth, store: createCloudStore(db, sdk, OWNER_UID) };
  }).catch(error => { promise = undefined; throw error; });
  return promise;
}

export function cloudError(error) {
  const code = error?.code || '';
  if (code.includes('permission-denied')) return '접근 권한이 없습니다. Firestore Rules에 담당자 UID가 올바르게 게시됐는지 확인하세요.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return '이메일 또는 비밀번호를 확인하세요.';
  if (code.includes('operation-not-allowed')) return 'Firebase Authentication에서 이메일/비밀번호 로그인을 활성화하세요.';
  if (code.includes('too-many-requests')) return '요청이 너무 많습니다. 잠시 후 다시 시도하세요.';
  if (code.includes('unavailable') || code.includes('network-request-failed')) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요. 입력 자료는 유지됩니다.';
  return error?.message || 'Firebase 연결에 실패했습니다.';
}

export function mountCloudAuth(host, { onUser, canLeave = () => true }) {
  host.innerHTML = '<h2>Firebase 로그인</h2><p>한 번 로그인하면 같은 브라우저에서 로그인 상태를 유지하고 자료를 자동으로 불러옵니다.</p><form class="cloud-login"><label>이메일<input name="email" type="email" autocomplete="username" required></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">로그인</button></form><div class="actions"><button type="button" class="secondary cloud-logout" hidden>로그아웃</button></div><p class="cloud-status" role="status" aria-live="polite">로그인 상태 확인 중…</p>';
  const form = host.querySelector('form'), logout = host.querySelector('.cloud-logout'), status = host.querySelector('.cloud-status');
  let cloud, enabled = false;
  const ready = getCloud().then(async value => {
    cloud = value;
    try { await cloud.sdk.setPersistence(cloud.auth, cloud.sdk.browserLocalPersistence); }
    catch { status.textContent = '브라우저가 로그인 상태 저장을 허용하지 않습니다. 이 창에서만 사용할 수 있습니다.'; }
    cloud.sdk.onAuthStateChanged(cloud.auth, user => {
      const allowed = user?.uid === OWNER_UID;
      enabled = allowed;
      form.hidden = allowed; logout.hidden = !user;
      status.textContent = user ? (allowed ? `${user.email} · 로그인됨` : '담당자 계정이 아닙니다. 로그아웃 후 지정 계정으로 로그인하세요.') : '로그인하면 서버 자료를 불러옵니다. JSON 파일은 로그인 없이 사용할 수 있습니다.';
      Promise.resolve(onUser(allowed ? user : null)).catch(error => { status.textContent = cloudError(error); });
    });
  }).catch(error => { status.textContent = cloudError(error) + ' 새로고침하거나 JSON 기능을 이용하세요.'; });
  form.onsubmit = async event => {
    event.preventDefault();
    const password = form.elements.password.value; form.elements.password.value = '';
    const button = form.querySelector('button'); button.disabled = true;
    try { await ready; if (!cloud) throw new Error('Firebase 모듈을 불러오지 못했습니다.'); await cloud.sdk.signInWithEmailAndPassword(cloud.auth, form.elements.email.value.trim(), password); }
    catch (error) { status.textContent = cloudError(error); }
    finally { button.disabled = false; }
  };
  logout.onclick = async () => {
    if (!await canLeave()) return;
    try { await cloud.sdk.signOut(cloud.auth); } catch (error) { status.textContent = cloudError(error); }
  };
  return { getCloud: async () => { await ready; if (!cloud || !enabled) throw new Error('먼저 담당자 계정으로 로그인하세요.'); return cloud; } };
}

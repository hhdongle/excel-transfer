import { makeRecord, validateRows, validateSunday } from './cloud-data.js';

// SDK injection lets the exact same repository run in browser and emulator tests.
export function createCloudStore(db, sdk, ownerUid) {
  function base(uid) {
    if (!uid || uid !== ownerUid) throw new Error('이 자료에 접근할 수 있는 담당자 계정이 아닙니다.');
    return `users/${uid}`;
  }
  const accountRef = uid => sdk.doc(db, `${base(uid)}/accountBooks/main`);
  const weekRef = (uid, date) => sdk.doc(db, `${base(uid)}/weeks/${validateSunday(date)}`);
  async function read(ref, kind) {
    const snap = await sdk.getDocFromServer(ref);
    if (!snap.exists()) return { rows: [], version: 0, exists: false };
    const data = snap.data();
    if (data.schemaVersion !== 1 || !Number.isInteger(data.version)) throw new Error('지원하지 않는 서버 자료 형식입니다.');
    return { ...data, rows: validateRows(kind, data.rows), exists: true };
  }
  async function save(ref, kind, rows, expectedVersion, date) {
    // Freeze before a transaction retry or any asynchronous work.
    const snapshot = validateRows(kind, rows);
    return sdk.runTransaction(db, async transaction => {
      const previous = await transaction.get(ref);
      const record = makeRecord(kind, snapshot, previous.exists() ? previous.data() : null, expectedVersion, date, sdk.serverTimestamp());
      transaction.set(ref, record);
      return record.version;
    });
  }
  return {
    readAccounts: uid => read(accountRef(uid), 'accounts'),
    saveAccounts: (uid, rows, version) => save(accountRef(uid), 'accounts', rows, version),
    readWeek: (uid, date) => read(weekRef(uid, date), 'week'),
    saveWeek: (uid, date, rows, version) => save(weekRef(uid, date), 'week', rows, version, date),
    async listWeeks(uid) {
      const result = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, `${base(uid)}/weeks`), sdk.orderBy('date', 'desc')));
      return result.docs.map(item => ({ date: item.id, count: item.data().count, version: item.data().version }));
    }
  };
}

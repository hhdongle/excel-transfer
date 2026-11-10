import {test, before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import {createCloudStore} from '../cloud-store.js';
const owner = 'BHImPcznlFZDcrchzxzZqi8oRJd2';
const account = {bank:'가상은행', accountNumber:'001234567890123456', name:'테스트 예금주', notes:'교육부'};
let env, db, store;
before(async () => {
  env = await initializeTestEnvironment({projectId:'demo-excel-transfer', firestore:{host:'127.0.0.1',port:8080,rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
  db = env.authenticatedContext(owner).firestore(); store = createCloudStore(db,sdk,owner);
});
beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());
test('250-account JSON migration and server reload preserve every account and leading zero', async () => {
  const rows = Array.from({length:250},(_,i) => ({...account, name:`가상 예금주${i}`, accountNumber:`00${String(i).padStart(14,'0')}`}));
  assert.equal((await store.readAccounts(owner)).exists,false);
  await store.saveAccounts(owner,JSON.parse(JSON.stringify(rows)),0);
  const loaded = await store.readAccounts(owner);
  assert.deepEqual(loaded.rows,rows); assert.equal(loaded.version,1); assert.equal(loaded.count,250);
});
test('add, edit, delete and empty list persist atomically', async () => {
  await store.saveAccounts(owner,[account],0);
  await store.saveAccounts(owner,[account,{...account,name:'둘째'}],1);
  await store.saveAccounts(owner,[{...account,notes:'수정'}],2);
  assert.equal((await store.readAccounts(owner)).rows[0].notes,'수정');
  await store.saveAccounts(owner,[],3); assert.deepEqual((await store.readAccounts(owner)).rows,[]);
});
test('stale and simultaneous writes cannot overwrite the newest account list', async () => {
  await store.saveAccounts(owner,[account],0);
  const results = await Promise.allSettled([
    store.saveAccounts(owner,[{...account,name:'창1'}],1),store.saveAccounts(owner,[{...account,name:'창2'}],1)
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await store.readAccounts(owner)).version,2);
});
test('weekly records restore the original account snapshot after master changes', async () => {
  await store.saveAccounts(owner,[account],0);
  await store.saveWeek(owner,'2026-11-15',[{...account,amount:200000}],0);
  await store.saveWeek(owner,'2026-11-22',[{...account,amount:300000}],0);
  await store.saveAccounts(owner,[{...account,name:'변경된 예금주',accountNumber:'999'}],1);
  const old = await store.readWeek(owner,'2026-11-15');
  assert.equal(old.rows[0].accountNumber,account.accountNumber); assert.equal(old.rows[0].amount,200000);
  assert.deepEqual((await store.listWeeks(owner)).map(x=>x.date),['2026-11-22','2026-11-15']);
  await assert.rejects(store.saveWeek(owner,'2026-11-15',[],0),/다른 창/);
});
test('unauthenticated and different users cannot read or write owner records', async () => {
  await store.saveAccounts(owner,[account],0);
  for (const context of [env.unauthenticatedContext(),env.authenticatedContext('other-user')]) {
    const client=context.firestore();
    await assertFails(sdk.getDoc(sdk.doc(client,`users/${owner}/accountBooks/main`)));
    await assertFails(sdk.setDoc(sdk.doc(client,`users/${owner}/accountBooks/main`),{rows:[]}));
    await assertFails(sdk.getDocs(sdk.collection(client,`users/${owner}/weeks`)));
  }
});
test('rules reject writes outside allowed paths, invalid schema, stale versions and deletes', async () => {
  await store.saveAccounts(owner,[account],0);
  const ref=sdk.doc(db,`users/${owner}/accountBooks/main`);
  await assertFails(sdk.setDoc(sdk.doc(db,'public/leak'),{rows:[account]}));
  await assertFails(sdk.updateDoc(ref,{version:99,updatedAt:sdk.serverTimestamp()}));
  await assertFails(sdk.updateDoc(ref,{version:2,updatedAt:sdk.serverTimestamp(),unexpected:true}));
  await assertFails(sdk.deleteDoc(ref));
  await assertSucceeds(sdk.getDoc(ref));
});

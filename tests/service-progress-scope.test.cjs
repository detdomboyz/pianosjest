'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Client=require('../service-client.js'),Progress=require('../piano-progress-store.js');
const NOW=Date.UTC(2026,10,8,14),KEY='melodiajest:user:account-a:'+Progress.STORAGE_KEY;
function env(){const map=new Map([[Progress.STORAGE_KEY,'{"legacy":"untouched"}']]),queues=new Map();let user={id:'account-a',username:'pianist_a',displayName:'Пианист'};
  const locks={request(name,options,work){const next=(queues.get(name)||Promise.resolve()).then(()=>work({name}));queues.set(name,next.catch(()=>{}));return next;}};
  const storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const fetch=async(url)=>({ok:true,status:200,json:async()=>url.endsWith('/session')?{user,csrfToken:'csrf'}:{raw:null,revision:0}});
  const client=()=>Client.create({fetch,storage,locks});return {map,locks,storage,client,switchUser:()=>{user={id:'account-b',username:'pianist_b',displayName:'Второй'};}};
}
const operation=id=>({id,lessonId:'course02-02',fingerprint:'b623c94b',mode:'challenge',clean:true,at:NOW-1000});
test('two actual progress owners through account facades merge fresh receipts instead of overwriting another tab',async()=>{
  const e=env(),a=e.client(),b=e.client();await Promise.all([a.init(),b.init()]);const one=Progress.create({storage:a.storage,locks:e.locks,now:()=>NOW}),two=Progress.create({storage:b.storage,locks:e.locks,now:()=>NOW});await Promise.all([one.refresh(),two.refresh()]);
  assert.equal((await one.record(operation('first'))).status,'saved');assert.equal((await two.record(operation('second'))).status,'saved');
  const other=JSON.parse(e.map.get(KEY));other.privateExtension={keep:'другая вкладка'};e.map.set(KEY,JSON.stringify(other));
  assert.equal((await one.record(operation('third'))).status,'saved');const result=Progress.parse(e.map.get(KEY));assert.equal(result['course02-02'].cleanTakes,3);assert.equal(result['course02-02'][Progress.META].receipts.length,3);assert.deepEqual(result.privateExtension,{keep:'другая вкладка'});assert.equal(e.map.get(Progress.STORAGE_KEY),'{"legacy":"untouched"}');
});
test('real readback mismatches stay pending through the account facade instead of claiming memory as durable storage',async()=>{
  const e=env(),client=e.client();await client.init();const store=Progress.create({storage:client.storage,locks:e.locks,now:()=>NOW});e.storage.setItem=(key)=>e.map.set(key,'{"different-writer":"present"}');
  const result=await store.record(operation('mismatch'));assert.equal(result.status,'unsaved');assert.equal(store.snapshot().pendingCount,1);assert.equal(e.map.get(KEY),'{"different-writer":"present"}');assert.equal(store.exportRecovery().pending[0].id,'mismatch');
});
test('an already queued old-account result completes only in its old namespace after a session switch',async()=>{
  const e=env(),client=e.client();await client.init();let release;const gate=new Promise(resolve=>release=resolve);
  const holding=e.locks.request(Progress.LOCK_NAME,{mode:'exclusive'},()=>gate);const store=Progress.create({storage:client.storage,locks:e.locks,now:()=>NOW}),saved=store.record(operation('pending-at-logout'));
  e.switchUser();await client.checkSession();assert.equal(client.status().locked,true);release();await holding;assert.equal((await saved).status,'saved');
  assert.equal(Progress.parse(e.map.get(KEY))['course02-02'].cleanTakes,1);assert.equal(e.map.has('melodiajest:user:account-b:'+Progress.STORAGE_KEY),false);assert.equal(e.map.get(Progress.STORAGE_KEY),'{"legacy":"untouched"}');
});
test('storage failures remain retryable and never turn an account progress draft into a confirmed receipt',async()=>{
  const e=env(),client=e.client();await client.init();const store=Progress.create({storage:client.storage,locks:e.locks,now:()=>NOW}),write=e.storage.setItem;e.storage.setItem=()=>{throw Error('Synthetic storage denial');};
  assert.equal((await store.record(operation('write-failed'))).status,'unsaved');assert.equal(store.snapshot().pendingCount,1);assert.equal(e.map.has(KEY),false);assert.equal(store.exportRecovery().pending[0].id,'write-failed');
  e.storage.setItem=write;assert.equal((await store.retry()).status,'saved');assert.equal(store.snapshot().pendingCount,0);assert.equal(Progress.parse(e.map.get(KEY))['course02-02'].cleanTakes,1);
});

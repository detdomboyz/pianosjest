'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),Store=require('../piano-lesson-package-store.js'),Controller=require('../piano-lesson-package-controller.js');
const copy=x=>JSON.parse(JSON.stringify(x));
// Read-only I/O fixture. It neither implements persistence nor simulates CAS/abort.
// All transactional behavior is exercised separately against native IndexedDB.
function readonly(seed){
 const calls=[];return {calls,open(){calls.push('open');const request={};queueMicrotask(()=>{request.result={objectStoreNames:{length:1,contains:n=>n==='slots'},close(){},transaction(name,mode){assert.equal(mode,'readonly');calls.push(mode);let pending=0;const tx={objectStore(){const get=value=>{pending++;const r={};queueMicrotask(()=>{r.result=value;r.onsuccess?.();if(!--pending)queueMicrotask(()=>tx.oncomplete?.());});return r;};return {get:key=>get(seed[key]),getKey:key=>get(Object.hasOwn(seed,key)?key:undefined)};}};return tx;}};request.onsuccess?.();});return request;}};
}
const seed=()=>({current:{revision:9,privateAnnotation:'current'},previous:{revision:8,notes:[48,52]},receipt:{operationId:'old'},pending:{format:'future-pending-9',version:9,privateData:{text:'archive test 🎹\ud800',notes:[{pitch:48,start:0,duration:.5}],fingers:[{hand:'left',num:5}],order:[9,2],contentKind:'piece'}}});
function io({gate,error,optional=true}={}){
 const calls=[],plan=Object.freeze({version:1,archiveId:'own-archive',pendingBytes:41});const unused=()=>{throw Error('Unexpected activation');};
 const store={read:async()=>null,prepare:unused,stage:unused,recoverPending:async()=>null,commit:unused,exportRecovery:async()=>'private',close(){calls.push('close');}};
 if(optional)Object.assign(store,{preparePendingArchive:async()=>{calls.push('prepare');return plan;},archivePending:async p=>{assert.equal(p,plan);calls.push('archive');if(gate)await gate.promise;if(error)throw error;return {status:'archived',archiveId:plan.archiveId,durability:'strict'};}});
 return {calls,plan,store};
}
const make=(s,onChange)=>Controller.create({store:s,subtle:webcrypto.subtle,onChange}),deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};

test('archive methods stay lazy, reject forged tokens before I/O and preserve explicit closure',async()=>{
 const factory=readonly(seed()),s=Store.create({indexedDB:factory});assert.deepEqual(factory.calls,[]);await assert.rejects(s.archivePending({}),{code:'PLAN'});assert.deepEqual(factory.calls,[]);s.close();await assert.rejects(s.preparePendingArchive(),{code:'CLOSED'});await assert.rejects(s.archivePending({}),{code:'CLOSED'});assert.deepEqual(factory.calls,[]);assert.equal(require('../tools/build-web.cjs').ASSETS.includes('piano-lesson-package-store.js'),false);
});
test('read-only archive preparation captures opaque future context without normalization or private token fields',async()=>{
 const initial=seed(),before=copy(initial),factory=readonly(initial),s=Store.create({indexedDB:factory,id:()=> 'archive-1'}),p=await s.preparePendingArchive();assert.deepEqual(Object.keys(p).sort(),['archiveId','pendingBytes','version']);assert.ok(Object.isFrozen(p));assert.equal(p.archiveId,'archive-1');assert.ok(p.pendingBytes>40);assert.deepEqual(initial,before);assert.ok(!JSON.stringify(p).includes('privateData'));const count=factory.calls.length;await assert.rejects(s.archivePending(copy(p)),{code:'PLAN'});const other=Store.create({indexedDB:readonly(initial)});await assert.rejects(other.archivePending(p),{code:'PLAN'});assert.equal(factory.calls.length,count);s.close();other.close();
});
test('occupied archive refuses replacement and an absent pending remains a read-only no-op',async()=>{
 const initial={...seed(),pendingArchive:{format:'future-archive-8',private:'keep'}},factory=readonly(initial),s=Store.create({indexedDB:factory});await assert.rejects(s.preparePendingArchive(),{code:'ARCHIVE_FULL'});assert.equal(initial.pendingArchive.private,'keep');initial.pending=null;assert.equal(await s.preparePendingArchive(),null);assert.ok(factory.calls.every(x=>x==='open'||x==='readonly'));s.close();for(const value of [null,undefined]){const raw={...seed(),pendingArchive:value},s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingArchive(),{code:'ARCHIVE_FULL'});assert.ok(Object.hasOwn(raw,'pendingArchive'));assert.ok(Object.is(raw.pendingArchive,value));s.close();}
});
test('undefined, negative zero, dates, sparse values and accessors cannot be lost while preparing an archive',async()=>{
 for(const value of [undefined,-0,NaN,Infinity,new Date(),new Map(),new Uint8Array([1]),[1,,3]]){const initial=seed();initial.pending.extra=value;const s=Store.create({indexedDB:readonly(initial)});await assert.rejects(s.preparePendingArchive(),{code:'INPUT'});assert.ok(Object.hasOwn(initial.pending,'extra'));assert.ok(Object.is(initial.pending.extra,value));s.close();}
 const initial=seed();let gets=0;Object.defineProperty(initial.pending,'extra',{get(){gets++;return 'private';},enumerable:true});const s=Store.create({indexedDB:readonly(initial)});await assert.rejects(s.preparePendingArchive(),{code:'INPUT'});assert.equal(gets,0);s.close();
});
test('archive byte/string/depth guards and ID-provider failures preserve the original values without provider text',async()=>{
 const large=seed();large.pending.extra='x'.repeat(Store.MAX_STRING_BYTES+1);const s=Store.create({indexedDB:readonly(large)});await assert.rejects(s.preparePendingArchive(),{code:'LIMIT'});assert.equal(large.pending.extra.length,Store.MAX_STRING_BYTES+1);s.close();
 const deep=seed();let at=deep.pending;for(let n=0;n<Store.MAX_DEPTH+12;n++)at=at.next={};const d=Store.create({indexedDB:readonly(deep)});await assert.rejects(d.preparePendingArchive(),{code:'LIMIT'});d.close();const bad=Store.create({indexedDB:readonly(seed()),id:()=>{throw Error('private-provider-text');}});await assert.rejects(bad.preparePendingArchive(),e=>e.code==='UNAVAILABLE'&&!e.message.includes('private-provider-text'));bad.close();
});
test('ordinary recovery export keeps v1 while v2 includes the full private archive and never omits undefined fields',async()=>{
 const initial=seed(),one=Store.create({indexedDB:readonly(initial)}),old=JSON.parse(await one.exportRecovery());assert.equal(old.format,'melodiajest-piano-package-recovery-v1');assert.equal(Object.hasOwn(old,'pendingArchive'),false);one.close();const archive={format:'melodiajest-piano-pending-archive-v1',database:Store.DATABASE,archiveId:'archive-1',slots:copy(initial)},current={...copy(initial),pending:null,pendingArchive:archive},two=Store.create({indexedDB:readonly(current)}),out=JSON.parse(await two.exportRecovery());assert.equal(out.format,'melodiajest-piano-package-recovery-v2');for(const key of Object.keys(current))assert.deepEqual(out[key],current[key]);current.pending={extra:undefined};await assert.rejects(two.exportRecovery(),{code:'INPUT'});assert.ok(Object.hasOwn(current.pending,'extra'));two.close();
});
test('controller reports prepared without writes and archived only after completion, even when an observer throws',async()=>{
 const gate=deferred(),x=io({gate}),statuses=[],c=make(x.store,s=>{statuses.push(copy(s));throw Error('observer');}),p=await c.preparePendingArchive();assert.equal(p,x.plan);assert.deepEqual(x.calls,['prepare']);assert.equal(c.status().phase,'pending-archive-prepared');assert.equal(c.status().confirmedRevision,null);const pending=c.commitPendingArchive(p);await Promise.resolve();assert.deepEqual(x.calls,['prepare','archive']);assert.equal(c.status().phase,'saving');gate.resolve();assert.equal((await pending).status,'archived');assert.equal(c.status().phase,'pending-archived');assert.equal(c.status().confirmedRevision,null);assert.ok(statuses.every(s=>!Object.hasOwn(s,'catalog')));c.close();
});
test('foreign and JSON-cloned controller archive tokens fail before persistence',async()=>{
 const x=io(),y=io(),a=make(x.store),b=make(y.store),p=await a.preparePendingArchive();await assert.rejects(a.commitPendingArchive(copy(p)),{code:'PLAN'});await assert.rejects(b.commitPendingArchive(p),{code:'PLAN'});assert.deepEqual(x.calls,['prepare']);assert.deepEqual(y.calls,[]);a.close();b.close();
});
test('typed archive failure is private and does not report catalog saved or archive completion',async()=>{
 for(const code of ['STALE','ARCHIVE_FULL','QUOTA','ABORTED']){const x=io({error:Object.assign(Error('private-provider-text'),{code})}),c=make(x.store),p=await c.preparePendingArchive();await assert.rejects(c.commitPendingArchive(p),e=>e.code===code&&!e.message.includes('private-provider-text'));assert.equal(c.status().phase,'failed');assert.equal(c.status().confirmedRevision,null);c.close();}
});
test('closing a queued archive and a missing optional archive adapter stop before persistence',async()=>{
 const missing=io({optional:false}),m=make(missing.store);await assert.rejects(m.preparePendingArchive(),{code:'UNAVAILABLE'});assert.deepEqual(missing.calls,[]);m.close();const x=io(),c=make(x.store),p=await c.preparePendingArchive(),pending=c.commitPendingArchive(p);c.close();await assert.rejects(pending,{code:'CLOSED'});assert.deepEqual(x.calls,['prepare','close']);
});

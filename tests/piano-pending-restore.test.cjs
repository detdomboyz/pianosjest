'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),Store=require('../piano-lesson-package-store.js'),Controller=require('../piano-lesson-package-controller.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const initialFixture=require('../tools/qa-piano-package-planner.cjs').buildFixture().fixture.initial;
// Read-only fixtures validate inputs and capabilities. Native QA, not this fixture,
// proves write serialization, add/abort/quota and the retained archive.
function readonly(seed){
 const calls=[];return {calls,open(){calls.push('open');const request={};queueMicrotask(()=>{request.result={objectStoreNames:{length:1,contains:n=>n==='slots'},close(){},transaction(name,mode){assert.equal(mode,'readonly');calls.push(mode);let pending=0;const tx={objectStore(){const get=value=>{pending++;const r={};queueMicrotask(()=>{r.result=value;r.onsuccess?.();if(!--pending)queueMicrotask(()=>tx.oncomplete?.());});return r;};return {get:key=>get(seed[key]),getKey:key=>get(Object.hasOwn(seed,key)?key:undefined)};}};return tx;}};request.onsuccess?.();});return request;}};
}
function seed(){
 const initial=copy(initialFixture),current={format:'melodiajest-piano-package-state-v1',revision:1,operationId:'current-1',...initial},after={...copy(current),revision:2,operationId:'draft-2'};
 after.catalog.lessons[0].privateAnnotations={text:'synthetic pending 🎹\ud800',notes:[48,52],fingers:[5,3],order:[4,1],contentKind:'piece'};
 const receipt={format:'melodiajest-piano-package-receipt-v1',operationId:'current-1',revision:1,previousRevision:0},pending={format:'melodiajest-piano-package-pending-v1',before:copy(current),after};
 return {current,receipt,pendingArchive:{format:'melodiajest-piano-pending-archive-v1',database:Store.DATABASE,archiveId:'archive-1',slots:{current:copy(current),previous:null,receipt:copy(receipt),pending}}};
}
function io({gate,error,optional=true}={}){
 const calls=[],plan=Object.freeze({version:1,archiveId:'archive-1',pendingBytes:47}),unused=()=>{throw Error('Unexpected activation');};
 const store={read:async()=>null,prepare:unused,stage:unused,recoverPending:unused,commit:unused,exportRecovery:async()=>'',close:()=>calls.push('close')};
 if(optional)Object.assign(store,{preparePendingRestore:async()=>{calls.push('prepare');return plan;},restorePending:async p=>{assert.equal(p,plan);calls.push('restore');if(gate)await gate.promise;if(error)throw error;return {status:'restored',archiveId:plan.archiveId,durability:'strict'};}});return {store,calls,plan};
}
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};},make=(store,onChange)=>Controller.create({store,subtle:webcrypto.subtle,onChange});
test('restore is lazy and forged or closed capabilities fail before database I/O',async()=>{
 const factory=readonly(seed()),s=Store.create({indexedDB:factory});assert.deepEqual(factory.calls,[]);await assert.rejects(s.restorePending({version:1,archiveId:'x',pendingBytes:1}),{code:'PLAN'});assert.deepEqual(factory.calls,[]);s.close();await assert.rejects(s.preparePendingRestore(),{code:'CLOSED'});await assert.rejects(s.restorePending({}),{code:'CLOSED'});assert.deepEqual(factory.calls,[]);assert.ok(!require('../tools/build-web.cjs').ASSETS.includes('piano-lesson-package-store.js'));
});
test('supported same-database archive prepares only opaque metadata without writes or catalog activation',async()=>{
 const initial=seed(),before=copy(initial),factory=readonly(initial),s=Store.create({indexedDB:factory}),p=await s.preparePendingRestore();assert.deepEqual(Object.keys(p).sort(),['archiveId','pendingBytes','version']);assert.ok(Object.isFrozen(p));assert.equal(p.archiveId,'archive-1');assert.ok(p.pendingBytes>100);assert.ok(!JSON.stringify(p).includes('privateAnnotations'));assert.deepEqual(initial,before);assert.ok(factory.calls.every(x=>x==='open'||x==='readonly'));s.close();const empty=Store.create({indexedDB:readonly({current:initial.current})});assert.equal(await empty.preparePendingRestore(),null);empty.close();
});
test('future, malformed, wrong-database and occupied null or undefined archive values are preserved',async()=>{
 for(const edit of [x=>x.pendingArchive=null,x=>x.pendingArchive=undefined,x=>x.pendingArchive.format='future-v9',x=>x.pendingArchive.database+='-qa-other',x=>x.pendingArchive.extra=true,x=>x.pendingArchive.archiveId='',x=>x.pendingArchive.slots.pending=null,x=>delete x.pendingArchive.slots.receipt]){const raw=seed();edit(raw);const archive=raw.pendingArchive,s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingRestore(),{code:'SCHEMA'});assert.ok(Object.hasOwn(raw,'pendingArchive'));assert.equal(raw.pendingArchive,archive);s.close();}
});
test('a pending key is occupied even when its value is null or undefined',async()=>{
 for(const value of [null,undefined,{format:'future-pending',private:'keep'}]){const raw={...seed(),pending:value},archive=raw.pendingArchive,s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingRestore(),{code:'PENDING'});assert.ok(Object.hasOwn(raw,'pending'));assert.ok(Object.is(raw.pending,value));assert.equal(raw.pendingArchive,archive);s.close();}
});
test('changed working context, originally stale pending and future schemas refuse restoration read-only',async()=>{
 for(const key of ['current','previous','receipt']){const raw=seed();raw[key]={changed:key};const s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingRestore(),{code:'STALE'});assert.equal(raw[key].changed,key);s.close();}
 for(const [edit,code]of [[x=>{x.current.revision=7;x.current.operationId='newer-7';x.pendingArchive.slots.current=copy(x.current);},'STALE'],[x=>x.pendingArchive.slots.pending.format='future-pending-v9','SCHEMA'],[x=>{x.current.format='future-state-v9';x.pendingArchive.slots.current=copy(x.current);},'SCHEMA']]){const raw=seed();edit(raw);const before=copy(raw),s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingRestore(),{code});assert.deepEqual(raw,before);s.close();}
});
test('strict JSON and size guards preserve unsupported archive contents without lossy conversion',async()=>{
 for(const value of [undefined,-0,NaN,new Date(),new Map(),new Uint8Array([1]),[1,,3]]){const raw=seed();raw.pendingArchive.slots.pending.extra=value;const s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingRestore(),{code:'INPUT'});assert.ok(Object.is(raw.pendingArchive.slots.pending.extra,value));s.close();}
 const raw=seed();raw.pendingArchive.slots.pending.extra='x'.repeat(Store.MAX_STRING_BYTES+1);const s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.preparePendingRestore(),{code:'LIMIT'});assert.ok(raw.pendingArchive.slots.pending.extra.length>Store.MAX_STRING_BYTES);s.close();
});
test('restore tokens belong to one store and cannot be replaced by archive or serialized metadata',async()=>{
 const raw=seed(),factory=readonly(raw),s=Store.create({indexedDB:factory}),p=await s.preparePendingRestore(),before=factory.calls.length;await assert.rejects(s.restorePending(copy(p)),{code:'PLAN'});const other=Store.create({indexedDB:readonly(raw)});await assert.rejects(other.restorePending(p),{code:'PLAN'});assert.equal(factory.calls.length,before);s.close();other.close();
});
test('controller preparation is read-only and completion reports restored pending rather than a saved catalog',async()=>{
 const gate=deferred(),x=io({gate}),statuses=[],c=make(x.store,s=>{statuses.push(copy(s));throw Error('observer');}),p=await c.preparePendingRestore();assert.equal(p,x.plan);assert.deepEqual(x.calls,['prepare']);assert.equal(c.status().phase,'pending-restore-prepared');const pending=c.commitPendingRestore(p);await Promise.resolve();assert.equal(c.status().phase,'saving');assert.deepEqual(x.calls,['prepare','restore']);gate.resolve();const out=await pending;assert.ok(Object.isFrozen(out));assert.equal(out.status,'restored');assert.equal(c.status().phase,'pending-restored');assert.equal(c.status().confirmedRevision,null);assert.ok(statuses.every(s=>!Object.hasOwn(s,'catalog')));c.close();
});
test('controller rejects foreign tokens, close-before-write, missing adapters and private provider error text',async()=>{
 const x=io(),y=io(),a=make(x.store),b=make(y.store),p=await a.preparePendingRestore();await assert.rejects(a.commitPendingRestore(copy(p)),{code:'PLAN'});await assert.rejects(b.commitPendingRestore(p),{code:'PLAN'});assert.deepEqual(y.calls,[]);const pending=a.commitPendingRestore(p);a.close();await assert.rejects(pending,{code:'CLOSED'});assert.deepEqual(x.calls,['prepare','close']);b.close();const missing=io({optional:false}),m=make(missing.store);await assert.rejects(m.preparePendingRestore(),{code:'UNAVAILABLE'});m.close();
 for(const code of ['STALE','PENDING','SCHEMA','QUOTA','ABORTED']){const bad=io({error:Object.assign(Error('private-provider-text'),{code})}),c=make(bad.store),p=await c.preparePendingRestore();await assert.rejects(c.commitPendingRestore(p),e=>e.code===code&&!e.message.includes('private-provider-text'));assert.equal(c.status().phase,'failed');assert.equal(c.status().confirmedRevision,null);c.close();}
});
test('ordinary pending recovery keeps the same before/after and stale/future refusal contract',async()=>{
 for(const alreadyApplied of [false,true]){const raw=seed();raw.pending=copy(raw.pendingArchive.slots.pending);if(alreadyApplied)raw.current=copy(raw.pending.after);delete raw.pendingArchive;const s=Store.create({indexedDB:readonly(raw)}),p=await s.recoverPending();assert.equal(p.fromRevision,1);assert.equal(p.toRevision,2);assert.equal(p.operationId,'draft-2');s.close();}
 for(const [edit,code]of [[x=>{x.current.revision=7;x.current.operationId='newer-7';},'STALE'],[x=>x.pending.format='future-pending-v9','SCHEMA']]){const raw=seed();raw.pending=copy(raw.pendingArchive.slots.pending);delete raw.pendingArchive;edit(raw);const s=Store.create({indexedDB:readonly(raw)});await assert.rejects(s.recoverPending(),{code});s.close();}
});

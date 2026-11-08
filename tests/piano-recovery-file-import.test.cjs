'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto'),Store=require('../piano-lesson-package-store.js'),Controller=require('../piano-lesson-package-controller.js');
const copy=x=>JSON.parse(JSON.stringify(x)),initial=require('../tools/qa-piano-package-planner.cjs').buildFixture().fixture.initial;
// Input/capability tests use read-only requests. Native browser QA proves atomic
// writes, real request ordering, occupied keys, quota rollback and race behavior.
function readonly(seed={}){
 const calls=[];return {calls,open(){calls.push('open');const request={};queueMicrotask(()=>{request.result={objectStoreNames:{length:1,contains:n=>n==='slots'},close(){},transaction(name,mode){assert.equal(mode,'readonly');calls.push(mode);let pending=0;const tx={objectStore(){const get=value=>{pending++;const r={};queueMicrotask(()=>{r.result=value;r.onsuccess?.();if(!--pending)queueMicrotask(()=>tx.oncomplete?.());});return r;};return {get:key=>get(seed[key]),getKey:key=>get(Object.hasOwn(seed,key)?key:undefined),getAllKeys:(_query,count)=>get(Object.keys(seed).sort().slice(0,count))};}};return tx;}};request.onsuccess?.();});return request;}};
}
function seed(){
 const current={format:'melodiajest-piano-package-state-v1',revision:1,operationId:'source-1',...copy(initial)};
 current.catalog.lessons[0].privateAnnotations={text:'synthetic file 🎹\ud800',privateNumber:1,notes:[48,52],fingers:[5,3],order:[4,1],contentKind:'piece'};
 const after={...copy(current),revision:2,operationId:'draft-2'},receipt={format:'melodiajest-piano-package-receipt-v1',operationId:'source-1',revision:1,previousRevision:0};after.catalog.lessons[0].privateAnnotations.text+=' second edition';
 return {current,receipt,pendingArchive:{format:'melodiajest-piano-pending-archive-v1',database:Store.DATABASE,archiveId:'archive-1',slots:{current:copy(current),previous:null,receipt:copy(receipt),pending:{format:'melodiajest-piano-package-pending-v1',before:copy(current),after}}}};
}
async function exported(value=seed()){const s=Store.create({indexedDB:readonly(value)});try{return await s.exportRecovery();}finally{s.close();}}
async function invalid(text,code){const factory=readonly(),s=Store.create({indexedDB:factory});try{await assert.rejects(s.prepareRecoveryImport(text),{code});assert.deepEqual(factory.calls,[]);}finally{s.close();}}
function io({gate,error,optional=true}={}){
 const calls=[],plan=Object.freeze({version:1,database:Store.DATABASE,sourceRevision:1,bytes:47}),unused=()=>{throw Error('Unexpected catalog activation');};
 const store={read:async()=>null,prepare:unused,stage:unused,recoverPending:unused,commit:unused,exportRecovery:async()=>'',close:()=>calls.push('close')};
 if(optional)Object.assign(store,{prepareRecoveryImport:async text=>{calls.push('prepare');assert.equal(text,'synthetic');return plan;},importRecovery:async p=>{assert.equal(p,plan);calls.push('import');if(gate)await gate.promise;if(error)throw error;return {status:'imported',sourceRevision:1,bytes:47,durability:'strict'};}});return {store,calls,plan};
}
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};},make=(store,onChange)=>Controller.create({store,subtle:webcrypto.subtle,onChange});

test('actual canonical v2 export prepares opaque metadata with no payload write or private fields',async()=>{
 const raw=seed(),before=copy(raw),text=await exported(raw),factory=readonly(),s=Store.create({indexedDB:factory});assert.deepEqual(factory.calls,[]);const p=await s.prepareRecoveryImport(text);assert.deepEqual(Object.keys(p).sort(),['bytes','database','sourceRevision','version']);assert.equal(p.bytes,Buffer.byteLength(text));assert.equal(p.sourceRevision,1);assert.ok(Object.isFrozen(p));assert.ok(!JSON.stringify(p).includes('privateAnnotations'));assert.deepEqual(raw,before);assert.deepEqual(factory.calls,['open','readonly']);s.close();
});

test('every occupied destination key blocks import, including null, undefined and unknown keys',async()=>{
 const text=await exported();for(const key of ['current','previous','receipt','pending','pendingArchive','future-slot'])for(const value of [null,undefined,{keep:true}]){const raw={[key]:value},factory=readonly(raw),s=Store.create({indexedDB:factory});await assert.rejects(s.prepareRecoveryImport(text),{code:'CONFLICT'});assert.ok(Object.hasOwn(raw,key));assert.ok(Object.is(raw[key],value));assert.deepEqual(factory.calls,['open','readonly']);s.close();}
});

test('unsupported envelope, wrong database and extra or missing root fields fail before database access',async()=>{
 const text=await exported();for(const [edit,code]of [[x=>x.format='melodiajest-piano-package-recovery-v1','SCHEMA'],[x=>x.format='future-recovery-v9','SCHEMA'],[x=>x.database+='-qa-other','SOURCE'],[x=>delete x.pendingArchive,'SCHEMA'],[x=>x.extra=true,'SCHEMA'],[x=>delete x.receipt,'SCHEMA']]){const data=JSON.parse(text);edit(data);await invalid(JSON.stringify(data),code);}
});

test('canonical encoding refuses duplicate keys and lossy numeric or escaped representations',async()=>{
 const text=await exported();for(const value of ['{','',null,{},JSON.stringify(JSON.parse(text),null,2),' '+text,text+'\n','{"database":"'+Store.DATABASE+'",'+text.slice(1),'{"\\u0064atabase":"'+Store.DATABASE+'",'+text.slice(1),text.replace('synthetic','\\u0073ynthetic'),text.replace('"privateNumber":1','"privateNumber":-0'),text.replace('"privateNumber":1','"privateNumber":1e400')])await invalid(value,'INPUT');
 let converted=false;await invalid({toString(){converted=true;return text;}},'INPUT');assert.equal(converted,false);
});

test('known working states, receipt and revision chain must agree without upgrading older catalog schemas',async()=>{
 const text=await exported();for(const [edit,code]of [[x=>x.current.format='future-state-v9','SCHEMA'],[x=>x.current.catalog.version=6,'SCHEMA'],[x=>x.receipt.revision++,'SCHEMA'],[x=>x.receipt.operationId='other','SCHEMA'],[x=>x.receipt={extra:true,...x.receipt},'SCHEMA'],[x=>x.current.revision=7,'SCHEMA'],[x=>x.current=null,'SCHEMA'],[x=>x.pendingArchive.database+='-qa-other','SOURCE'],[x=>delete x.pendingArchive.slots.receipt,'SCHEMA']]){const data=JSON.parse(text);edit(data);await invalid(JSON.stringify(data),code);}
});

test('stale or future drafts and opaque future archives remain bounded JSON without automatic recovery',async()=>{
 for(const edit of [x=>{x.pending={format:'future-pending-v9',private:'keep'};},x=>{x.pending=copy(x.pendingArchive.slots.pending);x.pending.after.revision=9;},x=>{x.pendingArchive={format:'future-archive-v9',private:{notes:[60,64],history:['old']}};},x=>{x.pendingArchive=null;},x=>{delete x.current;delete x.receipt;}]){const raw=seed();edit(raw);const text=await exported(raw),s=Store.create({indexedDB:readonly()});const p=await s.prepareRecoveryImport(text);assert.equal(p.sourceRevision,raw.current?.revision??0);assert.ok(!JSON.stringify(p).includes('private'));s.close();}
});

test('strict per-value and nesting limits refuse data without clipping or creating a destination',async()=>{
 const base=JSON.parse(await exported());base.pendingArchive={format:'future',private:'x'.repeat(Store.MAX_STRING_BYTES+1)};await invalid(JSON.stringify(base),'LIMIT');let nested={value:'keep'};for(let i=0;i<100;i++)nested={nested};base.pendingArchive=nested;await invalid(JSON.stringify(base),'LIMIT');
});

test('store tokens cannot be serialized, moved to another store, or used after close',async()=>{
 const text=await exported(),factory=readonly(),s=Store.create({indexedDB:factory}),p=await s.prepareRecoveryImport(text),count=factory.calls.length;await assert.rejects(s.importRecovery(copy(p)),{code:'PLAN'});const otherFactory=readonly(),other=Store.create({indexedDB:otherFactory});await assert.rejects(other.importRecovery(p),{code:'PLAN'});assert.deepEqual(otherFactory.calls,[]);assert.equal(factory.calls.length,count);s.close();await assert.rejects(s.importRecovery(p),{code:'CLOSED'});await assert.rejects(s.prepareRecoveryImport(text),{code:'CLOSED'});assert.equal(factory.calls.length,count);other.close();
});

test('controller separates preparation from completion and reports an import rather than an ordinary save',async()=>{
 const gate=deferred(),x=io({gate}),statuses=[],c=make(x.store,s=>{statuses.push(copy(s));throw Error('observer');}),p=await c.prepareRecoveryImport('synthetic');assert.equal(p,x.plan);assert.deepEqual(x.calls,['prepare']);assert.equal(c.status().phase,'recovery-import-prepared');const done=c.commitRecoveryImport(p);await Promise.resolve();assert.equal(c.status().phase,'saving');assert.deepEqual(x.calls,['prepare','import']);gate.resolve();const out=await done;assert.ok(Object.isFrozen(out));assert.equal(out.status,'imported');assert.equal(c.status().phase,'recovery-imported');assert.equal(c.status().confirmedRevision,null);assert.ok(statuses.every(s=>s.phase!=='saved'&&!Object.hasOwn(s,'catalog')));c.close();
});

test('controller rejects foreign capabilities, unsupported adapters, close-before-write and provider error text',async()=>{
 const x=io(),y=io(),a=make(x.store),b=make(y.store),p=await a.prepareRecoveryImport('synthetic');await assert.rejects(a.commitRecoveryImport(copy(p)),{code:'PLAN'});await assert.rejects(b.commitRecoveryImport(p),{code:'PLAN'});assert.deepEqual(y.calls,[]);const done=a.commitRecoveryImport(p);a.close();await assert.rejects(done,{code:'CLOSED'});assert.deepEqual(x.calls,['prepare','close']);b.close();const missing=io({optional:false}),m=make(missing.store);await assert.rejects(m.prepareRecoveryImport('synthetic'),{code:'UNAVAILABLE'});m.close();
 for(const code of ['STALE','CONFLICT','SCHEMA','SOURCE','QUOTA','ABORTED']){const bad=io({error:Object.assign(Error('private-provider-text'),{code})}),c=make(bad.store),plan=await c.prepareRecoveryImport('synthetic');await assert.rejects(c.commitRecoveryImport(plan),e=>e.code===code&&!e.message.includes('private-provider-text'));assert.equal(c.status().confirmedRevision,null);assert.equal(c.status().phase,'failed');c.close();}
});

test('browser UMD exposes the same lazy implementation and public assets stay excluded',async()=>{
 const context={TextEncoder,crypto:webcrypto};vm.runInNewContext(fs.readFileSync('piano-lesson-package-store.js','utf8'),context);const factory=readonly(),s=context.PianoLessonPackageStore.create({indexedDB:factory}),p=await s.prepareRecoveryImport(await exported());assert.equal(p.sourceRevision,1);await assert.rejects(s.importRecovery(copy(p)),e=>e.code==='PLAN');s.close();for(const name of ['piano-lesson-package-store.js','piano-lesson-package-controller.js'])assert.ok(!require('../tools/build-web.cjs').ASSETS.includes(name));
});

test('JSON prototype-like private keys stay data and unsupported native read capability fails without repair',async()=>{
 const raw=seed();raw.current.catalog.lessons[0].privateAnnotations.extra=JSON.parse('{"__proto__":{"recoveryPollution":true},"constructor":{"prototype":{"keep":true}}}');const text=await exported(raw),factory=readonly(),s=Store.create({indexedDB:factory});await s.prepareRecoveryImport(text);assert.equal(Object.prototype.recoveryPollution,undefined);assert.equal(Object.hasOwn(raw.current.catalog.lessons[0].privateAnnotations.extra,'__proto__'),true);s.close();const bad={open(){const r={};queueMicrotask(()=>{r.result={objectStoreNames:{length:1,contains:()=>true},close(){},transaction(){return {objectStore(){return {};}};}};r.onsuccess?.();});return r;}},unsupported=Store.create({indexedDB:bad});await assert.rejects(unsupported.prepareRecoveryImport(text),{code:'UNAVAILABLE'});unsupported.close();
});

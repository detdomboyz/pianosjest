'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Owner=require('../piano-legacy-checkpoint-owner.js'),Progress=require('../piano-progress-store.js'),Candidate=require('../piano-browser-checkpoint-candidate.js'),Measure=require('../tools/measure-browser-checkpoint.cjs');
const NOW=Date.parse('2026-11-08T12:00:00.000Z'),STAMP=new Date(NOW).toISOString();
const operation=(id='take-1',extra={})=>({id,lessonId:'course02-02',fingerprint:'b623c94b',mode:'challenge',clean:true,at:NOW-1000,...extra});
function environment(){const map=new Map(),calls=[],queues=new Map(),storage={getItem(key){calls.push(['get',key]);return map.get(key)??null;},setItem(key,raw){calls.push(['set',key]);map.set(key,raw);}},locks={request(name,options,work){assert.equal(name,Progress.LOCK_NAME);assert.equal(options.mode,'exclusive');calls.push(['lock',name]);const job=(queues.get(name)||Promise.resolve()).then(()=>work({name}));queues.set(name,job.catch(()=>{}));return job;}};return{map,calls,storage,locks,now:()=>NOW};}
const envelope=(owner,token=owner.prepareCheckpoint())=>JSON.parse(owner.readCheckpoint(token).raw);
function blocked(){let release;const promise=new Promise(r=>release=r);return{release,promise};}

test('import/construction are inert and the shipped application still uses its unchanged legacy writer',()=>{
 const touched=[],ctx={window:{}};for(const n of ['indexedDB','localStorage','fetch','navigator'])Object.defineProperty(ctx,n,{get(){touched.push(n);throw Error('unexpected I/O');}});vm.runInNewContext(fs.readFileSync('piano-legacy-checkpoint-owner.js','utf8'),ctx);assert.equal(ctx.window.PianoLegacyCheckpointOwner.VERSION,1);assert.deepEqual(touched,[]);
 const e=environment(),s=Owner.create(e);assert.deepEqual(e.calls,[]);assert.equal(require('../tools/build-web.cjs').ASSETS.includes('piano-legacy-checkpoint-owner.js'),false);assert.ok(!fs.readFileSync('index.html','utf8').includes('piano-legacy-checkpoint-owner'));assert.throws(()=>Owner.create({}),{code:'INPUT'});s.closeCheckpoint();
});

test('a new idle owner captures unknown confirmation distinctly and exports immutable owner-bound metadata',()=>{
 const e=environment(),s=Owner.create(e),t=s.prepareCheckpoint(),v=s.readCheckpoint(t),body=JSON.parse(v.raw);assert.equal(t.completeCopy,false);assert.equal(t.confirmedAvailable,false);assert.equal(body.confirmed,null);assert.equal(body.recovery.baseRaw,null);assert.equal(body.recovery.draftRaw,null);assert.deepEqual(body.recovery.pending,[]);assert.equal(body.snapshot.saving,false);assert.equal(s.isCurrent(t),true);assert.equal(t.generation,v.generation);assert.equal(t.codeUnits,v.raw.length);assert.ok(Object.isFrozen(t)&&Object.isFrozen(v));assert.deepEqual(e.calls,[]);assert.throws(()=>s.readCheckpoint({...t}),{code:'PLAN'});assert.throws(()=>Owner.create(environment()).readCheckpoint(t),{code:'PLAN'});
});

test('failed writes retain exact original raw, confirmed extensions, draft and every operation without read I/O',async()=>{
 const e=environment(),s=Owner.create(e),raw=' \n{"private":{"unknown":"🎹\\ud800","history":{"unrecognized":{"x":1}}}}\t';e.map.set(Progress.STORAGE_KEY,raw);e.storage.setItem=()=>{throw Error('private quota detail');};assert.equal((await s.record(operation())).code,'STORAGE_WRITE_FAILED');await s.record(operation('take-2',{at:NOW}));const calls=e.calls.length,t=s.prepareCheckpoint(),v=s.readCheckpoint(t),body=envelope(s,t);assert.equal(e.calls.length,calls);assert.equal(body.recovery.baseRaw,raw);assert.equal(body.confirmed.private.unknown,'🎹\ud800');assert.deepEqual(body.recovery.pending.map(x=>x.id),['take-1','take-2']);assert.equal(JSON.parse(body.recovery.draftRaw)['course02-02'].cleanTakes,2);assert.equal(body.snapshot.code,'STORAGE_WRITE_FAILED');assert.equal(t.pendingCount,2);assert.equal(e.map.get(Progress.STORAGE_KEY),raw);const historical=v.raw;
 e.storage.setItem=(k,x)=>e.map.set(k,x);assert.equal((await s.retry()).status,'saved');assert.equal(s.isCurrent(t),false);assert.equal(s.readCheckpoint(t).raw,historical);const next=envelope(s);assert.equal(next.recovery.pending.length,0);assert.equal(next.recovery.baseRaw,null);assert.equal(next.confirmed['course02-02'].cleanTakes,2);assert.deepEqual(next.confirmed.private,JSON.parse(raw).private);
});

test('readback failure exports the actual uncertainty and replay does not duplicate a committed take',async()=>{
 const e=environment(),s=Owner.create(e);let afterWrite=false;e.storage.setItem=(k,v)=>{e.map.set(k,v);afterWrite=true;};e.storage.getItem=k=>{if(afterWrite){afterWrite=false;throw Error('private readback detail');}return e.map.get(k)??null;};assert.equal((await s.record(operation())).code,'SAVE_NOT_CONFIRMED');const body=envelope(s);assert.equal(body.snapshot.code,'SAVE_NOT_CONFIRMED');assert.equal(body.recovery.pending.length,1);assert.equal(body.confirmed['course02-02'],undefined);assert.equal(JSON.parse(e.map.get(Progress.STORAGE_KEY))['course02-02'].cleanTakes,1);await s.retry();assert.equal(envelope(s).confirmed['course02-02'].cleanTakes,1);assert.equal(envelope(s).recovery.pending.length,0);
});

test('facade revision notices errors and no-op attempts that the original data generation does not cover',async()=>{
 const e=environment(),s=Owner.create(e);await s.refresh();const t=s.prepareCheckpoint(),sourceGeneration=s.snapshot().generation;await s.record({...operation(),mode:'unknown'});assert.equal(s.snapshot().generation,sourceGeneration);assert.equal(s.isCurrent(t),false);const bad=s.prepareCheckpoint();assert.ok(bad.generation>t.generation);assert.equal(envelope(s,bad).snapshot.code,'LEGACY_OPERATION_INVALID');await s.refresh();const restored=s.prepareCheckpoint();assert.equal(s.snapshot().generation,sourceGeneration);assert.ok(restored.generation>bad.generation);assert.equal(s.isCurrent(bad),false);assert.equal(envelope(s,restored).snapshot.code,null);
});

test('active lock work refuses capture while immutable prior observations remain readable',async()=>{
 const e=environment(),gate=blocked();e.locks.request=async(n,o,fn)=>{await gate.promise;return fn({name:n});};const s=Owner.create(e),t=s.prepareCheckpoint(),raw=s.readCheckpoint(t).raw,job=s.record(operation());assert.throws(()=>s.prepareCheckpoint(),{code:'BUSY'});assert.equal(s.isCurrent(t),false);assert.equal(s.readCheckpoint(t).raw,raw);gate.release();await job;assert.equal(s.snapshot().pendingCount,0);assert.equal(s.isCurrent(t),false);assert.equal(envelope(s).confirmed['course02-02'].cleanTakes,1);
});

test('synchronous storage and change callbacks cannot reenter the memory capture boundary',async()=>{
 const e=environment();let s,attempts=0;const check=()=>{if(s){attempts++;assert.throws(()=>s.prepareCheckpoint(),{code:'BUSY'});}};const get=e.storage.getItem;e.storage.getItem=k=>{check();return get(k);};s=Owner.create({...e,onChange:check});await s.record(operation());assert.ok(attempts>=3);assert.equal(envelope(s).confirmed['course02-02'].cleanTakes,1);assert.equal(s.snapshot().pendingCount,0);
});

test('one-owner currency is explicitly independent of storage changes made by another real writer',async()=>{
 const e=environment(),first=Owner.create(e),second=Progress.create(e);await first.refresh();const t=first.prepareCheckpoint();await second.record(operation('other'));assert.equal(first.isCurrent(t),true);assert.deepEqual(envelope(first,t).confirmed,{});assert.equal(JSON.parse(e.map.get(Progress.STORAGE_KEY))['course02-02'].cleanTakes,1);await first.refresh();assert.equal(first.isCurrent(t),false);assert.equal(envelope(first).confirmed['course02-02'].cleanTakes,1);assert.ok(e.calls.every(([kind,key])=>kind==='lock'?key===Progress.LOCK_NAME:key===Progress.STORAGE_KEY));
});

test('closing capture invalidates tokens without cancelling writes or discarding private pending',async()=>{
 const e=environment(),gate=blocked();e.locks.request=async(n,o,fn)=>{await gate.promise;return fn({name:n});};const s=Owner.create(e),t=s.prepareCheckpoint(),job=s.record(operation());s.closeCheckpoint();assert.throws(()=>s.readCheckpoint(t),{code:'CLOSED'});assert.throws(()=>s.prepareCheckpoint(),{code:'CLOSED'});assert.equal(s.exportRecovery().pending.length,1);gate.release();await job;assert.equal(s.snapshot().pendingCount,0);assert.equal(s.confirmedProgress()['course02-02'].cleanTakes,1);assert.throws(()=>s.isCurrent(t),{code:'CLOSED'});
});

test('the full current actual reducer journal and unknown history fields survive an owner export',async()=>{
 const e=environment(),fixture=Measure.buildFixture(),entry=fixture.entries.find(x=>x.key===Progress.STORAGE_KEY),rows=JSON.parse(entry.raw);rows.private={unrecognized:true,history:{old:{unknown:'🎹\ud800'}}};const raw=JSON.stringify(rows);e.map.set(Progress.STORAGE_KEY,raw);const s=Owner.create(e);await s.refresh();const before=e.calls.length,body=envelope(s);assert.equal(e.calls.length,before);assert.equal(fixture.counts.syntheticProgressRows,require('./fixtures/piano-curriculum-counts.json').checkedMidiRouteLessons);assert.deepEqual(body.confirmed,rows);assert.equal(Progress.inspect(JSON.stringify(body.confirmed),NOW).progressRecords,fixture.counts.syntheticProgressRows);assert.deepEqual(body.confirmed.private,rows.private);assert.equal(e.map.get(Progress.STORAGE_KEY),raw);
});

test('candidate handoff preserves captured pending while the real writer changes during hashing',async()=>{
 const e=environment(),s=Owner.create(e),raw=' {"private":{"keep":"\\ud800"}} ';e.map.set(Progress.STORAGE_KEY,raw);e.storage.setItem=()=>{throw Error('quota');};await s.record(operation());const ownerToken=s.prepareCheckpoint(),component=s.readCheckpoint(ownerToken),gate=blocked(),b=Candidate.create({subtle:{async digest(...args){await gate.promise;return crypto.webcrypto.subtle.digest(...args);}},now:()=>STAMP}),work=b.prepareFrom({getItem:k=>k===Progress.STORAGE_KEY?e.map.get(k)??null:null},[component]);e.storage.setItem=(k,v)=>e.map.set(k,v);await s.retry();assert.equal(s.isCurrent(ownerToken),false);gate.release();const token=await work,v=b.readCandidate(token),captured=v.components.find(x=>x.id==='legacy-progress');assert.equal(captured.raw,component.raw);assert.equal(JSON.parse(captured.raw).recovery.pending.length,1);assert.equal(v.persisted.find(x=>x.key===Progress.STORAGE_KEY).raw,raw);assert.equal(v.completeCopy,false);assert.equal(v.consistency,'uncoordinated');assert.equal(v.counts.componentsObserved,1);assert.equal(v.counts.componentsUnavailable,7);assert.ok(v.reasons.includes('WRITER_BARRIER_NOT_IMPLEMENTED')&&v.reasons.includes('MEMORY_CONTRACTS_NOT_VALIDATED'));b.close();
});

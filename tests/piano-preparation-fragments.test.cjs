'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../piano-preparation.js'),S=require('../piano-preparation-store.js'),A=require('../practice-assessment.js'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),NOW=Date.UTC(2026,10,6,12),DAY=86400000;
const plans=JSON.parse(fs.readFileSync('docs/piano-lesson-backlog.json','utf8')).lessons.filter(p=>p.assessmentProtocol?.kind==='notation-to-key'),contracts=plans.map(p=>P.compile(p,app.lessons)),fragments=contracts.map(c=>c.requirements.find(r=>r.range.kind==='fragment'));
const before=JSON.parse(fs.readFileSync('tests/fixtures/piano-preparation-before-adaptation-v1.json','utf8'));
// These five quarter notes and two finger sequences are musical expectations,
// not generated from the compiler or grading implementation under test.
const expected=[{midis:[60,62,62,64,64],fingers:[1,2,2,3,3],sourceBpm:62,hand:'right'},{midis:[48,50,50,52,52],fingers:[5,4,4,3,3],sourceBpm:60,hand:'left'}];
function take(r,n=0,mode='challenge',capturedAt=NOW-10000+n*1000){const beat=60000/r.targetBpm,start=2000+n*100000,base=r.steps[0].startBeat,events=r.steps.flatMap(s=>[{type:'on',midi:s.midis[0],source:'midi',at:start+(s.startBeat-base)*beat},{type:'off',midi:s.midis[0],at:start+(s.startBeat-base+s.durationBeats)*beat}]).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));return {schemaVersion:1,attemptId:`fragment-${r.lessonId}-${n}`,requirementKey:r.key,capturedAt,bpm:r.targetBpm,observedUntil:events.at(-1).at,mode,assisted:false,observationInterrupted:false,timedOut:false,errors:0,events};}
const entry=(r,n=0)=>({requirement:copy(r),attempt:take(r,n)});
function environment(){const map=new Map(),access=[],queues=new Map(),storage={getItem(k){access.push(['read',k]);return map.get(k)??null;},setItem(k,v){access.push(['write',k]);map.set(k,v);}},locks={request(name,options,work){assert.equal(options.mode,'exclusive');access.push(['lock',name]);const job=(queues.get(name)||Promise.resolve()).then(()=>work({name}));queues.set(name,job.catch(()=>{}));return job;}};return {map,access,storage,locks};}

test('two explicit adaptations preserve five quarter-note attacks and own-hand fingers at a project target of 56 BPM',()=>{
 for(const[i,r]of fragments.entries()){const source=app.lessons.find(l=>l.id===r.lessonId),e=expected[i];assert.deepEqual(r.range,{kind:'fragment',firstStep:0,lastStep:4});assert.deepEqual(r.steps,e.midis.map((midi,i)=>({midis:[midi],startBeat:i,durationBeats:1})));assert.deepEqual(copy(source.fingeringSpec.steps.slice(0,5).map(s=>s[0].num)),e.fingers);assert.ok(source.fingeringSpec.steps.slice(0,5).every(s=>s[0].hand===e.hand));assert.equal(source.rhythm.practiceBpm,e.sourceBpm);assert.equal(r.targetBpm,56);assert.deepEqual(r.adaptation,{version:1,id:'three-note-repeat-preparation-v1',kind:'project-training-adaptation',sourceBpm:e.sourceBpm});assert.equal(source.steps.length,16);assert.equal(r.fingerprint,A.pianoSignature(source));assert.equal(r.ending,undefined);assert.equal(P.assessAttempt(r,take(r),{now:NOW}).status,'matched');}
});

test('all four whole preparation contracts and the two historical native-tempo fragments retain their original keys and profiles',()=>{
 for(const[i,c]of contracts.entries()){assert.deepEqual(c.requirements.filter(r=>r.range.kind==='whole'),before[i].requirements.filter(r=>r.range.kind==='whole'));const native=copy(plans[i]);delete native.preparationFragments[0].adaptation;assert.deepEqual(P.compile(native,app.lessons),before[i]);assert.notEqual(fragments[i].key,before[i].requirements[2].key);assert.equal(P.assessAttempt(fragments[i],take(before[i].requirements[2]),{now:NOW}).status,'unrelated-or-stale');}
});

test('adaptation identity, source edition, bounds and scoring tempo are bound together; editorial rationale is not a new performance',()=>{
 const p=copy(plans[0]),r=fragments[0];p.preparationFragments[0].adaptation.targetBpm=55;assert.notEqual(P.compile(p,app.lessons).requirements[2].key,r.key);p.preparationFragments[0].adaptation.targetBpm=56;p.preparationFragments[0].adaptation.id='three-note-repeat-preparation-v2';assert.notEqual(P.compile(p,app.lessons).requirements[2].key,r.key);p.preparationFragments[0].adaptation.id=r.adaptation.id;p.preparationFragments[0].adaptation.rationale='Уточнённое текстовое объяснение';assert.equal(P.compile(p,app.lessons).requirements[2].key,r.key);
 for(const mutate of [r=>r.targetBpm=55,r=>r.adaptation.sourceBpm=60,r=>r.adaptation.version=2,r=>r.adaptation.id='unknown',r=>r.range.lastStep=3,r=>r.steps[1].midis=[61]]){const changed=copy(r);mutate(changed);assert.throws(()=>P.assessAttempt(changed,take(r),{now:NOW}),/CONTRACT_CHANGED/);}
 const lessons=copy(app.lessons),source=lessons.find(l=>l.id===r.lessonId);source.fingeringSpec.steps[0][0].num=2;const changed=P.compile(plans[0],lessons).requirements[2];assert.notEqual(changed.key,r.key);assert.equal(P.assessAttempt(changed,take(r),{now:NOW}).status,'unrelated-or-stale');
});

test('unexplained, faster-than-source or unsupported fragment adaptations fail without changing source lessons',()=>{
 const original=copy(app.lessons);for(const mutate of [a=>a.version=2,a=>a.kind='composer-approved',a=>a.id='',a=>a.targetBpm=0,a=>a.targetBpm=Infinity,a=>a.targetBpm=63,a=>delete a.rationale]){const p=copy(plans[0]);mutate(p.preparationFragments[0].adaptation);assert.throws(()=>P.compile(p,app.lessons),/ADAPTATION_INVALID/);}assert.deepEqual(copy(app.lessons),original);
 const whole=copy(contracts[0].requirements[0]);whole.adaptation=copy(fragments[0].adaptation);assert.throws(()=>P.assessAttempt(whole,take(whole),{now:NOW}),/CONTRACT_CHANGED/);
});

test('a held repeated D/E, missing release, early ending, extra note, wrong input or lower tempo cannot pass the adapted fragment',()=>{
 for(const r of fragments){for(const mutate of [t=>t.events.splice(3,1),t=>t.events.splice(4,1),t=>t.events.pop(),t=>t.events[1].at=t.events[0].at+50,t=>t.events[0].midi++,t=>t.events.filter(e=>e.type==='on').forEach(e=>e.source='keyboard'),t=>t.bpm=55,t=>t.observedUntil--,t=>{const at=t.observedUntil;t.events.push({type:'on',midi:r.steps[0].midis[0],source:'midi',at});}]){const t=take(r);mutate(t);assert.notEqual(P.assessAttempt(r,t,{now:NOW}).status,'matched');}}
});

test('three fragment observations with memory meet only the fragment; full lessons and the opposite hand stay pending',()=>{
 for(const[i,r]of fragments.entries()){const observations=[take(r,0),take(r,1),take(r,2,'memory')],result=P.evaluate(contracts[i],observations,{now:NOW});assert.equal(result.status,'pending');assert.deepEqual(result.requirements.map(x=>x.status),['pending','pending','met']);assert.equal(result.requirements[2].cleanTakes,3);assert.equal(result.requirements[2].memory,true);assert.equal(result.requirements[2].retained,false);assert.equal(result.physicalPerformanceVerified,false);assert.equal(result.fingeringVerified,false);assert.equal(result.teacherReviewed,false);assert.ok(P.evaluate(contracts[1-i],observations,{now:NOW}).requirements.every(x=>x.status==='pending'));
 const full=P.compile({id:'whole-parent',hand:expected[i].hand,requires:[r.lessonId]},app.lessons).requirements[0],t=take(r);t.requirementKey=full.key;assert.equal(P.assessAttempt(full,t,{now:NOW}).status,'rejected');const wholeTake=take(full);wholeTake.requirementKey=r.key;assert.equal(P.assessAttempt(r,wholeTake,{now:NOW}).status,'rejected');}
});

test('known preparation is not a first reading/aural test; assistance, interrupted input, copies and delayed memory retain separate statuses',()=>{
 const r=fragments[0],c=contracts[0];for(const mutate of [t=>t.assisted=true,t=>t.observationInterrupted=true,t=>t.mode='practice']){const t=take(r);mutate(t);assert.equal(P.assessAttempt(r,t,{now:NOW}).status,'rejected');}const t=take(r),renamed={...copy(t),attemptId:'copy',capturedAt:NOW-1,mode:'memory'};assert.equal(P.evaluate(c,[t,renamed],{now:NOW}).requirements[2].cleanTakes,1);const delayed=[take(r,0,'challenge',NOW-DAY-3000),take(r,1,'challenge',NOW-DAY-2000),take(r,2,'memory',NOW-1000)];assert.equal(P.evaluate(c,delayed,{now:NOW}).requirements[2].retained,true);
});

test('fragment journal creation/read has no writes and never reads the whole or legacy progress keys',async()=>{
 const e=environment(),store=S.fragments.create(e);e.map.set(S.STORAGE_KEY,'keep whole');e.map.set('music-learning-piano-v1',' keep all archived/private rows ');assert.deepEqual(e.access,[]);assert.equal((await store.read({now:NOW})).status,'ready');assert.equal(e.map.has(S.fragments.STORAGE_KEY),false);assert.notEqual(S.fragments.LOCK_NAME,S.LOCK_NAME);assert.ok(e.access.every(([action,key])=>action==='lock'?key===S.fragments.LOCK_NAME:action==='read'&&key===S.fragments.STORAGE_KEY));
});

test('two fragment writers preserve both hands, extension data and exact retry under a common fragment lock',async()=>{
 const e=environment(),a=S.fragments.create(e),b=S.fragments.create(e),base={...S.fragments.empty(),personal:{archive:'keep'}};e.map.set(S.fragments.STORAGE_KEY,JSON.stringify(base));const right=entry(fragments[0]),left=entry(fragments[1]);assert.ok((await Promise.all([a.append(right,{now:NOW}),b.append(left,{now:NOW})])).every(x=>x.status==='saved'));const raw=e.map.get(S.fragments.STORAGE_KEY),h=S.fragments.parse(raw,NOW);assert.equal(h.revision,2);assert.deepEqual(h.personal,base.personal);assert.deepEqual(h.entries.map(x=>x.attempt.events[0].midi),[60,48]);assert.equal((await a.append(copy(right),{now:NOW})).status,'saved');assert.equal(e.map.get(S.fragments.STORAGE_KEY),raw);const conflict=entry(fragments[0],2);conflict.attempt.attemptId=right.attempt.attemptId;assert.equal((await b.append(conflict,{now:NOW})).status,'unsaved');assert.equal(e.map.get(S.fragments.STORAGE_KEY),raw);
});

test('neither store accepts the other range/scope and no fragment write changes full or legacy JSON',async()=>{
 const e=environment(),whole=S.create(e),fragment=S.fragments.create(e),old='\n {"archive":{"preserve":true}} \n';e.map.set(S.STORAGE_KEY,old);e.map.set('music-learning-piano-v1',old);assert.equal((await whole.append(entry(fragments[0]),{now:NOW})).code,'WHOLE_PREPARATION_REQUIRED');assert.equal((await fragment.append(entry(contracts[0].requirements[0]),{now:NOW})).code,'FRAGMENT_PREPARATION_REQUIRED');assert.deepEqual(e.access,[]);assert.equal((await fragment.append(entry(fragments[0]),{now:NOW})).status,'saved');assert.equal(e.map.get(S.STORAGE_KEY),old);assert.equal(e.map.get('music-learning-piano-v1'),old);assert.throws(()=>S.parse(e.map.get(S.fragments.STORAGE_KEY),NOW),/LOG_FORMAT/);assert.throws(()=>S.fragments.parse(JSON.stringify(S.empty()),NOW),/LOG_FORMAT/);
});

test('missing locks, broken/future journals and unknown clocks fail closed without resetting any raw data',async()=>{
 const e=environment(),store=S.fragments.create(e);for(const raw of ['{broken',JSON.stringify({...S.fragments.empty(),schemaVersion:2}),JSON.stringify({...S.fragments.empty(),scope:S.SCOPE})]){e.map.set(S.fragments.STORAGE_KEY,raw);assert.equal((await store.read({now:NOW})).status,'blocked');assert.equal((await store.append(entry(fragments[0]),{now:NOW})).status,'unsaved');assert.equal(e.map.get(S.fragments.STORAGE_KEY),raw);}e.map.delete(S.fragments.STORAGE_KEY);assert.equal((await store.read({now:NaN})).code,'PREPARATION_CLOCK_INVALID');assert.equal((await S.fragments.create({storage:e.storage}).append(entry(fragments[0]),{now:NOW})).code,'LOCKS_UNAVAILABLE');assert.equal(e.map.size,0);
});

test('write failure and unconfirmed readback keep the same attempt available for an exact idempotent retry',async()=>{
 const e=environment(),store=S.fragments.create(e),value=entry(fragments[0]),set=e.storage.setItem;e.storage.setItem=()=>{throw Error('quota');};assert.equal((await store.append(value,{now:NOW})).code,'STORAGE_WRITE_FAILED');assert.equal(e.map.size,0);e.storage.setItem=set;let afterWrite=false;const get=e.storage.getItem;e.storage.setItem=(k,v)=>{set(k,v);afterWrite=true;};e.storage.getItem=k=>afterWrite?'unconfirmed':get(k);assert.equal((await store.append(value,{now:NOW})).code,'SAVE_NOT_CONFIRMED');e.storage.getItem=get;e.storage.setItem=set;assert.equal((await store.append(value,{now:NOW})).status,'saved');assert.equal(S.fragments.parse(e.map.get(S.fragments.STORAGE_KEY),NOW).entries.length,1);
});

test('historical fragment editions remain exportable data and do not satisfy a revised 56 BPM requirement',async()=>{
 const e=environment(),store=S.fragments.create(e),old=before[0].requirements[2];assert.equal((await store.append(entry(old),{now:NOW})).status,'saved');assert.equal((await store.append(entry(fragments[0],1),{now:NOW})).status,'saved');const result=await store.read({now:NOW});assert.equal(result.history.entries.length,2);assert.equal(result.history.entries[0].requirement.targetBpm,62);const view=P.evaluate(contracts[0],result.history.entries.map(x=>x.attempt),{now:NOW});assert.equal(view.requirements[2].cleanTakes,1);assert.equal(view.ignored[0].status,'unrelated-or-stale');assert.deepEqual(result.history.entries[0],entry(old));
});

test('a full fragment journal is refused rather than silently pruning archived observations',async()=>{
 const e=environment(),store=S.fragments.create(e),h=S.fragments.empty();h.entries=Array.from({length:S.MAX_ENTRIES},(_,n)=>entry(fragments[0],n));h.entries.forEach(x=>x.attempt.capturedAt=NOW-1);h.revision=S.MAX_ENTRIES;const raw=JSON.stringify(h);e.map.set(S.fragments.STORAGE_KEY,raw);const next=entry(fragments[1]);assert.equal((await store.append(next,{now:NOW})).code,'PREPARATION_LOG_FULL');assert.equal(e.map.get(S.fragments.STORAGE_KEY),raw);
});

test('the browser UMD uses the same scoped grading/storage implementation without accessing browser APIs on import',()=>{
 const context={};vm.createContext(context);for(const p of ['practice-assessment.js','piano-catalog-adapter.js','piano-preparation.js','piano-preparation-store.js'])vm.runInContext(fs.readFileSync(p,'utf8'),context,{filename:p});assert.equal(context.PianoPreparationStore.fragments.STORAGE_KEY,S.fragments.STORAGE_KEY);assert.deepEqual(copy(context.PianoPreparationStore.fragments.parse(null,NOW)),S.fragments.empty());const compiled=context.PianoPreparation.compile(copy(plans[0]),copy(app.lessons));assert.deepEqual(copy(compiled),contracts[0]);assert.equal(context.PianoPreparation.assessAttempt(compiled.requirements[2],take(fragments[0]),{now:NOW}).status,'matched');
});

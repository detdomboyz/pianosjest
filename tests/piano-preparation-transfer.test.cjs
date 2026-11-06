'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../piano-preparation-transfer.js'),P=require('../piano-preparation.js'),S=require('../piano-preparation-store.js'),L=require('../piano-progress-store.js'),C=require('../piano-preparation-capture.js'),F=require('../piano-preparation-fragment.js'),A=require('../practice-assessment.js'),{loadApp}=require('./helpers/load-app.cjs');
const app=loadApp(),lessons=app.lessons,NOW=Date.now(),copy=x=>JSON.parse(JSON.stringify(x));
const requirements=T.currentRequirements(lessons),right=requirements.find(r=>r.lessonId==='course02-02'),fragment=requirements.find(r=>r.lessonId==='course03-06');
function entry(r=right,id='take',shift=0,mode='challenge',capturedAt=NOW-1000){const beat=60000/r.targetBpm,events=r.steps.flatMap(s=>[{type:'on',midi:s.midis[0],source:'midi',at:1000+shift+(s.startBeat-r.steps[0].startBeat)*beat},{type:'off',midi:s.midis[0],at:1000+shift+(s.startBeat-r.steps[0].startBeat+s.durationBeats)*beat}]).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));return {requirement:copy(r),attempt:{schemaVersion:1,attemptId:id,requirementKey:r.key,capturedAt,bpm:r.targetBpm,observedUntil:events.at(-1).at,mode,assisted:false,observationInterrupted:false,timedOut:false,errors:0,events}};}
function journal(profile=S,entries=[]){const h={...profile.empty(),revision:entries.length,entries:copy(entries)};return {storageStatus:'ready',storedHistory:h,storedHistoryRaw:entries.length?JSON.stringify(h):null,recoveryEntries:[]};}
function bundle(){return {schemaVersion:2,kind:'melodiajest-preparation-export',journals:{whole:journal(),fragments:journal(S.fragments)},legacy:{status:'available',raw:'\n {"mine":{"personal":"keep </textarea><script>private","history":{"old":{"memory":true}}}} \n'},completeCopy:true};}
function inspect(b,options={}){return T.inspect(typeof b==='string'?b:JSON.stringify(b),{lessons,now:NOW,...options});}
function withEntries(entries,profile='whole'){const b=bundle();b.journals[profile]=journal(profile==='whole'?S:S.fragments,entries);return b;}

test('v2 preview replays both real scopes, preserves raw personal/archive data and never mutates the source or catalog',()=>{
 const b=withEntries([entry()]);b.journals.fragments=journal(S.fragments,[entry(fragment,'fragment')]);b.notes={owner:'private'};const raw=JSON.stringify(b),before=lessons.map(A.pianoSignature),result=inspect(raw);
 assert.equal(result.status,'valid');assert.equal(result.canWrite,false);assert.deepEqual(result.scopes,['whole','fragments','legacy']);assert.equal(result.whole.currentEntries,1);assert.equal(result.fragments.currentEntries,1);assert.equal(result.legacy.privateRecords,1);assert.equal(result.readiness.find(r=>r.key===right.key).cleanTakes,1);assert.equal(result.physicalPerformanceVerified,false);assert.equal(result.teacherReviewed,false);assert.equal(JSON.stringify(b),raw);assert.deepEqual(lessons.map(A.pianoSignature),before);
});

test('actual capture/export APIs produce accepted v1 and v2; v1 never invents an empty fragment replacement',async()=>{
 const map=new Map(),locks={request:async(name,options,work)=>work({name})},storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},whole=C.create({store:S.create({storage,locks}),now:()=>NOW,id:()=> 'actual-full'}),parts=C.createFragments({store:S.fragments.create({storage,locks}),now:()=>NOW,id:()=> 'actual-fragment'}),e=entry();
 await whole.capture(lessons.find(l=>l.id===right.lessonId),{full:true,...e.attempt});const v1=await whole.exportBundle(()=>null),one=inspect(v1);assert.equal(one.status,'valid');assert.deepEqual(one.scopes,['whole','legacy']);assert.equal(one.fragments,null);assert.equal(one.whole.uniqueEntries,1);
 const both=await C.exportCombined(whole,parts,()=>null);assert.equal(inspect(both.bundle).status,'valid');assert.equal(map.size,1);
});

test('raw journal equivalence allows object field order and whitespace but rejects divergent data',()=>{
 const b=withEntries([entry()]),h=b.journals.whole.storedHistory;b.journals.whole.storedHistoryRaw=' \n'+JSON.stringify({entries:h.entries,revision:h.revision,scope:h.scope,schemaVersion:1})+'\n';assert.equal(inspect(b).status,'valid');
 b.journals.whole.storedHistory.revision++;assert.equal(inspect(b).code,'TRANSFER_RAW_MISMATCH');
});

test('corrupt notes, missing releases, assistance, future clocks and wrong whole/fragment scopes fail the actual assessor',()=>{
 for(const mutate of [e=>e.attempt.events[0].midi++,e=>e.attempt.events.pop(),e=>e.attempt.assisted=true,e=>e.attempt.capturedAt=NOW+1,e=>e.requirement.range.kind='fragment']){const e=entry();mutate(e);assert.equal(inspect(withEntries([e])).status,'invalid');}
 assert.equal(inspect(withEntries([entry(fragment,'wrong-scope')])).status,'invalid');
});

test('unknown valid musical editions remain archives and changed local notes cannot inherit preparation credit',()=>{
 const b=withEntries([entry()]),changed=copy(lessons);changed.find(l=>l.id==='course02-02').rhythm.steps[0].durationBeats=.5;const r=inspect(b,{lessons:changed});assert.equal(r.status,'valid');assert.equal(r.whole.archivedEntries,1);assert.equal(r.whole.currentEntries,0);assert.ok(r.readiness.every(x=>x.cleanTakes===0));
 const e=entry();e.requirement.steps[0].midis[0]++;assert.equal(inspect(withEntries([e])).status,'invalid');
});

test('identical recovery copies and relabelled identical performances never multiply preparation evidence',()=>{
 const b=withEntries([entry()]);b.journals.whole.recoveryEntries=[entry()];let r=inspect(b);assert.equal(r.status,'valid');assert.equal(r.whole.duplicateCopies,1);assert.equal(r.whole.uniqueEntries,1);
 b.journals.whole.recoveryEntries=[entry(right,'copy2',0,'memory',NOW),entry(right,'copy3',0,'challenge',NOW-500)];r=inspect(b);assert.equal(r.whole.uniqueEntries,3);assert.equal(r.readiness.find(x=>x.key===right.key).cleanTakes,1);assert.equal(r.readiness.find(x=>x.key===right.key).memory,false);
});

test('conflicting attempt IDs are rejected within and across journals without dropping either original copy',()=>{
 const b=withEntries([entry()]);b.journals.whole.recoveryEntries=[entry(right,'take',10000)];let raw=JSON.stringify(b);assert.equal(inspect(raw).code,'TRANSFER_ATTEMPT_ID_CONFLICT');assert.equal(JSON.stringify(b),raw);
 b.journals.whole.recoveryEntries=[];b.journals.fragments=journal(S.fragments,[entry(fragment)]);assert.equal(inspect(b).code,'TRANSFER_ATTEMPT_ID_CONFLICT');
});

test('legacy validation preserves real edition archives and receipts while blocking future/contradictory records',()=>{
 let row=A.record(undefined,{instrument:'piano',lessonId:right.lessonId,fingerprint:'11111111',mode:'memory',clean:true,now:NOW-86401000});row.personal='keep';row=L.apply(row,{id:'old-to-current',lessonId:right.lessonId,fingerprint:right.fingerprint,mode:'challenge',clean:true,at:NOW-1000},NOW);
 const b=bundle();b.legacy.raw=JSON.stringify({[right.lessonId]:row,mine:{personal:'keep'}});let r=inspect(b);assert.equal(r.status,'valid');assert.equal(r.legacy.archivedEditions,1);assert.equal(r.legacy.receipts,1);assert.ok(r.readiness.every(x=>x.cleanTakes===0));
 for(const change of [r=>r.version=2,r=>r.cleanTakes=99,r=>r.melodiajestPersistence.version=2,r=>r.history['1:11111111'].version=2]){const bad=copy(b),data=JSON.parse(bad.legacy.raw);change(data[right.lessonId]);bad.legacy.raw=JSON.stringify(data);assert.equal(inspect(bad).status,'invalid');}
});

test('legacy recovery operations are checked and preserved as recovery, never replayed into MIDI credit',()=>{
 const op={id:'pending',lessonId:right.lessonId,fingerprint:right.fingerprint,mode:'memory',clean:true,at:NOW-1000},b=bundle();b.legacyRecovery={schemaVersion:1,kind:'piano-legacy-save-recovery',pending:[op],baseRaw:null,draftRaw:null};const raw=JSON.stringify(b),r=inspect(raw);assert.equal(r.status,'valid');assert.equal(r.legacyRecovery.uniqueOperations,1);assert.equal(r.legacyRecovery.applied,false);assert.ok(r.readiness.every(x=>x.cleanTakes===0));assert.equal(JSON.stringify(b),raw);
 b.legacyRecovery.pending.push({...op,clean:false});assert.equal(inspect(b).code,'TRANSFER_OPERATION_ID_CONFLICT');b.legacyRecovery.pending=[{...op,at:NOW+1}];assert.equal(inspect(b).status,'invalid');
});

test('a receipt with the same ID and different recovery payload is a conflict, including archived receipts',()=>{
 const b=bundle(),op={id:'same-save',lessonId:right.lessonId,fingerprint:right.fingerprint,mode:'challenge',clean:true,at:NOW-1000};b.legacy.raw=JSON.stringify({[right.lessonId]:L.apply(undefined,op,NOW)});b.legacyRecovery={schemaVersion:1,kind:'piano-legacy-save-recovery',pending:[{...op,mode:'memory'}],baseRaw:null,draftRaw:null};assert.equal(inspect(b).code,'TRANSFER_OPERATION_ID_CONFLICT');
});

test('unavailable/raw damaged backups stay incomplete, and unsupported envelopes or a false completeness claim cannot pass',()=>{
 const b=bundle();b.journals.whole={storageStatus:'unavailable',storedHistory:null,storedHistoryRaw:'{damaged',recoveryEntries:[entry()]};b.completeCopy=false;const raw=JSON.stringify(b),r=inspect(raw);assert.equal(r.status,'incomplete');assert.equal(r.whole.recoveryEntries,1);assert.equal(JSON.stringify(b),raw);b.completeCopy=true;assert.equal(inspect(b).code,'TRANSFER_COMPLETENESS');
 assert.equal(inspect({...bundle(),schemaVersion:99}).status,'unsupported');assert.equal(inspect('[]').code,'TRANSFER_KIND');assert.equal(inspect('{').code,'TRANSFER_JSON');
});

test('an export made during a pending transfer is explicitly incomplete even when all active keys were readable',()=>{const b=bundle();b.transferArchive={status:'available',raw:JSON.stringify({schemaVersion:1,kind:'piano-preparation-transfer-backups',operations:[{phase:'prepared'}]})};const r=inspect(b);assert.equal(r.status,'incomplete');assert.equal(r.archivePending,true);assert.equal(r.completeCopy,true);assert.equal(r.canWrite,false);});

test('an over-capacity recovery archive is reported incomplete without truncating observations or inventing readiness',()=>{
 const b=withEntries(Array.from({length:S.MAX_ENTRIES},(_,i)=>entry(right,'stored-'+i,i*10000)));b.journals.whole.recoveryEntries=[entry(right,'extra',9999999)];const raw=JSON.stringify(b),r=inspect(raw);assert.equal(r.status,'incomplete');assert.equal(r.whole.uniqueEntries,S.MAX_ENTRIES+1);assert.equal(r.whole.capacityExceeded,true);assert.equal(JSON.stringify(b),raw);
});

test('duplicate decoded JSON names, nested raw duplicates, excessive depth, unsafe numbers and oversize input are rejected without truncation',()=>{
 const raw=JSON.stringify(bundle());assert.equal(inspect(raw.replace('"schemaVersion":2','"schemaVersion":1,"schemaVersion":2')).code,'TRANSFER_DUPLICATE_KEY');assert.equal(inspect(raw.replace('"schemaVersion":2',String.raw`"schemaVersion":2,"\u0073chemaVersion":2`)).code,'TRANSFER_DUPLICATE_KEY');
 const b=bundle();b.legacy.raw='{"mine":{"note":1,"note":2}}';assert.equal(inspect(b).code,'TRANSFER_DUPLICATE_KEY');
 assert.equal(inspect('['.repeat(T.MAX_DEPTH+1)+'0'+']'.repeat(T.MAX_DEPTH+1)).code,'TRANSFER_DEPTH');assert.equal(inspect(raw.replace('"completeCopy":true','"completeCopy":true,"private":1e400')).code,'TRANSFER_NUMBER_RANGE');
 const huge=' '.repeat(T.MAX_CHARS+1);assert.equal(inspect(huge).code,'TRANSFER_SIZE');assert.equal(huge.length,T.MAX_CHARS+1);
});

test('store inspection shares live validation, rejects malformed archive/receipt identity and leaves unrelated private rows alone',()=>{
 assert.equal(L.isOperation({id:''},NOW),false);assert.equal(L.isOperation(null,NOW),false);
 const raw=' {"mine":{"history":{"old":{"memory":true}},"private":"keep"}} ';assert.equal(L.inspect(raw,NOW).privateRecords,1);assert.equal(raw.trim().startsWith('{'),true);
 const op={id:'one',lessonId:right.lessonId,fingerprint:right.fingerprint,mode:'challenge',clean:true,at:NOW-1},row=L.apply(undefined,op,NOW);row.melodiajestPersistence.receipts[0].lessonId='other';assert.throws(()=>L.inspect(JSON.stringify({[right.lessonId]:row}),NOW),/LEGACY_RECEIPTS_UNSUPPORTED/);
});

test('the actual preview handler writes nothing, escapes input and hides input/results throughout memory and active assessment',()=>{
 let accesses=0;const a=loadApp({events:true,storage:{getItem(){accesses++;return null;},setItem(){accesses++;throw Error('no writes');}}}),b=bundle();accesses=0;a.state.preparationImportText=JSON.stringify(b);a.inspectPreparationImport();assert.equal(a.state.preparationInspection.status,'valid');assert.equal(accesses,0);assert.match(a.preparationLogHtml(),/Проверить JSON без сохранения/);assert.match(a.preparationLogHtml(),/&lt;\/textarea&gt;/);assert.doesNotMatch(a.preparationInspectionText(a.state.preparationInspection),/<script>/);
 for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.doesNotMatch(a.preparationLogHtml(),/preparation-import-text|preparation-inspection-result|private/);const previous=a.state.preparationInspection;a.state.preparationImportText='{';a.inspectPreparationImport();assert.equal(a.state.preparationInspection,previous);}
 a.state.attemptMode='challenge';a.state.started=true;a.state.completed=false;assert.equal(a.preparationInspectionHtml(),'');assert.equal(accesses,0);
});

test('browser UMD and CommonJS preview use the same executable implementation',()=>{
 const window={PianoPreparation:P,PianoPreparationStore:S,PianoProgressStore:L,PianoPreparationCapture:C,PianoPreparationFragment:F};vm.runInNewContext(fs.readFileSync('piano-preparation-transfer.js','utf8'),{window});assert.deepEqual(copy(window.PianoPreparationTransfer.inspect(JSON.stringify(bundle()),{lessons,now:NOW})),inspect(bundle()));
});

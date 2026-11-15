'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs'),before=require('./fixtures/piano-before-f-upper-readiness-v1.json'),H=require('./helpers/piano-f-upper-history.cjs');
const app=loadApp(),id=before.lessonId,l=app.lessons.find(x=>x.id===id),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function take(notes=l.steps.map(s=>app.stepMidiList(s)[0])){const b=60000/44;return notes.flatMap((m,i)=>{const s=l.rhythm.steps[i];return[{type:'on',source:'midi',midi:m,at:1000+s.startBeat*b},{type:'off',source:'midi',midi:m,at:1000+(s.startBeat+1)*b}];}).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));}

test('one instruction edition changes; all592 scores,591 other complete records and route IDs stay exact',()=>{
 assert.deepEqual(copy(app.lessons.filter(x=>before.catalog.some(old=>old.id===x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));assert.deepEqual(copy(app.themes.filter(x=>before.themes.some(y=>y.id===x.id))),before.themes);
 for(const row of before.catalog){const now=app.lessons.find(x=>x.id===row.id);assert.equal(hash({steps:now.steps,rhythm:now.rhythm,fingeringSpec:now.fingeringSpec,contentKind:now.contentKind}),row.musicSha256,row.id);assert.equal(A.pianoSignature(now),row.grade);assert.equal(now.order,row.order);assert.equal(now.themeId,row.themeId);if(row.id!==id)assert.equal(hash(now),row.fullRecordSha256,row.id);}
 assert.deepEqual(H.project(l),before.target);const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id).filter(id=>before.pianoRoute.includes(id))),before.pianoRoute);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lesson-review-baseline.js')).digest('hex'),before.protectedBaselineSha256);
});

test('real bounded migration replays the frozen edition once and preserves personal display order',()=>{
 const x=copy(before.target);assert.equal(P.reviewFMajorUpperReadiness([x]),1);assert.deepEqual(x,copy(l));const saved=copy(x);assert.equal(P.reviewFMajorUpperReadiness([x]),0);assert.deepEqual(x,saved);const ordered=copy(before.target);ordered.order=997;assert.equal(P.reviewFMajorUpperReadiness([ordered]),1);assert.equal(ordered.order,997);
});

test('personal teaching,score and classification changes prevent replacement',()=>{
 const edits=[x=>x.title+=' private',x=>x.description='private',x=>x.guide.mastery='private',x=>x.learning.requires=['private'],x=>x.learning.practiceSteps[4]='private',x=>x.learning.selfCheck[0]='private',x=>x.learning.provenance.sourceNote='private',x=>x.learning.extra='private',x=>x.learning.contentReview={id:'private'},x=>x.pattern+=' y',x=>x.steps[0].keys=['y'],x=>x.rhythm.steps[0].durationBeats=.5,x=>x.rhythm.practiceBpm=48,x=>x.fingeringSpec.steps[0][0].num=2,x=>x.handMode='left',x=>x.contentKind='piece',x=>x.exam=true,x=>x.timeLimit=999];
 for(const edit of edits){const x=copy(before.target);edit(x);const saved=copy(x);assert.equal(P.reviewFMajorUpperReadiness([x]),0);assert.deepEqual(x,saved);}
});

test('archived history projection rejects edited current,archived or server teaching editions',()=>{
 assert.deepEqual(H.project(l),before.target);for(const edit of [x=>x.guide.mastery='tampered',x=>x.learning.contentReview.previousInstruction.learning.goal='tampered',x=>x.learning.contentReview.sourceFingerprint='unknown',x=>x.learning.contentReview.extra='unknown']){const x=copy(l);edit(x);assert.throws(()=>H.project(x));}const row=copy(require('../service/course-registry.json').lessons.find(x=>x.id===id));assert.deepEqual(H.project(row),before.server.targetRow);row.editionVersion='f'.repeat(64);assert.throws(()=>H.project(row));
});

test('existing right-hand prerequisites already include the familiar1-to-4 group without a route change',()=>{
 const seen=new Set(),walk=id=>{if(seen.has(id))return;seen.add(id);const x=app.lessons.find(x=>x.id===id);assert.ok(x);assert.notEqual(x.contentKind,'piece');assert.ok(x.fingeringSpec.steps.every(s=>s.every(n=>n.hand==='right')));for(const r of x.learning?.requires||[])walk(r);};walk(id);assert.ok(seen.has('course02-03'));assert.deepEqual(copy(l.learning.requires),copy(before.target.learning.requires));const p=app.lessons.find(x=>x.id==='course02-03');assert.deepEqual(copy(p.steps.slice(0,4).map(app.stepMidiList)),[[60],[62],[64],[65]]);assert.deepEqual(copy(p.fingeringSpec.steps.slice(0,4).map(s=>s[0].num)),[1,2,3,4]);
});

test('upper group is explicitly manual while actual MIDI grade still accepts only the original8 notes',()=>{
 const row=require('../service/course-registry.json').lessons.find(x=>x.id===id),clean=take(),upper=take([72,74,76,77]);assert.equal(G.grade(row,G.eventsInput(clean,clean.at(-1).at),'challenge',clean.at(-1).at,false).assessment.clean,true);assert.equal(G.grade(row,G.eventsInput(upper,upper.at(-1).at),'challenge',upper.at(-1).at,false).assessment.clean,false);assert.equal(row.goalKey,before.server.targetRow.goalKey);assert.equal(row.gradeFingerprint,before.server.targetRow.gradeFingerprint);assert.equal(row.musicVersion,before.server.targetRow.musicVersion);
});

test('retained local progress survives instruction migration and the original MIDI memory performance',async()=>{
 let progress;const grade=A.pianoSignature(before.target);for(let i=0;i<3;i++)progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:grade,mode:i===2?'memory':'challenge',clean:true,now:1000+i*1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:grade,mode:'memory',clean:true,now:86404000});assert.equal(progress.retained,true);
 const storage=require('./helpers/memory-storage.cjs').createMemoryStorage();storage.setItem('music-learning-piano-v1',JSON.stringify({[id]:progress}));const clock={now:172804000},a=loadApp({events:true,clock,storage,locks:{request:async(n,o,fn)=>fn({name:n})}});a.loadLearningProgress();a.setTestLesson(a.lessons.find(x=>x.id===id));a.state.attemptMode='memory';const es=take();for(const[i,e]of es.entries()){clock.now=172804000+e.at-1000;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===es.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].retained,true);assert.equal(a.state.learningProgress[id].fingerprint,grade);await a.legacyProgressStore.settled();a.resetLessonState();
});

test('catalog import upgrades the exact old builtin and retains personal editions and history',async()=>{
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),snapshot=a.catalogSnapshot(),i=snapshot.lessons.findIndex(x=>x.id===id);snapshot.lessons[i]=copy(before.target);assert.equal(a.applyCatalogSnapshot(snapshot),true);let x=a.lessons.find(x=>x.id===id);assert.deepEqual(copy(x.learning.contentReview.previousInstruction),{guide:before.target.guide,learning:before.target.learning});x.contentKind='piece';x.order=1;a.lessons.find(x=>x.id==='detail-p-f-major-fourth-thumb-prep-right-01').order=2;x.guide.setup='personal';x.learning.practiceSteps[0]='personal';const saved=copy(x);a.installReviewedLessons();assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);x=a.lessons.find(x=>x.id===id);assert.equal(x.order,1);assert.equal(x.contentKind,'piece');assert.equal(x.guide.setup,'personal');assert.equal(x.learning.practiceSteps[0],'personal');assert.deepEqual(copy(x.learning.contentReview),saved.learning.contentReview);assert.equal(a.lessons.filter(x=>x.id===id).length,1);
});

test('server changes exactly one editorial version and preserves443 other rows,all444 music versions and schema2',()=>{
 const c=require('../service/course-registry.json');assert.deepEqual(c,copy(require('../tools/build-service-curriculum.cjs').build()));assert.deepEqual(c.route.filter(id=>before.server.route.includes(id)),before.server.route);for(const old of before.server.lessons){const x=c.lessons.find(x=>x.id===old.id);assert.equal(x.musicVersion,old.musicVersion);assert.equal(x.gradeFingerprint,old.gradeFingerprint);if(old.id!==id)assert.equal(hash(x),old.fullRecordSha256);else{assert.notEqual(x.editionVersion,old.editionVersion);assert.deepEqual({...copy(x),editionVersion:old.editionVersion},before.server.targetRow);}}
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('service/schema.pg.sql')).digest('hex'),before.server.schemaSha256);
});

test('dated primary sources and teaching boundaries survive compact,expanded and all3 memory modes',()=>{
 const ledger=require('../docs/piano-curriculum-sources.json');for(const source of l.learning.sourceEvidenceIds)assert.ok(ledger.entries.find(e=>e.id===source)?.applications.some(a=>a.batch==='2026-11-09-08'&&a.verifiedOn==='2026-11-09'&&a.lessonIds.includes(id)),source);app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const s of ['C5–D5–E5–F5','John Wiles','MIDI-попытки','не входят','результат автоматически не сохраняется','не новая самостоятельная цель','после перерыва','отпусти F5'])assert.ok(html.includes(s),s);assert.equal(l.learning.practiceSteps.length,5);for(const mode of ['compact','expanded','hidden']){app.state.attemptMode='memory';app.state.learningMaterialMode=mode;assert.equal(app.learningMaterialHtml(),'');}
 const counts=require('../tools/piano-skill-coverage.cjs').build().counts,expected=require('./fixtures/piano-curriculum-counts.json');for(const k of Object.keys(counts))assert.equal(counts[k],expected[k],k);
});

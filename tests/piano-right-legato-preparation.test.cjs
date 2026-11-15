'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const before=require('./fixtures/piano-before-right-legato-preparation-v1.json'),after=require('./fixtures/piano-right-legato-preparation-v2.json'),H=require('./helpers/piano-right-legato-history.cjs');
const app=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'),ids=after.lessonIds;
const required={'detail-p-legato-01':['course01-03','detail-p-release-03'],'detail-p-legato-03':['detail-p-legato-01']};
function performance(l){const beat=60000/l.rhythm.practiceBpm;return l.rhythm.steps.flatMap((s,i)=>[{type:'on',source:'midi',midi:app.stepMidiList(l.steps[i])[0],at:1000+s.startBeat*beat},{type:'off',midi:app.stepMidiList(l.steps[i])[0],at:1000+(s.startBeat+s.durationBeats)*beat}]).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));}

test('only two named prerequisite editions change; all591 scores and589 complete records stay exact',()=>{
 assert.deepEqual(copy(app.lessons.filter(x=>before.catalog.some(o=>o.id===x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));assert.deepEqual(copy(app.themes.filter(x=>before.themes.some(y=>y.id===x.id))),before.themes);
 for(const old of before.catalog){const now=app.lessons.find(x=>x.id===old.id);assert.equal(hash({steps:now.steps,rhythm:now.rhythm,fingeringSpec:now.fingeringSpec,contentKind:now.contentKind}),old.musicSha256,old.id);assert.equal(A.pianoSignature(now),old.grade);assert.equal(now.order,old.order);assert.equal(now.themeId,old.themeId);if(!ids.includes(old.id))assert.equal(hash(now),old.fullRecordSha256,old.id);}
 for(const id of ids){const now=copy(app.lessons.find(x=>x.id===id)),old=before.targets[id];assert.deepEqual(now.learning.requires,required[id]);assert.equal(now.learning.after,old.learning.after);assert.deepEqual(now.learning.contentReview.previousInstruction,{guide:old.guide,learning:old.learning});now.guide=copy(old.guide);now.learning=copy(old.learning);assert.deepEqual(now,old);}
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lesson-review-baseline.js')).digest('hex'),before.protectedBaselineSha256);
});

test('real bounded migration replays each frozen edition once and retains personal display order',()=>{
 for(const id of ids){const l=copy(before.targets[id]);assert.equal(P.reviewRightLegatoPrerequisites([l]),1);assert.deepEqual(l,copy(app.lessons.find(x=>x.id===id)));const saved=copy(l);assert.equal(P.reviewRightLegatoPrerequisites([l]),0);assert.deepEqual(l,saved);const ordered=copy(before.targets[id]);ordered.order=997;assert.equal(P.reviewRightLegatoPrerequisites([ordered]),1);assert.equal(ordered.order,997);}
});

test('any personal teaching,musical or review-tag edit blocks replacement without modifying it',()=>{
 const edits=[l=>l.title+=' private',l=>l.description='private',l=>l.guide.motion='private',l=>l.learning.requires=['private'],l=>l.learning.after='private',l=>l.learning.practiceSteps[0]='private',l=>l.learning.selfCheck[0]='private',l=>l.learning.contentReview.reviewedFingerprint='private',l=>l.learning.contentReview.extra='private',l=>l.learning.contentReview.sourceFingerprint='private',l=>l.pattern+=' y',l=>l.steps[0].keys=['y'],l=>l.rhythm.steps[0].durationBeats=.5,l=>l.rhythm.practiceBpm=40,l=>l.fingeringSpec.steps[0][0].num=3,l=>l.handMode='left',l=>l.contentKind='piece'];
 for(const id of ids)for(const edit of edits){const l=copy(before.targets[id]);edit(l);const saved=copy(l);assert.equal(P.reviewRightLegatoPrerequisites([l]),0,id);assert.deepEqual(l,saved);}
});

test('archived historical hash guards reject instruction,history and server-row tampering',()=>{
 for(const id of ids){const l=copy(app.lessons.find(x=>x.id===id));assert.deepEqual(H.project(l),before.targets[id]);for(const edit of [l=>l.guide.motion='private',l=>l.learning.requires=['course03-02'],l=>l.learning.contentReview.previousInstruction.learning.goal='tampered',l=>l.learning.contentReview.sourceFingerprint='unknown']){const x=copy(l);edit(x);assert.throws(()=>H.project(x));}const row=copy(after.serverRows[id]);row.editionVersion='f'.repeat(64);assert.throws(()=>H.project(row));}
});

test('named preparation graph uses existing right-hand skills while display and sequential order stay exact',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const plan=c.MUSIC_CURRICULUM_PLAN.piano,route=plan.map(x=>x.id);assert.deepEqual(copy(route.filter(id=>before.pianoRoute.includes(id))),before.pianoRoute);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);
 for(const id of ids){const seen=new Set(),walk=id=>{if(seen.has(id))return;seen.add(id);const l=app.lessons.find(x=>x.id===id);assert.ok(l,id);assert.notEqual(l.contentKind,'piece');assert.ok(l.fingeringSpec.steps.every(s=>s.every(n=>n.hand==='right')),id);for(const r of l.learning.requires||[]){assert.ok(route.indexOf(r)<route.indexOf(id),r+' before '+id);walk(r);}};walk(id);assert.deepEqual(copy(plan.find(x=>x.id===id).preparation),required[id]);}
 // Display anchors intentionally remain interleaved. This correction does not
 // promise a new right-hand-only sequential server course.
 assert.ok(route.indexOf('course03-02')<route.indexOf(ids[0]));
});

test('server changes exactly two editorial versions and keeps every musical version,goal and schema',()=>{
 const c=require('../service/course-registry.json');assert.deepEqual(c,copy(require('../tools/build-service-curriculum.cjs').build()));assert.deepEqual(c.route.filter(id=>before.server.route.includes(id)),before.server.route);assert.deepEqual(c.lessons.filter(x=>before.server.lessons.some(o=>o.id===x.id)).map(x=>x.id),before.server.lessons.map(x=>x.id));
 for(const old of before.server.lessons){const now=c.lessons.find(x=>x.id===old.id);assert.equal(now.musicVersion,old.musicVersion);assert.equal(now.gradeFingerprint,old.gradeFingerprint);if(!ids.includes(old.id))assert.equal(hash(now),old.fullRecordSha256,old.id);else{assert.notEqual(now.editionVersion,old.editionVersion);const restored={...copy(now),requires:before.server.targetRows[old.id].requires,editionVersion:old.editionVersion};assert.deepEqual(restored,before.server.targetRows[old.id]);assert.deepEqual(now,after.serverRows[old.id]);}}
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('service/schema.pg.sql')).digest('hex'),before.server.schemaSha256);
});

test('retained local progress survives the instruction migration and actual MIDI completion',async()=>{
 for(const id of ids){let progress;const grade=A.pianoSignature(before.targets[id]);for(let i=0;i<3;i++)progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:grade,mode:i===2?'memory':'challenge',clean:true,now:1000+i*1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:grade,mode:'memory',clean:true,now:86404000});assert.equal(progress.retained,true);
  const storage=require('./helpers/memory-storage.cjs').createMemoryStorage(),clock={now:172804000};storage.setItem('music-learning-piano-v1',JSON.stringify({[id]:progress}));const a=loadApp({events:true,clock,storage,locks:{request:async(n,o,fn)=>fn({name:n})}});a.loadLearningProgress();a.setTestLesson(a.lessons.find(x=>x.id===id));a.state.attemptMode='memory';for(const[i,e]of performance(a.state.lesson).entries()){clock.now=172804000+e.at-1000;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===performance(a.state.lesson).length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].fingerprint,grade);assert.equal(a.state.learningProgress[id].retained,true);await a.legacyProgressStore.settled();a.resetLessonState();}
});

test('catalog import installs exact old builtins but preserves personal instructions,classification and history',async()=>{
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),snapshot=a.catalogSnapshot();for(const id of ids){const index=snapshot.lessons.findIndex(x=>x.id===id);snapshot.lessons[index]=copy(before.targets[id]);}assert.equal(a.applyCatalogSnapshot(snapshot),true);for(const id of ids)assert.equal(a.lessons.find(x=>x.id===id).learning.contentReview.id,after.reviewId);
 for(const[i,id]of ids.entries()){const l=a.lessons.find(x=>x.id===id);l.contentKind='piece';l.order=2-i;l.guide.setup='personal';l.learning.practiceSteps[0]='personal';}const saved=ids.map(id=>copy(a.lessons.find(x=>x.id===id)));a.installReviewedLessons();assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);for(const[i,id]of ids.entries()){const l=a.lessons.find(x=>x.id===id);assert.equal(l.contentKind,'piece');assert.equal(l.order,2-i);assert.equal(l.guide.setup,'personal');assert.equal(l.learning.practiceSteps[0],'personal');assert.deepEqual(copy(l.learning.contentReview),saved[i].learning.contentReview);assert.equal(a.lessons.filter(x=>x.id===id).length,1);}
});

test('dated primary-source applications and all six memory views retain the honest teaching boundaries',()=>{
 const ledger=require('../docs/piano-curriculum-sources.json');for(const id of ids){const l=app.lessons.find(x=>x.id===id);for(const source of l.learning.sourceEvidenceIds)assert.ok(ledger.entries.find(e=>e.id===source)?.applications?.some(a=>a.batch==='2026-11-09-06'&&a.verifiedOn==='2026-11-09'&&a.lessonIds.includes(id)),source);app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';assert.match(app.learningMaterialHtml(),/MIDI/);if(id==='detail-p-legato-03'){assert.doesNotMatch(app.learningMaterialHtml(),/Эти ноты разобраны/);assert.match(app.learningMaterialHtml(),/Сначала повтори связную пару C4–D4/);assert.match(app.learningMaterialHtml(),/найди E4 средним пальцем 3/);}for(const mode of ['compact','expanded','hidden']){app.state.attemptMode='memory';app.state.learningMaterialMode=mode;assert.equal(app.learningMaterialHtml(),'');}}
 const expected=require('./fixtures/piano-curriculum-counts.json'),counts=require('../tools/piano-skill-coverage.cjs').build().counts;for(const k of Object.keys(counts))assert.equal(counts[k],expected[k],k);
});

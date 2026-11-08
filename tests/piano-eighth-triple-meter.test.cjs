'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const originals=require('./fixtures/piano-eighth-pairs-triple-meter-v1.json'),published=require('./fixtures/piano-before-eighth-pairs-triple-meter-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[
 {id:'course04-06',notes:[60,62,64,65,67,65,64,62,60,62,64,65,67,65,64,62],digits:[1,2,3,4,5,4,3,2,1,2,3,4,5,4,3,2],starts:[0,.5,1,1.5,2,2.5,3,3.5,5,5.5,6,6.5,7,7.5,8,8.5],duration:.5,bpm:60,meter:4,grade:'8cea360f',requires:['detail-p-rhythm-04','course02-05','course04-05'],next:'course04-08'},
 {id:'course04-07',notes:[60,62,64,62,64,65,64,65,67,65,64,62],digits:[1,2,3,2,3,4,3,4,5,4,3,2],starts:[0,1,2,3,4,5,6,7,8,9,10,11],duration:1,bpm:66,meter:3,grade:'3f362035',requires:['course04-01','course02-05'],next:'course04-06'}
];
const stepsFor=e=>e.notes.map((m,i)=>({midis:[m],startBeat:e.starts[i],durationBeats:e.duration}));
const eventsFor=e=>e.notes.flatMap((m,i)=>[{type:'on',midi:m,at:1000+e.starts[i]*60000/e.bpm,source:'midi',step:i,velocity:.5},{type:'off',midi:m,at:1000+(e.starts[i]+e.duration)*60000/e.bpm-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('independent eighth and triple-meter scores keep exact notes, fingers, pause, bars and old grades',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id),old=originals.find(o=>o.lesson.id===e.id).lesson;
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(g=>g[0].num)),e.digits);assert.ok(l.fingeringSpec.steps.every(g=>g.length===1&&g[0].hand==='right'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===e.duration));assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:e.meter,denominator:4});assert.equal(l.rhythm.practiceBpm,e.bpm);assert.deepEqual(copy(l.rhythm),old.rhythm);assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),e.grade);assert.equal(l.learning.ending,undefined);
 }
 const eighth=app.lessons.find(l=>l.id==='course04-06');assert.deepEqual(copy(eighth.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]);assert.equal(eighth.rhythm.steps[8].measure,2);assert.equal(eighth.rhythm.steps[8].beatInMeasure,1);assert.equal(eighth.rhythm.steps.at(-1).measure,3);
});

test('all 572 published 23.5.37 musical payloads, signatures, IDs and relative order survive the instruction review',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(crypto.createHash('sha256').update(JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old))).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);assert.equal(l.contentKind,old.kind);}
});

test('both guarded instruction reviews archive the published edition and are idempotent',()=>{
 const lessons=originals.map(o=>copy(o.lesson));assert.equal(typeof P.reviewEighthPairsAndTripleMeter,'function');assert.equal(P.reviewEighthPairsAndTripleMeter(lessons,adapter),2);
 for(const o of originals){const l=lessons.find(l=>l.id===o.lesson.id),r=l.learning.contentReview;assert.equal(r.id,'eighth-pairs-and-triple-meter-v1');assert.equal(r.sourceFingerprint,o.instructionFingerprint);assert.equal(r.previousAssessmentFingerprint,o.assessmentFingerprint);assert.deepEqual(r.previousInstruction,{description:o.lesson.description,guide:o.lesson.guide,learning:o.lesson.learning});}
 assert.equal(P.reviewEighthPairsAndTripleMeter(lessons,adapter),0);
});

test('personal descriptions, rhythm, fingers, classification and review records remain untouched',()=>{
 assert.equal(typeof P.reviewEighthPairsAndTripleMeter,'function');
 for(const o of originals)for(const edit of [l=>l.title+=' моё',l=>l.description='Мой счёт',l=>l.guide.motion='Моё движение',l=>l.learning.goal='Моя цель',l=>l.learning.practiceSteps=['Мои шаги'],l=>l.learning.requires=['private'],l=>l.learning.articulation='staccato',l=>l.rhythm.steps[0].durationBeats=.25,l=>l.rhythm.timeSignature.numerator=2,l=>l.fingeringSpec.steps[0][0].num=3,l=>l.exam=true,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'private'}]){const l=copy(o.lesson);edit(l);const before=copy(l);assert.equal(P.reviewEighthPairsAndTripleMeter([l],adapter),0);assert.deepEqual(l,before);}
});

test('both goals use prepared right-hand movement and independent rhythmic prerequisites',()=>{
 const ids=require('../tools/build-curriculum-plan.cjs').build().piano.map(x=>x.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.stage,'p3');assert.equal(l.learning.nextLessonId,e.next);assert.ok(ids.indexOf(e.next)>ids.indexOf(e.id));assert.ok(e.requires.every(id=>ids.indexOf(id)>=0&&ids.indexOf(id)<ids.indexOf(e.id)),e.id);assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.coverageDomain,'rhythm');assert.ok(l.learning.sourceEvidenceIds.includes('omt-simple-counting-2026-11-05'));assert.ok(l.learning.practiceSteps.some(x=>/3–5 минут/.test(x)));assert.ok(l.learning.practiceSteps.some(x=>/на следующий день/.test(x)));}
 assert.ok(!app.lessons.find(l=>l.id==='course04-07').learning.requires.includes('course04-06'),'three-beat grouping does not require eighth-note speed');
});

test('real assessor rejects large unequal-eighth errors and shortened silence while timing tolerance and accents remain explicit limits',()=>{
 for(const e of cases){const options={steps:stepsFor(e),bpm:e.bpm,targetBpm:e.bpm,profile:'standard'},events=eventsFor(e);assert.equal(A.assessPiano({...options,events}).clean,true);const wrong=events.map((x,i)=>i===0?{...x,midi:61}:x);assert.equal(A.assessPiano({...options,events:wrong}).clean,false);}
 const e=cases[0],options={steps:stepsFor(e),bpm:e.bpm,targetBpm:e.bpm,profile:'standard'},events=eventsFor(e);
 const withinTolerance=events.map(x=>x.step%2?{...x,at:x.at+200}:x);assert.equal(A.assessPiano({...options,events:withinTolerance}).clean,true,'a clean score does not prove exact equal subdivision inside the existing tolerance');
 const swing=events.map(x=>x.step%2?{...x,at:x.at+350}:x);assert.equal(A.assessPiano({...options,events:swing}).clean,false);
 const noRest=events.map(x=>x.step>=8?{...x,at:x.at-1000}:x);assert.equal(A.assessPiano({...options,events:noRest}).clean,false);
 const t=cases[1],wrongAccent=eventsFor(t).map(x=>({...x,velocity:x.step%3===0?.1:.99}));assert.equal(A.assessPiano({steps:stepsFor(t),bpm:t.bpm,targetBpm:t.bpm,profile:'standard',events:wrongAccent}).clean,true,'current scorer checks timing/notes, not expressive accents');
});

test('real MIDI handler completes after the written final release without adding silence to fill a bar',()=>{
 for(const e of cases){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===e.id);a.setTestLesson(l);a.state.attemptMode='challenge';const events=eventsFor(e);
  for(const[i,x]of events.entries()){clock.now=x.at;if(i===events.length-1)assert.equal(a.state.completed,false);if(x.type==='on')a.handleNoteOn(x.midi,'midi');else a.handleNoteOff(x.midi);}
  assert.equal(a.state.completed,true);assert.equal(a.state.passed,true);a.resetLessonState();
 }
});

test('actual study cards explain shifted re-entry and triple grouping but never put answers in memory DOM',()=>{
 const a=loadApp();a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';
 for(const e of cases){a.state.lesson=a.lessons.find(l=>l.id===e.id);a.state.stepIndex=0;const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.ok(e.requires.every(id=>html.includes(id)));
  if(e.id==='course04-06'){assert.match(html,/пауза.*4–5/);assert.match(html,/второго такта.*«два/);}else{assert.match(html,/четыре такта/);assert.match(html,/MIDI.*акцент/);}
  for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/C4|D4|3\/4|4–5|палец|доля/);}a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';
 }
});

test('catalog/progress transfer keeps private editions, old grade keys and instruction history',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const[i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Моя редакция '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);assert.equal(JSON.stringify(a.state.learningProgress),raw);
 for(const e of cases){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Моя редакция '+e.id);assert.equal(A.pianoSignature(l),e.grade);assert.ok(l.learning.contentReview?.previousInstruction);}
});

'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const originals=require('./fixtures/piano-quarter-pulse-rests-v1.json'),published=require('./fixtures/piano-before-quarter-pulse-rests-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[
 {id:'course04-01',notes:Array(8).fill(60),digits:Array(8).fill(1),starts:[0,1,2,3,4,5,6,7],bpm:60,grade:'1caa7198',rests:[],requires:['course01-01','detail-p-release-01'],next:'course04-02'},
 {id:'course04-05',notes:[60,60,62,62,64,64],digits:[1,1,2,2,3,3],starts:[0,2,4,6,8,10],bpm:60,grade:'c3f45176',rests:[1,2,3,4,5],requires:['course04-01','course02-02','detail-p-release-01'],next:'course04-06'},
 {id:'detail-p-rhythm-03',notes:[60,60,60,60],digits:[1,1,1,1],starts:[0,2,4,6],bpm:56,grade:'b069d73d',rests:[1,2,3],requires:['detail-p-rhythm-02'],next:'detail-p-rhythm-final-rest-01',scopeOnly:true}
];
const stepsFor=e=>e.notes.map((m,i)=>({midis:[m],startBeat:e.starts[i],durationBeats:1}));
const eventsFor=e=>e.notes.flatMap((m,i)=>[{type:'on',midi:m,at:1000+e.starts[i]*60000/e.bpm,source:'midi',step:i},{type:'off',midi:m,at:1000+(e.starts[i]+1)*60000/e.bpm-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('quarter pulse and internal rests preserve independently specified hands, attacks, fingers and old grades',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id),old=originals.find(o=>o.lesson.id===e.id).lesson;
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),e.digits);assert.ok(l.fingeringSpec.steps.every(g=>g.length===1&&g[0].hand==='right'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),e.starts.map((_,i)=>e.rests.includes(i)?1:0));assert.equal(l.rhythm.practiceBpm,e.bpm);
  assert.deepEqual(copy(l.rhythm),old.rhythm);assert.equal(l.learning.articulation,old.learning.articulation);assert.equal(l.learning.ending,undefined);assert.equal(A.pianoSignature(l),e.grade);
 }
});

test('all 572 published 23.5.36 musical payloads, grades, IDs and catalog order survive teaching edits',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id),raw=JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.contentKind,old.kind);assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}
});

test('two full instruction reviews are guarded, archive prior explanations and are idempotent',()=>{
 const lessons=originals.slice(0,2).map(o=>copy(o.lesson));assert.equal(P.reviewQuarterPulseAndRests(lessons,adapter),2);
 for(const o of originals.slice(0,2)){const l=lessons.find(l=>l.id===o.lesson.id),r=l.learning.contentReview;assert.equal(r.id,'quarter-pulse-and-internal-rests-v1');assert.equal(r.sourceFingerprint,o.instructionFingerprint);assert.equal(r.previousAssessmentFingerprint,o.assessmentFingerprint);assert.deepEqual(r.previousInstruction,{description:o.lesson.description,guide:o.lesson.guide,learning:o.lesson.learning});}
 assert.equal(P.reviewQuarterPulseAndRests(lessons,adapter),0);
});

test('scoped rest correction preserves the earlier review and limits its statement to this lesson',()=>{
 const o=originals[2],l=copy(o.lesson);assert.equal(P.reviewQuarterPulseAndRests([l],adapter),1);assert.deepEqual(l.learning.contentReview,o.lesson.learning.contentReview);assert.equal(l.learning.endingScopeReview.id,'internal-rest-scope-v1');assert.deepEqual(l.learning.endingScopeReview.previousInstruction,{description:o.lesson.description,guide:o.lesson.guide,learning:o.lesson.learning});assert.equal(A.pianoSignature(l),o.assessmentFingerprint);
 assert.match(l.learning.selfCheck.join(' '),/Конечная тишина в этом уроке не измеряется/);assert.match(l.learning.selfCheck.join(' '),/Полная доля тишины после последней ноты/);assert.doesNotMatch(l.learning.selfCheck.join(' '),/detail-p-rhythm-final-rest-01/);assert.equal(l.learning.nextLessonId,'detail-p-rhythm-final-rest-01');assert.equal(P.reviewQuarterPulseAndRests([l],adapter),0);
});

test('personal instructions, timing, finger edits, scope reviews and classification are never overwritten',()=>{
 for(const o of originals)for(const change of [l=>l.title+=' моё',l=>l.description='Мой разбор',l=>l.guide.motion='Моё движение',l=>l.learning.selfCheck=['Мои условия'],l=>l.learning.requires=['private'],l=>l.learning.practiceSteps=['Мой разбор'],l=>l.learning.repeatSilenceCue='private',l=>l.learning.endingScopeReview={id:'personal'},l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=4,l=>l.exam=true,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'personal'}]){const l=copy(o.lesson);change(l);const before=copy(l);assert.equal(P.reviewQuarterPulseAndRests([l],adapter),0,o.lesson.id);assert.deepEqual(l,before);}
});

test('route prepares quarter pulse and familiar fingers without a duration or silence dependency cycle',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,ids=route.map(l=>l.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.nextLessonId,e.next);assert.ok(e.requires.every(id=>ids.indexOf(id)>=0&&ids.indexOf(id)<ids.indexOf(e.id)));assert.ok(ids.indexOf(e.next)>ids.indexOf(e.id));}
 const pulse=app.lessons.find(l=>l.id==='course04-01');assert.equal(pulse.learning.stage,'p2');assert.ok(!pulse.learning.requires.includes('course04-02'));
 for(const e of cases.slice(0,2)){const l=app.lessons.find(l=>l.id===e.id);assert.equal(l.learning.coverageDomain,'rhythm');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.ok(l.learning.sourceEvidenceIds.includes('omt-simple-counting-2026-11-05'));assert.ok(l.learning.practiceSteps.some(s=>/на следующий день/.test(s)));}
});

test('actual assessor rejects an attack on and, shortened rests and a held repeat',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id),options={steps:stepsFor(e),bpm:e.bpm,targetBpm:e.bpm,profile:l.learning.articulation},events=eventsFor(e);assert.equal(A.assessPiano({...options,events}).clean,true);
  for(const index of e.rests){const early=events.map(ev=>ev.step>=index?{...ev,at:ev.at-60000/e.bpm}:ev);assert.equal(A.assessPiano({...options,events:early}).clean,false);}
  const held=events.filter(ev=>!(ev.step===0&&ev.type==='off')&&!(ev.step===1&&ev.type==='on'));assert.equal(A.assessPiano({...options,events:held}).clean,false);
 }
 const pulse=cases[0],events=[...eventsFor(pulse),{type:'on',midi:60,at:1500,source:'midi'},{type:'off',midi:60,at:1700,source:'midi'}].sort((a,b)=>a.at-b.at);assert.equal(A.assessPiano({steps:stepsFor(pulse),bpm:60,targetBpm:60,events}).clean,false);
});

test('real MIDI app ends these lessons on final release while a separate lesson retains its terminal-rest contract',()=>{
 for(const e of cases){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===e.id);a.setTestLesson(l);a.state.attemptMode='challenge';const events=eventsFor(e);
  for(const[i,ev]of events.entries()){clock.now=ev.at;if(i===events.length-1)assert.equal(a.state.completed,false);if(ev.type==='on')a.handleNoteOn(ev.midi,'midi');else a.handleNoteOff(ev.midi);}
  assert.equal(a.state.completed,true);assert.equal(a.state.passed,true);assert.ok(Math.abs(clock.now-(1000+(e.starts.at(-1)+1)*60000/e.bpm-15))<.01);a.resetLessonState();
 }
 const terminal=app.lessons.find(l=>l.id==='detail-p-rhythm-final-rest-01');assert.deepEqual(copy(terminal.learning.ending),{version:1,endBeat:4});
});

test('presenter distinguishes ordinary repeats, pauses and their absence in every memory view',()=>{
 const a=loadApp();a.state.learningMaterialMode='expanded';
 for(const e of cases){const l=a.lessons.find(l=>l.id===e.id);a.state.lesson=l;a.state.stepIndex=1;a.state.attemptMode='practice';const cue=a.currentNoteHtml();assert.match(cue,e.rests.length?/Повтор после тишины/:/Повтор звука/);if(!e.rests.length)assert.doesNotMatch(cue,/Повтор после тишины/);
  if(!e.scopeOnly){const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.ok(l.learning.requires.every(id=>html.includes(id)));assert.match(html,/Gotham, Hamm, Shaffer/);}
  for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/Повтор|тишины|C4|1 доля/);}a.state.learningMaterialMode='expanded';
 }
});

test('catalog and progress transfer retains private edits, scope history and unchanged grade keys',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const[i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Мой счёт '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);assert.equal(JSON.stringify(a.state.learningProgress),raw);
 for(const e of cases){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Мой счёт '+e.id);assert.equal(A.pianoSignature(l),e.grade);}
 assert.ok(a.lessons.find(l=>l.id==='detail-p-rhythm-03').learning.endingScopeReview.previousInstruction);
});

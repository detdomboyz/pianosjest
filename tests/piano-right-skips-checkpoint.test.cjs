'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js'),Coverage=require('../tools/piano-skill-coverage.cjs'),{loadApp}=require('./helpers/load-app.cjs');
const originals=require('./fixtures/piano-right-skips-checkpoint-v1.json'),published=require('./fixtures/piano-before-right-skips-checkpoint-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[
 {id:'course02-07',notes:[60,62,64,60,64,67,67,64,60],digits:[1,2,3,1,3,5,5,3,1],starts:[0,1,2,4,5,6,8,9,10],rests:[3,6],bpm:62,grade:'f9908024',requires:['course02-06','course02-05','detail-p-right-upper-position-01'],next:'course02-08',repeat:6},
 {id:'course02-08',notes:[60,62,64,65,67,65,64,62,60,60,64,67,64,60,65,67,65,67],digits:[1,2,3,4,5,4,3,2,1,1,3,5,3,1,4,5,4,5],starts:[0,1,2,3,4,5,6,7,8,10,11,12,13,14,16,17,18,19],rests:[9,14],bpm:66,grade:'db25a49e',requires:['course02-07','course02-06','course02-05','detail-p-right-upper-position-01'],next:'detail-p-dyads-01',repeat:9}
];
const stepsFor=e=>e.notes.map((m,i)=>({midis:[m],startBeat:e.starts[i],durationBeats:1}));
const eventsFor=e=>e.notes.flatMap((m,i)=>[{type:'on',midi:m,at:1000+e.starts[i]*60000/e.bpm,source:'midi',step:i},{type:'off',midi:m,at:1000+(e.starts[i]+1)*60000/e.bpm-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('right-hand step comparison and checkpoint retain independent notes, fingering, quarter rests and old assessment versions',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),e.digits);
  assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand==='right'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),e.starts.map((_,i)=>e.rests.includes(i)?1:0));
  assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.practiceBpm,e.bpm);assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),e.grade);
 }
 assert.equal(cases[0].starts.at(-1)+1,11);assert.equal(cases[1].starts.at(-1)+1,20);assert.equal(cases[1].notes.at(-1),67);
});

test('all 572 published 23.5.35 musical payloads, versions and personal ordering survive instruction-only corrections',()=>{
 assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id),raw=JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old),old.id);assert.equal(l.contentKind,old.kind);assert.equal(l.themeId,old.themeId);assert.equal(l.order,old.order);
 }
});

test('right skips review archives the exact prior instruction and applies only once',()=>{
 const lessons=originals.map(o=>copy(o.lesson));assert.equal(P.reviewRightSkipsAndCheckpoint(lessons,adapter),2);
 for(const o of originals){const l=lessons.find(l=>l.id===o.lesson.id),r=l.learning.contentReview;
  assert.equal(r.id,'right-skips-and-checkpoint-v1');assert.equal(r.sourceFingerprint,o.instructionFingerprint);assert.equal(r.previousAssessmentFingerprint,o.assessmentFingerprint);
  assert.deepEqual(r.previousInstruction,{description:o.lesson.description,guide:o.lesson.guide,learning:o.lesson.learning});assert.equal(A.pianoSignature(l),o.assessmentFingerprint);
 }
 assert.equal(P.reviewRightSkipsAndCheckpoint(lessons,adapter),0);
});

test('personal text, instructions, fingers, timing, goal role, exam choice and piece classification remain protected',()=>{
 for(const o of originals)for(const change of [l=>l.title+=' моё',l=>l.description='Мой разбор',l=>l.guide.motion='Моё движение',l=>l.learning.practiceSteps=['Мой шаг'],l=>l.learning.requires=['private'],l=>l.learning.goalCounting='personal',l=>l.learning.repeatSilenceCue='private',l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=5,l=>l.exam=!l.exam,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'personal'}]){
  const l=copy(o.lesson);change(l);const before=copy(l);assert.equal(P.reviewRightSkipsAndCheckpoint([l],adapter),0,o.lesson.id);assert.deepEqual(l,before);
 }
});

test('route prepares the right-hand parts before the checkpoint and counts it separately from new goals',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,ids=route.map(l=>l.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.after,e.requires[0]);assert.equal(l.learning.nextLessonId,e.next);
  assert.deepEqual(copy(route.find(x=>x.id===e.id).preparation),e.requires);assert.ok(e.requires.every(id=>ids.indexOf(id)>=0&&ids.indexOf(id)<ids.indexOf(e.id)));assert.ok(ids.indexOf(e.next)>ids.indexOf(e.id));assert.ok(!e.requires.some(id=>id.startsWith('detail-p-position-skips')));
  assert.equal(l.learning.provenance.type,'project-technical-drill');assert.ok(l.learning.sourceEvidenceIds.includes('ou-triads-2026-11-05'));
 }
 const control=app.lessons.find(l=>l.id==='course02-08'),counts=Coverage.build(),expected=require('./fixtures/piano-curriculum-counts.json');assert.equal(control.learning.goalCounting,'checkpoint-only');assert.equal(control.learning.sameGoalAs,undefined);assert.ok(counts.checkpointLessonIds.includes(control.id));assert.equal(counts.counts.explicitCheckpoints,expected.explicitCheckpoints);assert.equal(counts.counts.implementedLearningLessons,require('./fixtures/piano-curriculum-counts.json').implementedLearningLessons);assert.equal(counts.counts.goalGroupUpperBound,expected.goalGroupUpperBound);assert.equal(counts.counts.verifiedDistinctGoalCount,null);
});

test('actual assessor rejects either shortened rest, a held repeated G4 or C4, and an incorrect octave',()=>{
 for(const e of cases){const options={steps:stepsFor(e),bpm:e.bpm,targetBpm:e.bpm},events=eventsFor(e);assert.equal(A.assessPiano({...options,events}).clean,true);
  for(const index of e.rests){const early=events.map(ev=>ev.step>=index?{...ev,at:ev.at-60000/e.bpm}:ev);assert.equal(A.assessPiano({...options,events:early}).clean,false);}
  const held=events.filter(ev=>!(ev.step===e.repeat-1&&ev.type==='off')&&!(ev.step===e.repeat&&ev.type==='on'));assert.equal(A.assessPiano({...options,events:held}).clean,false);
  assert.equal(A.assessPiano({...options,events:events.map(ev=>({...ev,midi:ev.midi+12}))}).clean,false);
 }
});

test('actual presenter exposes the useful pause cue and checkpoint role but removes all hints in memory',()=>{
 const a=loadApp();a.state.learningMaterialMode='expanded';
 for(const e of cases){const l=a.lessons.find(l=>l.id===e.id);a.state.lesson=l;a.state.stepIndex=e.repeat;a.state.attemptMode='practice';
  assert.match(a.currentNoteHtml(),/Повтор после тишины/);assert.match(a.currentNoteHtml(),/1 доля/);
  const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.match(html,/на следующий день/);assert.ok(l.learning.requires.every(id=>html.includes(id)));assert.match(html,/Open University/);
  if(e.id==='course02-08')assert.match(html,/Контроль знакомых навыков/);
  for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/Повтор|тишины|G4|C4|1 доля/);}
  a.state.learningMaterialMode='expanded';
 }
});

test('catalog roundtrip retains private text, classification, relative order and old progress keys',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[];
 const a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const[i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Мой разбор '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);
 for(const[i,e]of cases.entries()){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Мой разбор '+e.id);assert.equal(A.pianoSignature(l),e.grade);if(i===1)assert.equal(l.contentKind,'piece');}
 assert.deepEqual(copy(a.lessons.filter(l=>l.themeId===originals[0].lesson.themeId).slice(-2).map(l=>l.id)),['course02-08','course02-07']);assert.equal(JSON.stringify(a.state.learningProgress),raw);
});

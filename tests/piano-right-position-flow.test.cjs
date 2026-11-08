'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js'),{loadApp}=require('./helpers/load-app.cjs');
const originals=require('./fixtures/piano-right-position-flow-v1.json'),published=require('./fixtures/piano-before-right-position-flow-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const specs=[
 {id:'course02-05',notes:[60,62,64,65,67,65,64,62,60,60,62,64,65,67,65,64,62,60],digits:[1,2,3,4,5,4,3,2,1,1,2,3,4,5,4,3,2,1],starts:Array.from({length:18},(_,i)=>i),bpm:64,grade:'fb8ee7e3',requires:['course02-04','course02-03','detail-p-right-upper-position-01'],next:'course02-06'},
 {id:'course02-06',notes:[60,62,62,64,64,65,65,67,67,65,65,64,64,62,62,60],digits:[1,2,2,3,3,4,4,5,5,4,4,3,3,2,2,1],starts:[0,1,2,3,4,5,6,7,9,10,11,12,13,14,15,16],bpm:62,grade:'28c4e84b',requires:['course02-05','detail-p-right-upper-position-01','detail-p-release-01'],next:'course02-07'}
];
const eventsFor=spec=>spec.notes.flatMap((m,i)=>[{type:'on',midi:m,at:1000+spec.starts[i]*60000/spec.bpm,source:'midi',step:i},{type:'off',midi:m,at:1000+(spec.starts[i]+1)*60000/spec.bpm-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);
const planFor=spec=>spec.notes.map((m,i)=>({midis:[m],startBeat:spec.starts[i],durationBeats:1}));

test('right flow and paired attacks retain independently specified fingers, timing, articulation and old assessment versions',()=>{
 for(const e of specs){const l=app.lessons.find(l=>l.id===e.id);
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),e.digits);
  assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand==='right'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),e.starts.map((_,i)=>e.id==='course02-06'&&i===8?1:0));
  assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.practiceBpm,e.bpm);
  assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),e.grade);assert.equal(l.learning.ending,undefined);
 }
});

test('all 572 previously published musical payloads, grades, classification and source order survive teaching-only edits',()=>{
 assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id),payload=JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old));
  assert.equal(crypto.createHash('sha256').update(payload).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old),old.id);
  assert.equal(l.contentKind,old.kind);assert.equal(l.themeId,old.themeId);assert.equal(l.order,old.order);
 }
});

test('right flow correction is exact, archives the prior instruction and is idempotent',()=>{
 const lessons=originals.map(o=>copy(o.lesson));assert.equal(P.reviewRightPositionFlow(lessons,adapter),2);
 for(const o of originals){const l=lessons.find(l=>l.id===o.id),review=l.learning.contentReview;
  assert.equal(review.id,'right-position-flow-and-repeats-v1');assert.equal(review.sourceFingerprint,o.instructionFingerprint);
  assert.equal(review.previousAssessmentFingerprint,o.assessmentFingerprint);assert.equal(A.pianoSignature(l),o.assessmentFingerprint);
  assert.deepEqual(review.previousInstruction,{description:o.lesson.description,guide:o.lesson.guide,learning:o.lesson.learning});
 }
 assert.equal(P.reviewRightPositionFlow(lessons,adapter),0);
});

test('private teaching, notes, fingers, timing, own review and piece classification remain protected',()=>{
 for(const o of originals)for(const change of [l=>l.title+=' мой',l=>l.description='Мой разбор',l=>l.guide.motion='Моё движение',l=>l.learning.practiceSteps=['Мой шаг'],l=>l.learning.requires=['private'],l=>l.learning.repeatSilenceCue='private',l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=5,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'personal'}]){
  const l=copy(o.lesson);change(l);const before=copy(l);assert.equal(P.reviewRightPositionFlow([l],adapter),0,o.id);assert.deepEqual(l,before);
 }
 const personalOrder=copy(originals[0].lesson);personalOrder.order=999;assert.equal(P.reviewRightPositionFlow([personalOrder],adapter),1);assert.equal(personalOrder.order,999);
});

test('route requires prepared right-hand directions and release before pairs, without a later legato cycle',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,index=id=>route.findIndex(l=>l.id===id);
 for(const e of specs){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.nextLessonId,e.next);
  for(const id of e.requires)assert.ok(index(id)>=0&&index(id)<index(e.id),id+' before '+e.id);
  assert.ok(index(e.next)>index(e.id));assert.ok(!e.requires.some(id=>id.startsWith('detail-p-legato')));
 }
});

test('actual assessor requires the repeated C4 attack and full silent beat before the descending G4',()=>{
 for(const spec of specs){const options={steps:planFor(spec),bpm:spec.bpm,targetBpm:spec.bpm};assert.equal(A.assessPiano({...options,events:eventsFor(spec)}).clean,true);
  const wrong=eventsFor(spec).map(e=>({...e,midi:e.midi+12}));assert.equal(A.assessPiano({...options,events:wrong}).clean,false);
 }
 const flow=specs[0],held=eventsFor(flow).filter(e=>!(e.step===8&&e.type==='off')&&!(e.step===9&&e.type==='on'));
 assert.equal(A.assessPiano({steps:planFor(flow),bpm:flow.bpm,targetBpm:flow.bpm,events:held}).clean,false);
 const pairs=specs[1],early=eventsFor(pairs).map(e=>e.step>=8?{...e,at:e.at-60000/pairs.bpm}:e);
 assert.equal(A.assessPiano({steps:planFor(pairs),bpm:pairs.bpm,targetBpm:pairs.bpm,events:early}).clean,false);
});

test('actual presenter distinguishes ordinary repeated attacks from G4 after silence and removes hints in all memory views',()=>{
 const a=loadApp(),flow=a.lessons.find(l=>l.id==='course02-05'),pairs=a.lessons.find(l=>l.id==='course02-06');
 a.state.lesson=flow;a.state.stepIndex=9;assert.match(a.currentNoteHtml(),/Повтор звука/);assert.doesNotMatch(a.currentNoteHtml(),/Повтор после тишины/);
 a.state.lesson=pairs;a.state.stepIndex=2;assert.match(a.currentNoteHtml(),/Повтор звука/);a.state.stepIndex=8;assert.match(a.currentNoteHtml(),/Повтор после тишины/);assert.match(a.currentNoteHtml(),/1 доля/);
 for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/Повтор|тишины|G4|1 доля/);}
 a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';
 for(const l of [flow,pairs]){a.state.lesson=l;const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.match(html,/на следующий день/);assert.ok(l.learning.requires.every(id=>html.includes(id)));assert.ok(l.learning.references.some(s=>s.includes('brief-03')));}
});

test('catalog import preserves personal flow instructions, order, piece classification and old progress keys',()=>{
 const progress=Object.fromEntries(specs.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[];
 const a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const [i,e] of specs.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Мой разбор '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);
 for(const [i,e] of specs.entries()){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Мой разбор '+e.id);assert.equal(A.pianoSignature(l),e.grade);if(i===1)assert.equal(l.contentKind,'piece');}
 assert.deepEqual(copy(a.lessons.filter(l=>l.themeId===originals[0].lesson.themeId).slice(-2).map(l=>l.id)),['course02-06','course02-05']);
 assert.equal(JSON.stringify(a.state.learningProgress),raw);
});

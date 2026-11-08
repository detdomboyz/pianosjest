'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js'),UI=require('../piano-learning-ui.js'),originals=require('./fixtures/piano-left-position-flow-v1.json'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[
 {id:'course03-05',notes:[48,50,52,53,55,53,52,50,48,48,50,52,53,55,53,52,50,48],digits:[5,4,3,2,1,2,3,4,5,5,4,3,2,1,2,3,4,5],starts:Array.from({length:18},(_,i)=>i),bpm:62,grade:'5247cbfa',requires:['course03-04','course03-03','detail-p-left-upper-position-01']},
 {id:'course03-06',notes:[48,50,50,52,52,53,53,55,55,53,53,52,52,50,50,48],digits:[5,4,4,3,3,2,2,1,1,2,2,3,3,4,4,5],starts:[0,1,2,3,4,5,6,7,9,10,11,12,13,14,15,16],bpm:60,grade:'ff3e5665',requires:['course03-05','detail-p-left-upper-position-01','detail-p-release-02']}
];
const eventsFor=(spec,transpose=0)=>spec.notes.flatMap((m,i)=>[{type:'on',midi:m+transpose,at:1000+spec.starts[i]*60000/spec.bpm,source:'midi',step:i},{type:'off',midi:m+transpose,at:1000+(spec.starts[i]+1)*60000/spec.bpm-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);
const planFor=(spec,transpose=0)=>spec.notes.map((m,i)=>({midis:[m+transpose],startBeat:spec.starts[i],durationBeats:1}));

test('flow and paired repeats retain exact independent pitches, fingers, timing and old grading versions',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),e.digits);assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand==='left'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),e.starts.map((_,i)=>e.id==='course03-06'&&i===8?1:0));assert.equal(l.rhythm.practiceBpm,e.bpm);assert.equal(A.pianoSignature(l),e.grade);
 }
});

test('both flow lessons follow their hand-specific preparations in the generated route',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,ids=route.map(e=>e.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.after,e.requires[0]);assert.deepEqual(copy(route.find(r=>r.id===e.id).preparation),e.requires);assert.ok(e.requires.every(id=>ids.indexOf(id)>=0&&ids.indexOf(id)<ids.indexOf(e.id)));}
});

test('exact flow instruction migration archives its source once and retains every musical field',()=>{
 for(const old of originals){const l=copy(old);assert.equal(P.reviewLeftPositionFlow([l],adapter),1);assert.deepEqual(copy(l),copy(app.lessons.find(x=>x.id===l.id)));assert.equal(P.reviewLeftPositionFlow([l],adapter),0);
  for(const key of ['id','title','pattern','steps','rhythm','fingeringSpec','handMode','contentKind','bpm','themeId','order'])assert.deepEqual(copy(l[key]??null),copy(old[key]??null));
  assert.equal(A.pianoSignature(l),A.pianoSignature(old));assert.deepEqual(l.learning.contentReview.previousInstruction,{description:old.description,guide:old.guide,learning:old.learning});
 }
});

test('private instructions, classifications and performance data cannot be rewritten by the built-in review',()=>{
 for(const old of originals)for(const change of [l=>l.description='Мой текст',l=>l.title='Мой урок',l=>l.guide.motion='Моё движение',l=>l.learning.practiceSteps=['Мой шаг'],l=>l.learning.requires=['mine'],l=>l.learning.repeatSilenceCue='personal',l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=1,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'personal'}]){const l=copy(old);change(l);const before=copy(l);assert.equal(P.reviewLeftPositionFlow([l],adapter),0);assert.deepEqual(l,before);}
});

test('the real assessor requires new attacks on repeated C in either register and rejects a shortened G silence',()=>{
 const flow=cases[0];for(const transpose of [0,12]){const options={steps:planFor(flow,transpose),bpm:flow.bpm,targetBpm:flow.bpm};const clean=eventsFor(flow,transpose);assert.equal(A.assessPiano({...options,events:clean}).clean,true);
  const held=clean.filter(e=>!(e.step===8&&e.type==='off')&&!(e.step===9&&e.type==='on'));assert.equal(A.assessPiano({...options,events:held}).clean,false);
  const withoutRelease=clean.filter(e=>!(e.step===8&&e.type==='off'));const result=A.assessPiano({...options,events:withoutRelease});assert.equal(result.clean,false);assert.ok(result.reasons.some(r=>/без отпускания/.test(r)));
 }
 const pairs=cases[1],options={steps:planFor(pairs),bpm:pairs.bpm,targetBpm:pairs.bpm},clean=eventsFor(pairs);assert.equal(A.assessPiano({...options,events:clean}).clean,true);
 const early=clean.map(e=>e.step>=8?{...e,at:e.at-60000/pairs.bpm}:e);assert.equal(A.assessPiano({...options,events:early}).clean,false);
});

test('the optional repeat silence view accepts finite positive beats only and keeps older two-argument behavior',()=>{
 const original=UI.repeatedNoteHtml([55],[55]);assert.match(original,/Повтор звука/);assert.doesNotMatch(original,/после тишины/);
 for(const bad of [undefined,0,-1,NaN,Infinity,'1','<script>'])assert.equal(UI.repeatedNoteHtml([55],[55],bad),original);
 assert.match(UI.repeatedNoteHtml([55],[55],1),/Повтор после тишины/);assert.match(UI.repeatedNoteHtml([55],[55],1),/1 доля/);
 assert.equal(UI.repeatedNoteHtml([53],[55],1),'');assert.equal(UI.repeatedNoteHtml([55,60],[55,60],1),'');
});

test('the actual practice presenter distinguishes repeated attacks from an opted-in rest and hides them in memory',()=>{
 const a=loadApp({events:true}),flow=a.lessons.find(l=>l.id==='course03-05'),pairs=a.lessons.find(l=>l.id==='course03-06');
 a.setTestLesson(flow);a.state.stepIndex=9;assert.match(a.currentNoteHtml(),/Повтор звука/);assert.doesNotMatch(a.currentNoteHtml(),/Повтор после тишины/);
 a.setTestLesson(pairs);a.state.stepIndex=2;assert.match(a.currentNoteHtml(),/Повтор звука/);a.state.stepIndex=8;assert.match(a.currentNoteHtml(),/Повтор после тишины/);assert.match(a.currentNoteHtml(),/1 доля/);
 delete pairs.learning.repeatSilenceCue;assert.doesNotMatch(a.currentNoteHtml(),/Повтор после тишины/);pairs.learning.repeatSilenceCue='beat-gap-v1';
 for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/Повтор|тишины|G3|1 доля/);}
 a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';for(const l of [flow,pairs]){a.setTestLesson(l);const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.match(html,/на следующий день/);assert.ok(l.learning.requires.every(id=>html.includes(id)));}
});

test('catalog import keeps private flow instructions, reversed order, piece classification and old progress',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const [i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Мой разбор '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);
 for(const[i,e]of cases.entries()){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Мой разбор '+e.id);assert.equal(l.contentKind,i===1?'piece':'exercise');assert.equal(A.pianoSignature(l),e.grade);}
 assert.deepEqual(copy(a.lessons.filter(l=>l.themeId===originals[0].themeId).slice(-2).map(l=>l.id)),['course03-06','course03-05']);
});

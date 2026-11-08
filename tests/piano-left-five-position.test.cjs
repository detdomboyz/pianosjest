'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const originals=require('./fixtures/piano-left-five-position-v1.json'),{loadApp}=require('./helpers/load-app.cjs');
const copy=value=>JSON.parse(JSON.stringify(value)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const bridge='detail-p-left-upper-position-01';
const expected=[
 {id:bridge,notes:[52,53,55,53,52],digits:[3,2,1,2,3],bpm:52,grade:'2479d89d',requires:['course03-02','detail-p-release-02']},
 {id:'course03-03',notes:[48,50,52,53,55],digits:[5,4,3,2,1],bpm:58,grade:'680feb02',requires:[bridge,'course03-02']},
 {id:'course03-04',notes:[55,53,52,50,48],digits:[1,2,3,4,5],bpm:58,grade:'1273c0c2',requires:['course03-03',bridge]}
];

test('upper-position preparation and both directions use independent expected pitches, fingers, quarter values and phrase rest',()=>{
 for(const e of expected){
  const l=app.lessons.find(l=>l.id===e.id);
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),[...e.notes,...e.notes].map(m=>[m]));
  assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),[...e.digits,...e.digits]);
  assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand==='left'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),[0,1,2,3,4,6,7,8,9,10]);
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,0,0,0,1,0,0,0,0]);
  assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));
  assert.equal(l.rhythm.practiceBpm,e.bpm);assert.equal(A.pianoSignature(l),e.grade);
  if(e.id===bridge)assert.equal(l.handMode,'left');
  assert.equal(l.learning.kind,'exercise');
  if(e.id===bridge)assert.equal(l.contentKind,'exercise');
 }
});

test('route prepares index and thumb before five-finger ascent and descent without a legato dependency cycle',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,order=route.map(l=>l.id);
 for(const e of expected){
  const entry=route.find(l=>l.id===e.id),lesson=app.lessons.find(l=>l.id===e.id);
  assert.deepEqual(copy(entry.preparation),e.requires);assert.equal(lesson.learning.after,e.requires[0]);
  assert.ok(e.requires.every(id=>order.indexOf(id)>=0&&order.indexOf(id)<order.indexOf(e.id)));
 }
 for(const id of ['detail-p-legato-pairs-03','detail-p-legato-pairs-04'])assert.ok(order.indexOf(bridge)<order.indexOf(id));
});

test('only exact original explanations migrate once, retaining music, grading version and the historical instruction',()=>{
 for(const source of originals){
  const l=copy(source),expectedLesson=app.lessons.find(x=>x.id===l.id),grade=A.pianoSignature(source);
  assert.equal(P.reviewLeftFiveFingerPreparation([l],adapter),1);
  assert.deepEqual(copy(l),copy(expectedLesson));assert.equal(P.reviewLeftFiveFingerPreparation([l],adapter),0);
  for(const key of ['id','title','pattern','steps','rhythm','fingeringSpec','handMode','bpm','contentKind'])assert.deepEqual(l[key]??null,source[key]??null);
  assert.equal(A.pianoSignature(l),grade);
  assert.deepEqual(l.learning.contentReview.previousInstruction,{description:source.description,guide:source.guide,learning:source.learning});
  assert.equal(l.learning.contentReview.previousAssessmentFingerprint,grade);
 }
});

test('personal instruction, notes, timing, fingers, prerequisites and piece classification prevent automatic rewriting',()=>{
 const changes=[l=>l.description='Мои заметки',l=>l.guide.motion='Моё движение',l=>l.title='Мой вариант',l=>l.learning.requires=['mine'],l=>l.learning.after='mine',l=>l.learning.practiceSteps=['Мой разбор'],l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.pattern='t y u',l=>l.contentKind='piece',l=>l.learning.contentReview={id:'personal'}];
 for(const source of originals)for(const edit of changes){const l=copy(source);edit(l);const before=copy(l);assert.equal(P.reviewLeftFiveFingerPreparation([l],adapter),0);assert.deepEqual(l,before);}
});

test('catalogue import keeps personal guidance, ordering and classification while preserving earlier music progress',()=>{
 const progress=Object.fromEntries(expected.slice(1).map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})]));
 const raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:key=>key==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});
 a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const [i,e] of expected.slice(1).entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Личный текст '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);
 for(const [i,e] of expected.slice(1).entries()){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Личный текст '+e.id);assert.equal(l.contentKind,i===1?'piece':'exercise');assert.equal(A.pianoSignature(l),e.grade);}
 const theme=app.lessons.find(l=>l.id==='course03-03').themeId;
 assert.deepEqual(copy(a.lessons.filter(l=>l.themeId===theme).slice(-2).map(l=>l.id)),['course03-04','course03-03']);
});

test('reviewed material names preparation and transfer while every presentation mode removes memory hints',()=>{
 const a=loadApp({events:true});
 for(const e of expected){a.setTestLesson(a.lessons.find(l=>l.id===e.id));a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();
  for(const text of [/Техническое упражнение проекта/,/одна доля тишины/,/4\/4/,/3–5 минут/,/на следующий день/,/MIDI/,/проект/])assert.match(html,text);
  assert.ok(e.requires.every(id=>html.includes(id)));assert.match(html,/перенос/i);
  for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');}
 }
});

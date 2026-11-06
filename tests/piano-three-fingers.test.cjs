'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const expected=[{id:'course02-02',hand:'right',midis:[60,62,64,62,60],fingers:[1,2,3,2,1],bpm:60,grade:'b623c94b',requires:['course02-01','detail-p-release-01']},{id:'course03-02',hand:'left',midis:[48,50,52,50,48],fingers:[5,4,3,4,5],bpm:58,grade:'70befb4e',requires:['course03-01','detail-p-release-02']}];
function original(l){const old=copy(l);Object.assign(old,copy(l.learning.contentReview.previousInstruction));return old;}
test('compiled route exposes both hand-specific preparations before each three-finger lesson without changing catalogue order',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,order=route.map(l=>l.id);for(const e of expected){const entry=route.find(l=>l.id===e.id);assert.deepEqual(copy(entry.preparation),e.requires);assert.ok(e.requires.every(id=>order.indexOf(id)>=0&&order.indexOf(id)<order.indexOf(e.id)));assert.equal(app.lessons.find(l=>l.id===e.id).learning.after,e.requires[0]);}
});
test('three-finger explanations preserve both independent hand sequences, the inter-phrase rest and grading edition',()=>{
 for(const e of expected){const l=app.lessons.find(l=>l.id===e.id),old=original(l);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),[...e.midis,...e.midis].map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),[...e.fingers,...e.fingers]);assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand===e.hand));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),[0,1,2,3,4,6,7,8,9,10]);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,0,0,0,1,0,0,0,0]);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.rhythm.practiceBpm,e.bpm);assert.equal(A.pianoSignature(l),e.grade);assert.equal(A.pianoSignature(old),e.grade);assert.deepEqual(copy(l.learning.requires),e.requires);
  for(const key of ['pattern','rhythm','fingeringSpec','bpm','title','handMode','contentKind'])assert.deepEqual(copy(l[key]??null),copy(old[key]??null));
 }
});
test('exact-source explanation migration is idempotent, archives the source and protects personal editions',()=>{
 for(const e of expected){const reviewed=app.lessons.find(l=>l.id===e.id),old=original(reviewed),l=copy(old);assert.equal(P.reviewThreeFingerPreparation([l],adapter),1);assert.deepEqual(copy(l),copy(reviewed));assert.equal(P.reviewThreeFingerPreparation([l],adapter),0);assert.deepEqual(l.learning.contentReview.previousInstruction,{description:old.description,guide:old.guide,learning:old.learning});assert.equal(l.learning.contentReview.previousAssessmentFingerprint,e.grade);
  for(const edit of [x=>x.description='Мой разбор',x=>x.title='Мой вариант',x=>x.guide.motion='Моё движение',x=>x.learning.practiceSteps=['Мой шаг'],x=>x.learning.requires=['mine'],x=>x.learning.after='mine',x=>x.rhythm.steps[0].durationBeats=.5,x=>x.fingeringSpec.steps[0][0].num=2,x=>x.contentKind='piece',x=>x.learning.contentReview={id:'mine'}]){const mine=copy(old);edit(mine);const before=copy(mine);assert.equal(P.reviewThreeFingerPreparation([mine],adapter),0);assert.deepEqual(mine,before);}
 }
});
test('three-finger catalogue transfer preserves private guidance, order, classification and old progress',()=>{
 const progress=Object.fromEntries(expected.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const[i,e]of expected.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Личная заметка '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);
 for(const[i,e]of expected.entries()){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Личная заметка '+e.id);assert.equal(l.contentKind,i===1?'piece':'exercise');assert.equal(A.pianoSignature(l),e.grade);assert.equal(a.lessons.filter(x=>x.themeId===l.themeId).at(-1).id,e.id);}
});
test('three-finger materials describe audible rest and separate known practice from independent reading and memory',()=>{
 const a=loadApp({events:true});for(const e of expected){a.setTestLesson(a.lessons.find(l=>l.id===e.id));a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();for(const pattern of [/Техническое упражнение проекта/,/одна доля тишины/,/0, 1, 2, 3, 4/,/6, 7, 8, 9, 10/,/4\/4/,/3–5 минут/,/на следующий день/,/не неизвестный слуховой/,/MIDI не распознаёт/])assert.match(html,pattern);for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');}}
});

'use strict';
const catalogCounts=require('./fixtures/piano-curriculum-counts.json');
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js'),Coverage=require('../tools/piano-skill-coverage.cjs'),originals=require('./fixtures/piano-left-skips-checkpoint-v1.json'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[
 {id:'course03-07',notes:[48,52,55,52,48,48,52,55,52,48],digits:[5,3,1,3,5,5,3,1,3,5],starts:[0,1,2,3,4,6,7,8,9,10],bpm:60,grade:'0e9ed8a3',rests:[5],requires:['course03-06','course03-05','detail-p-left-upper-position-01']},
 {id:'course03-08',notes:[48,50,52,53,55,53,52,50,48,48,52,55,52,48,53,55,53,55],digits:[5,4,3,2,1,2,3,4,5,5,3,1,3,5,2,1,2,1],starts:[0,1,2,3,4,5,6,7,8,10,11,12,13,14,16,17,18,19],bpm:64,grade:'23150801',rests:[9,14],requires:['course03-07','course03-06','course03-05','detail-p-left-upper-position-01']}
];
test('skips and checkpoint preserve independently specified notes, fingers, silence and old music versions',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),e.digits);assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand==='left'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),e.starts.map((_,i)=>e.rests.includes(i)?1:0));assert.equal(l.rhythm.practiceBpm,e.bpm);assert.equal(A.pianoSignature(l),e.grade);
 }
 const checkpoint=cases[1];assert.equal(checkpoint.starts.at(-1)+1,20);assert.equal(checkpoint.notes.at(-1),55);
});
test('generated route places all known preparations before standard skips without forcing a legato branch',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano,ids=route.map(e=>e.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.after,e.requires[0]);assert.deepEqual(copy(route.find(r=>r.id===e.id).preparation),e.requires);assert.ok(e.requires.every(id=>ids.indexOf(id)>=0&&ids.indexOf(id)<ids.indexOf(e.id)));assert.ok(!e.requires.some(id=>id.startsWith('detail-p-position-skips')));const nextId=e.id==='course03-07'?'course03-08':'detail-p-left-triple-pulse-01';assert.equal(l.learning.nextLessonId,nextId);assert.ok(ids.indexOf(nextId)>ids.indexOf(e.id));const next=app.lessons.find(l=>l.id===nextId);assert.ok(next.learning.requires.every(p=>ids.indexOf(p)<ids.indexOf(nextId)));}
});
test('guarded instruction review archives each old revision exactly once and leaves musical fields intact',()=>{
 for(const old of originals){const l=copy(old);assert.equal(P.reviewLeftSkipsAndCheckpoint([l],adapter),1);assert.deepEqual(copy(l),copy(app.lessons.find(x=>x.id===l.id)));assert.equal(P.reviewLeftSkipsAndCheckpoint([l],adapter),0);
  for(const key of ['id','title','pattern','steps','rhythm','fingeringSpec','handMode','contentKind','bpm','themeId','order'])assert.deepEqual(copy(l[key]??null),copy(old[key]??null));
  assert.equal(A.pianoSignature(l),A.pianoSignature(old));assert.deepEqual(l.learning.contentReview.previousInstruction,{description:old.description,guide:old.guide,learning:old.learning});
 }
});
test('personal instructions, goal roles, classification and musical edits are excluded from the built-in migration',()=>{
 for(const old of originals)for(const change of [l=>l.description='Мой разбор',l=>l.title='Моё название',l=>l.guide.motion='Моё движение',l=>l.learning.practiceSteps=['Моя подготовка'],l=>l.learning.goalCounting='personal',l=>l.learning.requires=['my-lesson'],l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'private'}]){const l=copy(old);change(l);const before=copy(l);assert.equal(P.reviewLeftSkipsAndCheckpoint([l],adapter),0);assert.deepEqual(l,before);}
});
test('checkpoint is counted separately from new goals and its prepared components remain separate lessons',()=>{
 const l=app.lessons.find(l=>l.id==='course03-08'),r=Coverage.build();assert.equal(l.learning.goalCounting,'checkpoint-only');assert.equal(l.learning.sameGoalAs,undefined);assert.ok(r.checkpointLessonIds.includes(l.id));assert.equal(r.counts.explicitCheckpoints,catalogCounts.explicitCheckpoints);assert.equal(r.counts.goalGroupUpperBound,catalogCounts.goalGroupUpperBound);assert.equal(r.counts.implementedLearningLessons,catalogCounts.implementedLearningLessons);assert.equal(r.counts.withStructuredProvenance,catalogCounts.withStructuredProvenance);assert.equal(r.counts.verifiedDistinctGoalCount,null);
 for(const e of cases){const lesson=app.lessons.find(l=>l.id===e.id);assert.equal(lesson.learning.provenance.type,'project-technical-drill');assert.ok(lesson.learning.sourceEvidenceIds.includes('ou-triads-2026-11-05'));assert.ok(lesson.learning.practiceSteps.some(s=>/3–5 минут/.test(s)));assert.ok(lesson.learning.practiceSteps.some(s=>/на следующий день/.test(s)));}
});
test('real assessor accepts exact phrases and rejects each shortened silence and held repeat',()=>{
 for(const e of cases){const beat=60000/e.bpm,steps=e.notes.map((m,i)=>({midis:[m],startBeat:e.starts[i],durationBeats:1}));const events=e.notes.flatMap((m,i)=>[{type:'on',midi:m,at:1000+e.starts[i]*beat,source:'midi',step:i},{type:'off',midi:m,at:1000+(e.starts[i]+1)*beat-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at),options={steps,bpm:e.bpm,targetBpm:e.bpm};assert.equal(A.assessPiano({...options,events}).clean,true);
  for(const index of e.rests){const early=events.map(ev=>ev.step>=index?{...ev,at:ev.at-beat}:ev);assert.equal(A.assessPiano({...options,events:early}).clean,false);}
  const index=e.rests[0],held=events.filter(ev=>!(ev.step===index-1&&ev.type==='off')&&!(ev.step===index&&ev.type==='on'));assert.equal(A.assessPiano({...options,events:held}).clean,false);
 }
});
test('actual target uses Russian rest plurals and decimal commas, retains timed fallback and hides every hint in memory',()=>{
 const a=loadApp(),l=copy(a.lessons.find(l=>l.id==='course03-07'));a.state.lesson=l;a.state.stepIndex=5;a.state.attemptMode='practice';
 for(const[beats,text,ms]of [[1,'1 доля',1000],[2,'2 доли',2000],[5,'5 долей',5000],[.5,'0,5 доли',500],[1.5,'1,5 доли',1500]]){l.rhythm.steps[5].restBeforeBeats=beats;assert.ok(a.currentNoteHtml().includes('перед нотой пауза: '+text+' / '+ms+' мс'));}
 l.rhythm.steps[5].restBeforeBeats='Infinity';const fallback=a.currentNoteHtml();assert.match(fallback,/перед нотой пауза: 1000 мс/);assert.doesNotMatch(fallback,/Infinity|NaN|пауза: .*дол/);
 l.rhythm.steps[5].restBeforeBeats=0;assert.doesNotMatch(a.currentNoteHtml(),/перед нотой пауза/);
 l.rhythm.steps[5].restBeforeBeats=1;for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/Ритм:|перед нотой|C3|1000 мс/);}
});
test('catalog roundtrip protects private text, reversed order, classification and existing versioned progress',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const[i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Мой текст '+e.id;l.order=990-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);for(const[i,e]of cases.entries()){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Мой текст '+e.id);assert.equal(l.contentKind,i===1?'piece':'exercise');assert.equal(A.pianoSignature(l),e.grade);}
 assert.deepEqual(copy(a.lessons.filter(l=>l.themeId===originals[0].themeId).slice(-2).map(l=>l.id)),['course03-08','course03-07']);
});

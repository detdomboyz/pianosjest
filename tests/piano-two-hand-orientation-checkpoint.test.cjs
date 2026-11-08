'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const fixture=require('./fixtures/piano-two-hand-orientation-checkpoint-v1.json'),original=fixture.lessons[0],published=require('./fixtures/piano-before-first-two-fingers-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide},lesson=()=>app.lessons.find(l=>l.id==='course01-08');
const starts=[0,1,2,3,4,5,7,8,9],notes=[[48],[60],[50],[62],[52],[64],[48],[60],[48,60]];
const fingers=[[['left',5]],[['right',1]],[['left',4]],[['right',2]],[['left',3]],[['right',3]],[['left',5]],[['right',1]],[['left',5],['right',1]]];
const score=notes.map((midis,i)=>({midis,startBeat:starts[i],durationBeats:1}));
const events=()=>starts.flatMap((s,i)=>notes[i].flatMap(midi=>[{type:'on',midi,at:1000+s*60000/58,source:'midi',step:i},{type:'off',midi,at:1000+(s+1)*60000/58-15,source:'midi',step:i}])).sort((a,b)=>a.at-b.at);
test('the checkpoint preserves eight single entries, its one final pair, mirrored fingers and full rest',()=>{
 const l=lesson();assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes);assert.deepEqual(copy(l.fingeringSpec.steps),fingers.map(step=>step.map(([hand,num])=>({hand,num}))));assert.deepEqual(copy(l.rhythm),original.rhythm);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.rhythm.practiceBpm,58);assert.equal(A.pianoSignature(l),'3a490456');assert.equal(l.exam,true);assert.equal(l.maxErrors,2);assert.equal(l.timeLimit,50);
});
test('the named separate preparations precede a checkpoint rather than another independent skill',()=>{
 const l=lesson();assert.deepEqual(copy(l.learning.requires),['course01-03','course01-04','course01-06','course01-07']);assert.equal(l.learning.stage,'p4');assert.equal(l.learning.after,'course01-07');assert.equal(l.learning.goalCounting,'checkpoint-only');assert.equal(l.learning.nextLessonId,'course07-01');
 const route=require('../tools/build-curriculum-plan.cjs').build(),ids=route.piano.map(x=>x.id);for(const id of l.learning.requires)assert.ok(ids.indexOf(id)<ids.indexOf(l.id),id);assert.ok(ids.indexOf(l.id)<ids.indexOf('course07-01'));assert.equal(crypto.createHash('sha256').update(JSON.stringify(route.guitar)).digest('hex'),fixture.protectedGuitarRouteSha256);
});
test('only the frozen original is reviewed once and retains its full earlier instruction and review archive',()=>{
 const list=[copy(original)];assert.equal(P.reviewTwoHandOrientationCheckpoint(list,adapter),1);const r=list[0].learning.contentReview;assert.equal(r.id,'two-hand-orientation-checkpoint-v1');assert.equal(r.sourceFingerprint,'cb5bd26a');assert.equal(r.sourceStepsFingerprint,'51fb409b');assert.equal(r.previousAssessmentFingerprint,'3a490456');assert.deepEqual(r.previousInstruction,{description:original.description,guide:original.guide,learning:original.learning});assert.deepEqual(list[0].lessonReview,original.lessonReview);assert.equal(P.reviewTwoHandOrientationCheckpoint(list,adapter),0);
});
test('private scores, fingers, instructions, checkpoint roles and grading limits block automatic review',()=>{
 for(const edit of [l=>{l.steps[0].keys=['y'];l.steps[0].key='y';},l=>l.pattern+=' t',l=>l.title+=' моя',l=>l.description='Моя проверка',l=>l.guide.blind='Мой способ',l=>l.learning.goal='Моя цель',l=>l.learning.requires=['private'],l=>l.learning.goalCounting='private',l=>l.rhythm.practiceBpm=40,l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[8][1].num=2,l=>l.contentKind='piece',l=>l.exam=false,l=>l.timeLimit=45,l=>l.maxErrors=3,l=>l.learning.contentReview={id:'private'}]){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewTwoHandOrientationCheckpoint([l],adapter),0);assert.deepEqual(l,before);}
});
test('all 572 prior music versions, IDs, membership/order and the original immutable baseline remain exact',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(crypto.createHash('sha256').update(JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old))).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../lesson-review-baseline.js'))).digest('hex'),fixture.protectedBaselineSha256);
});
test('the real MIDI assessor requires the quiet beat, the final common attack and its new right-hand key press',()=>{
 const assess=ev=>A.assessPiano({steps:score,bpm:58,targetBpm:58,profile:'standard',events:ev}).clean;assert.equal(assess(events()),true);
 assert.equal(assess(events().map(e=>e.step>=6?{...e,at:e.at-60000/58}:e)),false);
 assert.equal(assess(events().map(e=>e.step===1&&e.type==='on'?{...e,at:1000}:e)),false);
 assert.equal(assess(events().filter(e=>!(e.step===8&&e.midi===48))),false);
 assert.equal(assess(events().map(e=>e.step===8&&e.midi===60&&e.type==='on'?{...e,at:e.at+450}:e)),false);
 const held=events().filter(e=>!(e.step===7&&e.type==='off')&&!(e.step===8&&e.midi===60&&e.type==='on'));assert.equal(assess(held),false);
});
test('the actual full explanation prepares memory without forced blind search and all preferences hide its DOM content',()=>{
 const a=loadApp();a.state.lesson=a.lessons.find(l=>l.id==='course01-08');a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();for(const part of ['Техническое упражнение проекта','Восемь одиночных','6–7','у 10','Сначала подсказки открыты','новым нажатием C3'])assert.ok(html.includes(part),part);assert.doesNotMatch(html,/Смотри только на нотный холст/);for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');}
});
test('cross-bar count, familiar hearing, delayed memory and open transfer retain separate claims',()=>{
 const l=lesson(),text=l.learning.practiceSteps.join(' ');for(const s of ['«четыре» (7)','«раз» третьего такта (8)','«два» (9)','«три» (10)','вне MIDI-зачёта','D4 правой 2 → D3 левой 4 → C4 правой 1 → C3 левой 5 → C3+C4 вместе','3–5 минут','на следующий день','не новый урок'])assert.ok(text.includes(s),s);assert.equal(l.learning.provenance.type,'project-technical-drill');assert.ok(l.learning.selfCheck.some(s=>s.includes('не добавляет новой')));assert.ok(l.learning.sourceEvidenceIds.includes('ou-simple-meter-2026-11-07'));
});
test('private catalog text/classification/order and the old memory edition survive actual catalog transfer',()=>{
 const progress={'course01-08':A.record(undefined,{instrument:'piano',lessonId:'course01-08',fingerprint:'3a490456',mode:'memory',clean:true,now:1000})},raw=JSON.stringify(progress),writes=[];const a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...x)=>writes.push(x)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot()),l=snapshot.lessons.find(x=>x.id==='course01-08');l.learning.practiceSteps[0]='Моя подготовка';l.contentKind='piece';l.order=99999;assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);const restored=a.lessons.find(x=>x.id==='course01-08');assert.equal(restored.learning.practiceSteps[0],'Моя подготовка');assert.equal(restored.contentKind,'piece');assert.equal(A.pianoSignature(restored),'3a490456');assert.equal(JSON.stringify(a.state.learningProgress),raw);assert.equal(a.lessons.filter(x=>x.themeId===restored.themeId).sort((x,y)=>x.order-y.order).at(-1).id,'course01-08');
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js'),Coverage=require('../tools/piano-skill-coverage.cjs');
const original=require('./fixtures/piano-blind-rhythm-v1.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),id='course10-04',adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:66,targetBpm:66,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/66,out=[];for(const [i,s]of input.steps.entries())for(const midi of s.midis){
  if(mode==='missing-repeat'&&i===3)continue;let at=1000+s.startBeat*beat,off=1000+(s.startBeat+s.durationBeats)*beat;
  if(mode==='late-eighth'&&i===2){at+=.4*beat;off+=.4*beat;}
  if(i===input.steps.length-1){if(mode==='early')off-=.27*beat;if(mode==='late')off+=.27*beat;}
  out.push({type:'on',midi,source:'midi',at},{type:'off',midi,at:off});
 }return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('blind rhythm preserves its exact score and is the same notes, fingers and beat pattern as the prepared exam',()=>{
 const l=app.lessons.find(l=>l.id===id),base=app.lessons.find(l=>l.id==='course04-08');
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),[[60],[62],[64],[64],[65],[67],[65],[65],[64],[62],[60],[60]]);assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.deepEqual(copy(l.rhythm),original.rhythm);
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),copy(Array.from(base.steps,app.stepMidiList)));assert.deepEqual(copy(l.fingeringSpec.steps),copy(base.fingeringSpec.steps));assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),[1,.5,.5,2,1,.5,.5,2,1,.5,.5,2]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,1,1.5,2,4,5,5.5,6,8,9,9.5,10]);assert.ok(l.rhythm.steps.every(s=>!s.restBeforeBeats));assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,12);
 assert.equal(l.rhythm.practiceBpm,66);assert.equal(base.rhythm.practiceBpm,64);assert.equal(A.pianoSignature(base),'de4b5be9');assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.match(l.guide.blind,/пауз для поиска.*нет/);assert.match(original.guide.motion,/во время паузы/);
});

test('scoped holds reject previously accepted early and late endings, missing repeats and a late second eighth',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));
 for(const mode of ['early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false);}
 assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);for(const mode of ['missing-repeat','late-eighth'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI requires the repeated attack and full final half note',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);
 for(const mode of ['correct','early','late','missing-repeat','late-eighth']){const take=events(score(l),mode);a.setTestLesson(l);a.state.attemptMode='memory';for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct')assert.ok(Math.abs(clock.now-(1000+12*60000/66))<1e-6);a.resetLessonState();}
});

test('guarded review preserves user editions, unchanged source rhythm, JSON and old-version memory',()=>{
 const l=copy(original);assert.equal(P.reviewBlindRhythm([l],adapter(app)),1);const reviewed=copy(l);assert.equal(P.reviewBlindRhythm([l],adapter(app)),0);assert.deepEqual(copy(l),reviewed);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'f2d498b9');assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.deepEqual(copy(l.learning.contentReview.previousInstruction.guide),original.guide);
 for(const edit of [l=>l.title='Мой ритм',l=>l.description='Мой счёт',l=>l.guide.blind='Моя практика',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[3].durationBeats=1,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewBlindRhythm([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'f2d498b9',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:f2d498b9'].memory,true);
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);const loaded=a.lessons.find(l=>l.id===id);assert.equal(loaded.learning.practiceSteps[0],'Моя подготовка');assert.equal(loaded.learning.sameGoalAs,'course04-08');assert.equal(a.installReviewedLessons(),false);
});

test('a new BPM and memory label remain repetition in the later consolidation stage',()=>{
 const l=app.lessons.find(l=>l.id===id),ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=ctx.MUSIC_CURRICULUM_PLAN.piano,entry=route.find(r=>r.id===id);
 assert.equal(l.learning.sameGoalAs,'course04-08');assert.deepEqual(copy(l.learning.requires),['course04-08']);assert.deepEqual(copy(entry.preparation),['course04-08']);assert.equal(entry.stage,'p6');assert.ok(entry.challenge);assert.ok(route.findIndex(r=>r.id==='course04-08')<route.findIndex(r=>r.id===id));assert.ok(route.findIndex(r=>r.id==='course10-03')<route.findIndex(r=>r.id===id));assert.ok(route.findIndex(r=>r.id===id)<route.findIndex(r=>r.id==='detail-p-transfer-01'));assert.equal(l.learning.nextLessonId,'detail-p-transfer-01');assert.equal(l.learning.practiceSteps.length,3);
 const report=Coverage.build(),group=report.sameGoalGroups.find(g=>g.primaryId==='course04-08');assert.ok(group.lessonIds.includes(id));assert.equal(report.counts.goalGroupUpperBound,report.counts.implementedLearningLessons-report.counts.explicitSameGoalVariants-report.counts.explicitCheckpoints);
});

test('blind-practice notice offers a labelled action only when the prepared memory contract is available',()=>{
 for(const mode of ['practice','challenge']){const html=UI.blindPracticeHtml(true,mode,true);assert.match(html,/экранные подсказки остаются/);assert.match(html,/id="start-memory-check"/);assert.match(html,/<button type="button"/);assert.match(html,/Проверить память по MIDI/);assert.match(html,/role="status" aria-live="polite"/);}
 for(const args of [[false,'practice',true],[true,'memory',true],[true,'bad',true],['true','practice',true]])assert.equal(UI.blindPracticeHtml(...args),'');
 assert.doesNotMatch(UI.blindPracticeHtml(true,'practice',false),/start-memory-check/);assert.match(UI.blindPracticeHtml(true,'practice',false),/после подготовки учебных данных/);
 const a=loadApp({events:true}),l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.learningMaterialMode='hidden';a.setBlindMode(true);assert.match(a.learningContractHtml(),/start-memory-check/);assert.equal(a.learningMaterialHtml(),'');a.state.learningMaterialMode='expanded';assert.match(a.learningMaterialHtml(),/data-blind-mode aria-pressed="true"/);a.setBlindMode(false);assert.doesNotMatch(a.learningContractHtml(),/start-memory-check/);assert.match(a.learningMaterialHtml(),/data-blind-mode aria-pressed="false"/);
});

test('the actual memory transition releases active notes, discards the assisted attempt and requires fresh MIDI',t=>{
 let focused=0;const clock={now:1000},a=loadApp({events:true,clock,selectors:{'.lesson-name':{focus(){focused++;}}}}),l=a.lessons.find(l=>l.id===id);t.after(()=>a.resetLessonState());a.setTestLesson(l);a.state.learningMaterialMode='expanded';a.setBlindMode(true);a.handleNoteOn(60,'midi');assert.equal(a.state.started,true);assert.equal(a.state.active.has(60),true);
 assert.equal(a.startMemoryCheck(),true);assert.equal(focused,1);assert.equal(a.state.attemptMode,'memory');assert.equal(a.state.active.size,0);assert.equal(a.state.started,false);assert.equal(a.state.stepIndex,0);assert.equal(a.state.attemptEvents.length,0);assert.equal(a.state.passed,false);assert.ok(!a.state.learningProgress[id]?.memory);assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.learningContractHtml(),/start-memory-check|blind-practice-notice/);assert.doesNotMatch(a.currentNoteHtml(),/C4|палец/);
 for(const e of events(score(l))){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].memory,true);
});

test('the memory shortcut cannot force an unprepared private exercise into a graded mode',()=>{
 const a=loadApp({events:true}),l=copy(a.lessons.find(l=>l.id===id));l.id='personal-unreviewed-rhythm';a.setTestLesson(l);a.state.attemptMode='practice';a.state.blindMode=true;assert.equal(a.challengeEligible(),false);assert.equal(a.startMemoryCheck(),false);assert.equal(a.state.attemptMode,'practice');assert.doesNotMatch(a.learningContractHtml(),/start-memory-check/);a.resetLessonState();
});

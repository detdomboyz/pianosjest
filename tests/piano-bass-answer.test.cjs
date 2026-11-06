'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js'),Coverage=require('../tools/piano-skill-coverage.cjs');
const original=require('./fixtures/piano-bass-answer-v1.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),id='course09-06',adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:58,targetBpm:58,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/58,out=[];for(const [i,s]of input.steps.entries())for(const midi of s.midis){
  if(mode==='missing-answer'&&i===6)continue;let off=1000+(s.startBeat+s.durationBeats)*beat;
  if(mode==='held-bass'&&i===0)off+=beat;if(mode==='held-right'&&i===3)off+=beat;
  if(i===input.steps.length-1){if(mode==='early')off-=.27*beat;if(mode==='late')off+=.27*beat;}
  out.push({type:'on',midi,source:'midi',at:1000+s.startBeat*beat},{type:'off',midi,at:off});
 }return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('the project phrase has four regular bass entries, three quarter-note replies and a two-beat ending',()=>{
 const l=app.lessons.find(l=>l.id===id),expectedNotes=[48,60,62,64,48,64,65,67,48,67,65,64,48,62,60];
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),expectedNotes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.deepEqual(copy(l.fingeringSpec.steps.flat()),[5,1,2,3,5,3,4,5,5,5,4,3,5,2,1].map((num,i)=>({hand:i%4===0?'left':'right',num})));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),[1,1,1,1,1,1,1,1,1,1,1,1,1,1,2]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),Array.from({length:15},(_,i)=>i));assert.ok(l.rhythm.steps.every(s=>!s.restBeforeBeats));assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,16);assert.equal(l.rhythm.practiceBpm,58);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});
 assert.deepEqual([0,4,8,12].map(i=>original.rhythm.steps[i].startBeat),[0,5,10,15]);assert.equal(original.rhythm.steps.at(-1).startBeat+original.rhythm.steps.at(-1).durationBeats,18);assert.equal(l.learning.provenance.type,'project-technical-drill');assert.match(l.learning.provenance.sourceNote,/не упражнение Stephen Pierce/);assert.match(l.learning.guide?.motion||l.guide.motion,/нет баса/);
 assert.equal(A.pianoSignature(app.lessons.find(l=>l.id==='course07-06')),'5c83af1a'); // the basic edition is preserved.
});

test('old 18-beat timing and permissive release are reproduced; the revised phrase rejects old timing and held handoffs',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));assert.equal(A.assessPiano({...old,events:events(old)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(old)}).clean,false);
 for(const mode of ['early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false);}
 assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);for(const mode of ['held-bass','held-right','missing-answer'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI requires release in both handoff directions and the full final half note',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);
 for(const mode of ['correct','early','late','held-bass','held-right','missing-answer','old-rhythm']){const input=mode==='old-rhythm'?score(original):score(l),take=events(input,mode);a.setTestLesson(l);a.state.attemptMode='memory';
  for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct')assert.ok(Math.abs(clock.now-(1000+16*60000/58))<1e-6);a.resetLessonState();
 }
});

test('guarded migration preserves private edits, old timing and previous-version memory; JSON retains the repetition and cue profile',()=>{
 const l=copy(original);assert.equal(P.reviewBassAnswer([l],adapter(app)),1);const reviewed=copy(l);assert.equal(P.reviewBassAnswer([l],adapter(app)),0);assert.deepEqual(copy(l),reviewed);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'1e8193a7');assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.deepEqual(copy(l.learning.contentReview.previousInstruction.guide),original.guide);assert.deepEqual(copy(l.steps),original.steps);
 for(const edit of [l=>l.title='Мой бас',l=>l.description='Моя инструкция',l=>l.guide.motion='Моя передача',l=>l.learning.requires=['personal'],l=>l.learning.handoffCueProfile='personal',l=>l.rhythm.steps[3].durationBeats=1,l=>l.fingeringSpec.steps[0][0].num=4,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewBassAnswer([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'1e8193a7',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:1e8193a7'].memory,true);
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);const loaded=a.lessons.find(l=>l.id===id);assert.equal(loaded.learning.practiceSteps[0],'Моя подготовка');assert.equal(loaded.learning.sameGoalAs,'course07-06');assert.equal(loaded.learning.handoffCueProfile,'sequential-release');assert.equal(a.installReviewedLessons(),false);
});

test('a changed melodic order is linked as repetition of the existing handoff goal and placed after its preparation',()=>{
 const l=app.lessons.find(l=>l.id===id),ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=ctx.MUSIC_CURRICULUM_PLAN.piano,entry=route.find(r=>r.id===id);
 assert.equal(l.learning.sameGoalAs,'course07-06');assert.deepEqual(copy(l.learning.requires),['course07-06','course04-02']);assert.deepEqual(copy(entry.preparation),copy(l.learning.requires));assert.ok(entry.challenge);assert.equal(entry.stage,'p4');assert.ok(route.findIndex(r=>r.id==='course07-06')<route.findIndex(r=>r.id===id));assert.equal(l.learning.nextLessonId,'course07-03');assert.equal(l.learning.practiceSteps.length,3);
 const report=Coverage.build(),group=report.sameGoalGroups.find(g=>g.primaryId==='course07-06');assert.ok(group.lessonIds.includes(id));assert.equal(report.counts.goalGroupUpperBound,report.counts.implementedLearningLessons-report.counts.explicitSameGoalVariants-report.counts.explicitCheckpoints);
});

test('handoff cues require explicit sequential-release opt-in and stay absent for same hand, other profiles and memory',()=>{
 assert.match(UI.handHandoffHtml('sequential-release','left','right'),/левая → правая/);assert.match(UI.handHandoffHtml('sequential-release','right','left'),/правая → левая/);
 for(const args of [[undefined,'left','right'],['held-voice','left','right'],['sequential-release','left','left'],['sequential-release',null,'right'],['sequential-release','left','<img>']])assert.equal(UI.handHandoffHtml(...args),'');
 const a=loadApp({events:true}),l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='practice';a.state.showFingers=true;a.state.stepIndex=1;assert.match(a.currentNoteHtml(),/hand-handoff-hint/);assert.match(a.currentNoteHtml(),/левая → правая/);a.state.stepIndex=2;assert.doesNotMatch(a.currentNoteHtml(),/hand-handoff-hint/);a.state.stepIndex=4;assert.match(a.currentNoteHtml(),/правая → левая/);a.state.showFingers=false;assert.doesNotMatch(a.currentNoteHtml(),/hand-handoff-hint/);a.state.showFingers=true;
 for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/hand-handoff-hint|левая|правая|C3/);}
 assert.equal(A.pianoSignature(l),A.pianoSignature({...l,learning:{...l.learning,handoffCueProfile:undefined}}));
});

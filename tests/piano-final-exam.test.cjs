'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js'),Coverage=require('../tools/piano-skill-coverage.cjs'),original=require('./fixtures/piano-final-exam-v1.json');
const app=loadApp(),id='course10-08',copy=x=>JSON.parse(JSON.stringify(x)),adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:64,targetBpm:64,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const out=[],beat=60000/64;for(const[i,s]of input.steps.entries())for(const[j,midi]of s.midis.entries()){
  if(mode==='missing-pair-note'&&i===6&&j===0)continue;let end=s.startBeat+s.durationBeats;
  if((mode==='split-pair'&&i===6||mode==='split-triad'&&i===13)&&j===0)end+=.3;
  if(mode==='early-half'&&i===20)end-=.27;if(mode==='late-half'&&i===20)end+=.27;
  if(mode==='early-final'&&i===22)end-=.27;if(mode==='late-final'&&i===22)end+=.27;
  out.push({type:'on',midi,source:'midi',at:1000+s.startBeat*beat},{type:'off',midi,at:1000+end*beat});
 }if(mode==='rest-note')out.push({type:'on',midi:61,source:'midi',at:1000+6.5*beat},{type:'off',midi:61,at:1000+7*beat});return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('eight-bar control retains all 30 pitches and fingers with prepared regular entry points',()=>{
 const l=app.lessons.find(l=>l.id===id),expected=[[48],[60],[50],[62],[52],[64],[48,60],[50,62],[52,64],[48,52,55],[60],[62],[64],[60,64,67],[64],[64],[65],[67],[67],[65],[64],[62],[60]];
 assert.deepEqual(Array.from(l.steps,s=>Array.from(app.stepMidiList(s))),expected);assert.equal(expected.flat().length,30);assert.deepEqual(copy(l.steps),original.steps);assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);
 assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,1,2,3,4,5,8,10,11,12,13,14,15,16,20,21,22,23,24,25,26,28,30]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),[1,1,1,1,1,1,2,1,1,1,1,1,1,2,1,1,1,1,1,1,2,2,2]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.restBeforeBeats).filter(Boolean),[2,2]);assert.equal(l.rhythm.bpm,64);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,32);
});

test('recognizable ending matches the exact source pitches and declares its rhythmic adaptation',()=>{
 const l=app.lessons.find(l=>l.id===id),sourceSoprano=[71,71,72,74,74,72,71,69,67],ending=Array.from(l.steps.slice(14),s=>Array.from(app.stepMidiList(s))[0]);assert.deepEqual(ending,sourceSoprano.map(n=>n-7));assert.deepEqual(ending,[64,64,65,67,67,65,64,62,60]);assert.equal(l.learning.provenance.type,'study-or-adaptation');assert.match(l.learning.provenance.sourceLocation,/528.*с\. 1.*такты 1–2.*такта 3/);assert.match(l.learning.provenance.usage,/Public Domain/);assert.match(l.learning.provenance.adaptation,/шесть четвертей и три половинные/);assert.match(l.learning.provenance.adaptation,/100.*64/);
});

test('reproduced legacy split releases and half-note errors fail the unchanged v2 evaluator',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));for(const mode of ['split-pair','split-triad','early-half','late-half']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true,mode);assert.equal(A.assessPiano({...old,timingPrecision:'beat-boundary-v2',events:events(old,mode)}).clean,false,mode);assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);}
 assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(old)}).clean,false);for(const mode of ['early-final','late-final','missing-pair-note','rest-note'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI completes only after the final full half-note release at beat 32',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);for(const mode of ['correct','split-pair','split-triad','early-half','late-half','early-final','late-final','missing-pair-note','rest-note']){a.setTestLesson(l);a.state.attemptMode='memory';const take=events(score(l),mode);for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct')assert.ok(Math.abs(clock.now-(1000+32*60000/64))<1e-6);a.resetLessonState();}
});

test('exam review is guarded and idempotent and retains old instructions, timing and versioned memory',()=>{
 const l=copy(original);assert.equal(P.reviewFinalExam([l],adapter(app)),1);const revised=copy(l);assert.equal(P.reviewFinalExam([l],adapter(app)),0);assert.deepEqual(copy(l),revised);assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.deepEqual(copy(l.learning.contentReview.previousInstruction.guide),original.guide);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'3b9f601b');
 for(const edit of [l=>l.title='Мой экзамен',l=>l.description='Моя цель',l=>l.guide.blind='Мой ориентир',l=>l.learning.requires=['mine'],l=>l.rhythm.steps[0].durationBeats=2,l=>l.fingeringSpec.steps[0][0].num=4,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewFinalExam([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'3b9f601b',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:3b9f601b'].memory,true);
});

test('checkpoint has general-skill prerequisites and preserves its role across personal JSON edits',()=>{
 const a=loadApp(),l=a.lessons.find(l=>l.id===id),r=Coverage.build(),ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const ids=Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano,l=>l.id);assert.deepEqual(copy(l.learning.requires),['course07-03','course08-07','course08-01','course04-04']);assert.equal(l.learning.stage,'p6');assert.equal(l.learning.after,'course10-07');for(const prep of l.learning.requires)assert.ok(ids.indexOf(prep)<ids.indexOf(id));assert.ok(!l.learning.requires.includes('course09-01'));assert.equal(l.learning.goalCounting,'checkpoint-only');assert.equal(l.learning.sameGoalAs,undefined);assert.ok(r.checkpointLessonIds.includes(id));
 const snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);const loaded=a.lessons.find(l=>l.id===id);assert.equal(loaded.learning.practiceSteps[0],'Моя подготовка');assert.equal(loaded.learning.goalCounting,'checkpoint-only');assert.equal(loaded.contentKind,'exercise');assert.equal(a.installReviewedLessons(),false);
});

test('checkpoint explanation is explicit and the actual material never leaks it into memory',()=>{
 assert.match(UI.checkpointHtml('checkpoint-only'),/Контроль знакомых навыков/);for(const role of [null,undefined,'exercise','<script>'])assert.equal(UI.checkpointHtml(role),'');
 const a=loadApp({events:true}),l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='practice';a.state.learningMaterialMode='compact';assert.match(a.learningMaterialHtml(),/Контроль знакомых навыков/);a.state.learningMaterialMode='expanded';assert.match(a.learningMaterialHtml(),/learning-checkpoint-note/);assert.ok(a.learningMaterialHtml().includes('Учебный этюд / адаптация'));assert.match(a.learningMaterialHtml(),/Public Domain/);a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/Контроль знакомых|подготовка|3b9f601b/);
});

test('real audio-duration function keeps the adapted final half note uncut',()=>{
 const l=app.lessons.find(l=>l.id===id);assert.equal(app.previewSoundDurationMs(l,22,64,937.5),1875);assert.equal(app.previewSoundDurationMs(l,21,64,937.5),1875);assert.equal(app.previewSoundDurationMs(l,20,64,937.5),1875);
});

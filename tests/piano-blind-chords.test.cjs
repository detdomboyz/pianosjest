'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js'),Coverage=require('../tools/piano-skill-coverage.cjs');
const original=require('./fixtures/piano-blind-chords-v1.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),id='course10-06',adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:54,targetBpm:54,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/54,out=[];for(const [i,s]of input.steps.entries())for(const [j,m]of s.midis.entries()){
  let midi=m,start=s.startBeat,end=start+s.durationBeats;
  if(mode==='split'&&i===0&&j===0)end+=.3;
  if(mode==='early'&&i===4)end-=.27;
  if(mode==='late'&&i===4)end+=.27;
  if(mode==='staggered-onset'&&i===0&&j===2)start+=.5;
  if(mode==='wrong-last-register'&&i===4)midi+=12;
  out.push({type:'on',midi,source:'midi',at:1000+start*beat},{type:'off',midi,at:1000+end*beat});
 }if(mode==='rest-note')out.push({type:'on',midi:61,source:'midi',at:1000+2.4*beat},{type:'off',midi:61,at:1000+2.7*beat});return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('blind chords retain exact notes, assigned hands, fingers and absolute timing with a three-beat count',()=>{
 const l=app.lessons.find(l=>l.id===id),prepared=app.lessons.find(l=>l.id==='course08-05');
 const notes=[[60,64,67],[65,69,72],[67,71,74],[60,64,67],[48,52,55]];
 assert.deepEqual(Array.from(l.steps,s=>Array.from(app.stepMidiList(s))),notes);assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.deepEqual(copy(l.steps),original.steps);
 assert.deepEqual(Array.from(l.steps.slice(0,4),s=>Array.from(app.stepMidiList(s))),Array.from(prepared.steps,s=>Array.from(app.stepMidiList(s))));
 assert.deepEqual(copy(l.fingeringSpec.steps).map(g=>g.map(n=>[n.hand,n.num])),[...Array.from({length:4},()=>[['right',1],['right',3],['right',5]]),[['left',5],['left',3],['left',1]]]);
 const absolute=r=>Array.from(r.steps,s=>[s.startBeat,s.durationBeats,s.restBeforeBeats,s.sourceStartMs,s.sourceDurationMs]);assert.deepEqual(absolute(l.rhythm),absolute(original.rhythm));
 assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:3,denominator:4});assert.deepEqual(Array.from(l.rhythm.steps,s=>s.measure),[1,2,3,4,5]);assert.ok(l.rhythm.steps.every(s=>s.beatInMeasure===0));assert.equal(l.rhythm.bpm,54);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,14);
 assert.match(l.learning.practiceSteps.join(' '),/конечная|последнюю тишину/);assert.match(l.learning.provenance.sourceNote,/с\. 20–21/);
});

test('scoped common release rejects reproduced split release and early/late final holds',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));
 for(const mode of ['split','early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true,mode+' was accepted before');assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode+' must now fail');}
 assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);for(const mode of ['staggered-onset','wrong-last-register','rest-note'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI path needs all five chords and their complete releases before memory credit',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);
 for(const mode of ['correct','split','early','late','staggered-onset','wrong-last-register','rest-note']){a.setTestLesson(l);a.state.attemptMode='memory';const take=events(score(l),mode);for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct')assert.ok(Math.abs(clock.now-(1000+14*60000/54))<1e-6);a.resetLessonState();}
});

test('guarded chord review preserves personal editions and is idempotent',()=>{
 const l=copy(original);assert.equal(P.reviewBlindChords([l],adapter(app)),1);const reviewed=copy(l);assert.equal(P.reviewBlindChords([l],adapter(app)),0);assert.deepEqual(copy(l),reviewed);assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.deepEqual(copy(l.learning.contentReview.previousInstruction.guide),original.guide);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'bb277306');
 for(const edit of [l=>l.title='Мой C',l=>l.description='Моя цель',l=>l.guide.blind='Мои подсказки',l=>l.learning.requires=['mine'],l=>l.rhythm.steps[0].durationBeats=1,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewBlindChords([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
});

test('JSON roundtrip and versioned memory preserve the old edition without inheriting its credit',()=>{
 const l=app.lessons.find(l=>l.id===id),a=loadApp();let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'bb277306',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:bb277306'].memory,true);
 const snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);const loaded=a.lessons.find(l=>l.id===id);assert.equal(loaded.learning.practiceSteps[0],'Моя подготовка');assert.equal(loaded.learning.sameGoalAs,'course08-05');assert.equal(loaded.contentKind,'exercise');assert.equal(a.installReviewedLessons(),false);
});

test('both hands and the left triple pulse precede consolidation; repetition reduces only the goal upper bound',()=>{
 const l=app.lessons.find(l=>l.id===id),r=Coverage.build(),ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const ids=Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano,l=>l.id);assert.equal(l.learning.stage,'p6');assert.equal(l.learning.after,'course10-05');assert.deepEqual(copy(l.learning.requires),['course08-05','course08-02','detail-p-left-triple-pulse-01']);for(const prep of l.learning.requires)assert.ok(ids.indexOf(prep)<ids.indexOf(id));assert.equal(l.learning.sameGoalAs,'course08-05');assert.equal(l.learning.nextLessonId,'course08-06');assert.ok(r.sameGoalGroups.find(g=>g.primaryId==='course08-05').lessonIds.includes(id));assert.equal(r.counts.goalGroupUpperBound,r.counts.implementedLearningLessons-r.counts.explicitSameGoalVariants-r.counts.explicitCheckpoints);assert.equal(r.counts.verifiedDistinctGoalCount,null);
});

test('common-release presenter requires the scoped contract and valid distinct MIDI notes',()=>{
 assert.match(UI.chordReleaseHtml('beat-boundary-v2',[60,64,67]),/отпусти вместе/);assert.match(UI.chordReleaseHtml('beat-boundary-v2',[48,52,55]),/Все|все/);
 for(const notes of [null,undefined,[],[60],[60,60],[NaN,64],[60,128],['60',64],Array.from({length:11},(_,i)=>i+40)])assert.equal(UI.chordReleaseHtml('beat-boundary-v2',notes),'');for(const profile of [undefined,'beat-boundary-v1','standard'])assert.equal(UI.chordReleaseHtml(profile,[60,64,67]),'');
});

test('actual target explains the common end for both hands and hides the cue from memory and legacy data',()=>{
 const a=loadApp({events:true}),l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='practice';a.state.showFingers=true;assert.match(a.currentNoteHtml(),/chord-release-hint/);a.state.stepIndex=4;assert.match(a.currentNoteHtml(),/chord-release-hint/);assert.match(a.currentNoteHtml(),/левая/i);a.state.attemptMode='memory';assert.doesNotMatch(a.currentNoteHtml(),/chord-release-hint|C3|E3|G3|отпусти вместе/);a.setTestLesson(copy(original));a.state.attemptMode='practice';assert.doesNotMatch(a.currentNoteHtml(),/chord-release-hint/);
});

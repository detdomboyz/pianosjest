'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js');
const original=require('./fixtures/piano-mary-v1.json'),source=require('../docs/sources/mary-commons-source.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),id='course09-04';
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:64,targetBpm:64,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/64,out=[];for(const [i,s]of input.steps.entries())for(const midi of s.midis){
  if(mode==='missing-repeat'&&i===19)continue;
  let off=1000+(s.startBeat+s.durationBeats)*beat;
  if(i===9&&mode==='short-phrase-ending')off-=beat;
  if(i===input.steps.length-1){if(mode==='early')off-=.27*beat;if(mode==='late')off+=.27*beat;if(mode==='last-one')off=1000+(s.startBeat+1)*beat;}
  out.push({type:'on',midi,source:'midi',at:1000+s.startBeat*beat},{type:'off',midi,at:off});
 }return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('Mary follows all eight independently read source bars, with the three half endings and final whole note',()=>{
 const l=app.lessons.find(l=>l.id===id),notes=source.bars.flatMap(b=>b.midi.map(m=>[m-7])),durations=source.bars.flatMap(b=>b.quarterDurations);
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),notes);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),durations);assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand==='right'));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,1,2,3,4,5,6,8,9,10,12,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28]);assert.ok(l.rhythm.steps.every(s=>s.restBeforeBeats===0));assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,32);assert.equal(original.rhythm.steps.at(-1).startBeat+original.rhythm.steps.at(-1).durationBeats,29);
 assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.practiceBpm,64);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.provenance.type,'study-or-adaptation');assert.equal(l.learning.provenance.score.transpositionSemitones,-7);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source.sourceFile.path)).digest('hex'),source.sourceFile.sha256);assert.match(l.learning.provenance.author,/автор.*не установлен/);assert.match(l.learning.provenance.sourceNote,/авторство не переносится/);assert.equal(source.sourceQuarterBpm,null);
});

test('old 29-beat timing and permissive releases are reproduced, while the new phrase rejects them',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));assert.equal(A.assessPiano({...old,events:events(old)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(old)}).clean,false);
 for(const mode of ['early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false);}
 assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);for(const mode of ['last-one','short-phrase-ending','missing-repeat'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI requires every repeated attack and ends only after the full four-beat C',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);
 for(const mode of ['correct','early','late','last-one','short-phrase-ending','missing-repeat','old-rhythm']){const input=mode==='old-rhythm'?score(original):score(l),take=events(input,mode);a.setTestLesson(l);a.state.attemptMode='memory';
  for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct'){assert.equal(a.state.completed,true);assert.equal(clock.now,31000);}a.resetLessonState();
 }
 assert.equal(a.previewSoundDurationMs(l,25,64,500),3750); // actual sample duration follows the whole note.
});

test('guarded review preserves private editions, source data, JSON and old music-version memory',()=>{
 const l=copy(original);assert.equal(P.reviewMary([l],adapter(app)),1);const reviewed=copy(l);assert.equal(P.reviewMary([l],adapter(app)),0);assert.deepEqual(copy(l),reviewed);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'ccd2659e');assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.deepEqual(copy(l.learning.contentReview.previousInstruction.guide),original.guide);assert.deepEqual(copy(l.steps),original.steps);
 for(const edit of [l=>l.title='Моя Mary',l=>l.description='Мой разбор',l=>l.guide.motion='Мои пальцы',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[25].durationBeats=2,l=>l.fingeringSpec.steps[4][0].num=2,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewMary([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'ccd2659e',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:ccd2659e'].memory,true);
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.installReviewedLessons(),false);
});

test('the route requires general rhythm and finger preparation without creating a next-lesson loop',()=>{
 const l=app.lessons.find(l=>l.id===id),ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=ctx.MUSIC_CURRICULUM_PLAN.piano,entry=route.find(r=>r.id===id);
 assert.deepEqual(copy(l.learning.requires),['course04-03','course02-02','detail-p-position-skips-02','course05-06']);assert.deepEqual(copy(entry.preparation),copy(l.learning.requires));assert.ok(entry.challenge);assert.ok(route.findIndex(r=>r.id==='course09-03')<route.findIndex(r=>r.id===id));assert.equal(l.learning.nextLessonId,'course09-05');assert.equal(l.learning.requires.some(id=>id.startsWith('course09')),false);assert.equal(l.learning.practiceSteps.length,3);assert.equal(l.learning.sameGoalAs,undefined);
});

test('the whole-note cue counts four quarter beats only in 4/4 and never leaks into a memory attempt',()=>{
 assert.match(UI.wholeNoteHtml(4,4,4),/раз, два, три, четыре/);assert.match(UI.wholeNoteHtml(4,4,4),/Отпусти у следующего/);
 for(const args of [[2,4,4],[4,2,2],[4,3,4],[4,4,8],[NaN,4,4],[Infinity,4,4],[undefined,4,4]])assert.equal(UI.wholeNoteHtml(...args),'');
 const a=loadApp({events:true}),l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='practice';a.state.stepIndex=25;assert.match(a.currentNoteHtml(),/whole-note-hint/);assert.match(a.currentNoteHtml(),/4 доли/);a.state.stepIndex=6;assert.doesNotMatch(a.currentNoteHtml(),/whole-note-hint/);
 for(const mode of ['compact','expanded','hidden']){a.state.stepIndex=25;a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/whole-note-hint|раз, два|C4|четыре/);}
 assert.equal(A.pianoSignature(l),A.pianoSignature({...l,description:'Иной вид разбора'}));
});

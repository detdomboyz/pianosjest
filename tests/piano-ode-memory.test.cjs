'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const original=require('./fixtures/piano-ode-memory-v1.json'),source=require('../docs/sources/mutopia-528-ode-source.json'),Coverage=require('../tools/piano-skill-coverage.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),id='course09-07',adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:66,targetBpm:66,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/66,out=[];for(const [i,s]of input.steps.entries())for(const midi of s.midis){
  if(mode==='missing-repeat'&&i===input.steps.length-1)continue;
  let off=1000+(s.startBeat+s.durationBeats)*beat;
  if(i===14&&mode==='short-first-ending')off-=beat;
  if(i===input.steps.length-1){if(mode==='early')off-=.27*beat;if(mode==='late')off+=.27*beat;}
  out.push({type:'on',midi,source:'midi',at:1000+s.startBeat*beat},{type:'off',midi,at:off});
 }return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('combined Ode follows independent soprano bars 1–8, including both dotted endings and an unbroken 16-beat join',()=>{
 const l=app.lessons.find(l=>l.id===id),midi=source.phrases.flatMap(p=>p.sourceMidi.map(m=>m-7)),durations=source.phrases.flatMap(p=>p.quarterDurations);
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),midi.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand==='right'));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),durations);assert.equal(l.rhythm.practiceBpm,66);assert.ok(l.rhythm.steps.every(s=>s.restBeforeBeats===0));assert.equal(l.rhythm.steps[13].startBeat,13.5);assert.equal(l.rhythm.steps[14].durationBeats,2);assert.equal(l.rhythm.steps[15].startBeat,16);assert.equal(l.rhythm.steps[28].startBeat,29.5);assert.equal(l.rhythm.steps[29].startBeat+l.rhythm.steps[29].durationBeats,32);
 assert.equal(original.rhythm.steps.reduce((n,s)=>n+s.durationBeats,0),30);assert.equal(original.rhythm.steps.at(-1).startBeat+original.rhythm.steps.at(-1).durationBeats,31);assert.equal(original.rhythm.steps[15].restBeforeBeats,1);assert.deepEqual(copy(l.learning.provenance.score.bars),[1,8]);assert.equal(l.learning.provenance.type,'study-or-adaptation');assert.equal(l.learning.timingPrecision,'beat-boundary-v1');
});

test('the old 31-beat edition and its permissive releases are reproduced, while the new 32-beat contract rejects them',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));assert.equal(A.assessPiano({...old,events:events(old)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(old)}).clean,false);
 for(const mode of ['early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true);assert.equal(A.assessPiano({...old,timingPrecision:'beat-boundary-v1',events:events(old,mode)}).clean,false);assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false);}
 assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);for(const mode of ['missing-repeat','short-first-ending'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI completes only after the full last note and never credits the old rhythm or a missing repeat',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);
 for(const mode of ['correct','early','late','missing-repeat','short-first-ending','old-rhythm']){const input=mode==='old-rhythm'?score(original):score(l),take=events(input,mode);a.setTestLesson(l);a.state.attemptMode='memory';for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1&&mode==='correct')assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct'){assert.equal(a.state.completed,true);assert.ok(Math.abs(clock.now-(1000+32*60000/66))<1e-6);}a.resetLessonState();
 }
});

test('guarded combined-edition migration keeps private edits, JSON and previous-version memory history',()=>{
 const l=copy(original);assert.equal(P.reviewOdeMemory([l],adapter(app)),1);const after=copy(l);assert.equal(P.reviewOdeMemory([l],adapter(app)),0);assert.deepEqual(copy(l),after);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'1a3225a8');assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);
 for(const edit of [l=>l.title='Моя связка',l=>l.description='Мой разбор',l=>l.guide.blind='Мои условия',l=>l.learning.after='personal',l=>l.rhythm.steps[15].restBeforeBeats=2,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewOdeMemory([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'1a3225a8',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:1a3225a8'].memory,true);
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===id).learning.sameGoalAs,'course09-02');assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.installReviewedLessons(),false);
});

test('a memory repetition is linked to its existing goal and its instructions require truly hidden cues',()=>{
 const l=app.lessons.find(l=>l.id===id);assert.equal(l.learning.sameGoalAs,'course09-02');assert.equal(l.learning.after,'course09-02');assert.deepEqual(copy(l.learning.requires),['course09-01','course09-02']);assert.match(l.guide.blind,/скрыты все учебные подсказки/);assert.doesNotMatch(l.description,/Оставь только подсказку пальца/);
 const report=Coverage.build(),group=report.sameGoalGroups.find(g=>g.primaryId==='course09-02');assert.deepEqual(group,{primaryId:'course09-02',lessonIds:['course09-02',id,'course10-07']});assert.equal(report.counts.goalGroupUpperBound,report.counts.implementedLearningLessons-report.counts.explicitSameGoalVariants-report.counts.explicitCheckpoints);
 app.state.lesson=l;app.state.attemptMode='memory';app.state.learningMaterialMode='expanded';assert.equal(app.learningMaterialHtml(),'');assert.doesNotMatch(app.currentNoteHtml(),/E4|D4|палец/);assert.match(app.learningContractHtml(),/id="memory-assistance-status"[^>]+role="status"[^>]+aria-live="polite"/);assert.doesNotMatch(app.learningContractHtml(),/использована подсказка/);app.state.attemptMode='practice';
});

test('listening after the first MIDI note gives immediate memory-status feedback and cannot earn memory credit',t=>{
 const clock={now:1000},notice={textContent:''},a=loadApp({events:true,playback:true,clock,elements:{'memory-assistance-status':notice}}),l=a.lessons.find(l=>l.id===id),take=events(score(l));t.after(()=>{a.stopPlayback();a.resetLessonState();});
 a.setTestLesson(l);a.state.attemptMode='memory';a.startPlayback();assert.equal(a.state.attemptAssisted,false);assert.equal(a.state.playbackPlaying,true);
 for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on'){a.handleNoteOn(e.midi,'midi');if(i===0){assert.equal(a.state.playbackPlaying,false);a.startPlayback();assert.equal(a.state.attemptAssisted,true);assert.match(notice.textContent,/Зачёт памяти не записывается/);assert.match(a.learningContractHtml(),/В этой попытке использована подсказка/);}}else a.handleNoteOff(e.midi);}
 assert.equal(a.state.completed,true);assert.equal(a.state.passed,false);assert.ok(!a.state.learningProgress[id]?.memory);
 a.setTestLesson(l);a.state.attemptMode='memory';a.startPlayback();assert.equal(notice.textContent,'');for(const e of take){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}assert.equal(a.state.attemptAssisted,false);assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].memory,true);
});

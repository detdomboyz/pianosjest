'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),D=require('../lesson-development.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),copy=v=>JSON.parse(JSON.stringify(v)),ids=['detail-p-rhythm-01','detail-p-rhythm-02','detail-p-rhythm-03','detail-p-rhythm-04'];
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide};
function originals(){const lessons=[];D.registerPiano(lessons,[],adapter,D.piano.filter(s=>ids.includes(s.id)));return lessons;}
function input(l){return {steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:l.rhythm.practiceBpm,targetBpm:l.rhythm.practiceBpm,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision};}
function eventsFor(score,hold=s=>s.durationBeats){const beat=60000/score.bpm;return score.steps.flatMap(s=>[{type:'on',midi:s.midis[0],at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+hold(s))*beat}]);}

test('rhythm review keeps every note, hand, finger, duration and rest while versioning only the tighter checks',()=>{
  const old=originals(),cases=[[[60,60],[0,4],[4,4],56],[[60,60,60,60,60,60],[0,2,3,4,6,7],[2,1,1,2,1,1],56],[[60,60,60,60],[0,2,4,6],[1,1,1,1],56],[[60,62,60,62,60,62,60,62],[0,.5,1,1.5,2,2.5,3,3.5],[.5,.5,.5,.5,.5,.5,.5,.5],48]];
  for(const [i,id] of ids.entries()){const l=app.lessons.find(l=>l.id===id),[notes,starts,durations,bpm]=cases[i],before=old.find(l=>l.id===id);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),notes);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),starts);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),durations);assert.deepEqual(copy(l.rhythm),copy(before.rhythm));assert.equal(l.rhythm.practiceBpm,bpm);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),notes.map(n=>n===60?1:2));assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand==='right'));assert.equal(l.learning.coverageDomain,'rhythm');assert.equal(l.learning.contentReview.id,'early-rhythm-v1');
    if(i<2){assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.notEqual(A.pianoSignature(l),A.pianoSignature(before));}else assert.equal(A.pianoSignature(l),A.pianoSignature(before));app.state.lesson=l;assert.equal(app.challengeEligible(),true);
  }
});

test('four-beat notes cannot pass as three beats and half notes cannot pass as one beat',()=>{
  for(const id of ids.slice(0,2)){const l=app.lessons.find(l=>l.id===id),score=input(l),correct=eventsFor(score);assert.equal(A.assessPiano({...score,events:correct}).clean,true);const shortened=eventsFor(score,s=>s.durationBeats>1?s.durationBeats-1:s.durationBeats);assert.equal(A.assessPiano({...score,events:shortened}).clean,false);assert.ok(A.assessPiano({...score,events:shortened}).durationErrors>0);const close=eventsFor(score,s=>s.durationBeats-.08);assert.equal(A.assessPiano({...score,events:close}).clean,true);}
  const l=app.lessons.find(l=>l.id===ids[0]),score=input(l),short=eventsFor(score,()=>3);assert.equal(A.assessPiano({...score,timingPrecision:undefined,events:short}).clean,true);assert.equal(A.assessPiano({...score,timingPrecision:'unknown',events:eventsFor(score)}).clean,false);
});

test('actual app supplies the new timing contract and rejects a shortened whole note on final release',()=>{
  for(const duration of [4,3]){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===ids[0]),beat=60000/56;a.setTestLesson(l);a.state.attemptMode='challenge';for(const [i,s] of l.rhythm.steps.entries()){clock.now=1000+s.startBeat*beat;a.handleNoteOn(60,'midi');if(i===1)assert.equal(a.state.completed,false);clock.now=1000+(s.startBeat+duration)*beat;a.handleNoteOff(60);}assert.equal(a.state.completed,true);assert.equal(a.state.passed,duration===4);assert.equal(a.state.assessment.timingPrecision,'beat-boundary-v1');a.resetLessonState();}
});

test('repeated C needs a release and a note during an internal rest cannot earn a clean take',()=>{
  const l=app.lessons.find(l=>l.id===ids[0]),score=input(l),events=eventsFor(score);assert.equal(A.assessPiano({...score,events:events.filter((e,i)=>i!==1)}).clean,false);
  const rest=input(app.lessons.find(l=>l.id===ids[2])),clean=eventsFor(rest),beat=60000/56,extra=[...clean,{type:'on',midi:62,at:1000+1.4*beat,source:'midi'},{type:'off',midi:62,at:1000+1.6*beat}].sort((a,b)=>a.at-b.at);assert.equal(A.assessPiano({...rest,events:clean}).clean,true);assert.equal(A.assessPiano({...rest,events:extra}).clean,false);
});

test('rest lesson explicitly teaches three internal rests while final silence remains a manual task',()=>{
  const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===ids[2]),beat=60000/56;a.setTestLesson(l);a.state.attemptMode='challenge';for(const s of l.rhythm.steps){clock.now=1000+s.startBeat*beat;a.handleNoteOn(60,'midi');clock.now=1000+(s.startBeat+s.durationBeats)*beat;a.handleNoteOff(60);}assert.equal(a.state.completed,true);assert.equal(a.state.passed,true);assert.ok(Math.abs((clock.now-1000)/beat-7)<1e-8);assert.match(l.description,/три внутренние паузы/);assert.match(l.learning.selfCheck.join(' '),/Конечная тишина.*не измеряется/);a.resetLessonState();
});

test('only untouched rhythm originals migrate and the stricter contract retains old progress as history',()=>{
  const lessons=originals();assert.equal(P.reviewEarlyRhythm(lessons,adapter),4);const saved=copy(lessons);assert.equal(P.reviewEarlyRhythm(lessons,adapter),0);assert.deepEqual(copy(lessons),saved);
  for(const original of originals())for(const edit of [l=>l.learning.goal='Моя цель',l=>l.learning.timingPrecision='my-check',l=>l.guide.motion='Мой разбор',l=>l.rhythm.steps[0].durationBeats=.4,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'mine'}]){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewEarlyRhythm([l],adapter),0);assert.deepEqual(l,before);}
  const old=originals()[0],current=app.lessons.find(l=>l.id===ids[0]),oldSig=A.pianoSignature(old),newSig=A.pianoSignature(current);let progress=A.record(undefined,{instrument:'piano',lessonId:old.id,fingerprint:oldSig,mode:'challenge',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:old.id,fingerprint:newSig,mode:'challenge',clean:true,now:2000});assert.equal(progress.cleanTakes,1);assert.equal(progress.history['1:'+oldSig].cleanTakes,1);assert.equal(progress.fingerprint,newSig);
});

test('rhythm instructions, sources and chosen precision survive app export and personal text edits',()=>{
  for(const id of ids){const l=app.lessons.find(l=>l.id===id),html=D.materialHtml(l,'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/не фраза текущего зачёта/);assert.match(html,/Gotham, Hamm, Shaffer/);assert.doesNotMatch(html,/Cliff Smith|Трезвучия/);}assert.match(app.lessons.find(l=>l.id===ids[0]).learning.practiceSteps[1],/только три доли|четыре полные доли/);assert.match(app.lessons.find(l=>l.id===ids[3]).learning.practiceSteps[1],/полдоли/);
  const a=loadApp(),snapshot=a.catalogSnapshot();for(const id of ids)snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Мой счёт '+id;a.applyCatalogSnapshot(snapshot);for(const id of ids)assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Мой счёт '+id);assert.equal(a.lessons.find(l=>l.id===ids[0]).learning.timingPrecision,'beat-boundary-v1');assert.equal(a.installReviewedLessons(),false);
});

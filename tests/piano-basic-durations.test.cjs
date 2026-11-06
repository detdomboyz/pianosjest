'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),Q=require('../lesson-quality.js'),B=require('../lesson-review-baseline.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
const app=loadApp(),raw=loadApp({unreviewed:true}),copy=v=>JSON.parse(JSON.stringify(v)),ids=['course04-02','course04-03','course04-04'];
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide,parsePattern:a.parsePattern,midis:a.stepMidiList,spacesBefore:a.lessonSpacesBefore});
const frozen=ids.map(id=>{const l=raw.lessons.find(l=>l.id===id);assert.equal(Q.repairPiano(l,B,adapter(raw)),true);return copy(l);});
const originals=()=>copy(frozen);
function score(l){return {steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:l.rhythm.practiceBpm,targetBpm:l.rhythm.practiceBpm,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision};}
function events(input,mode='correct'){const beat=60000/input.bpm;return input.steps.flatMap((s,i)=>{const shift=mode==='early'&&s.durationBeats>1?-(s.durationBeats===4?1:.5):mode==='late'&&i===input.steps.length-1?(s.durationBeats===4?1:.5):0;return [{type:'on',midi:s.midis[0],at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+s.durationBeats+shift)*beat}];}).sort((a,b)=>a.at-b.at);}

test('basic durations retain notes, explicit fingers, rhythm and tempo while only their assessment versions change',()=>{
  const cases=[[[60,60,60,60],[1,1,1,1],[2,2,2,2],60],[[60,60],[1,1],[4,4],56],[[60,60,62,60,60,62,64,64,62,64,64,60],[1,1,2,1,1,2,3,3,2,3,3,1],[1,1,2,1,1,2,1,1,2,1,1,2],60]];
  for(const [i,id] of ids.entries()){const l=app.lessons.find(l=>l.id===id),[notes,fingers,durations,bpm]=cases[i];assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),notes);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),fingers);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand==='right'));assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),durations);assert.deepEqual(copy(l.rhythm),frozen[i].rhythm);assert.equal(l.rhythm.practiceBpm,bpm);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.contentReview.id,'basic-duration-v1');assert.equal(l.learning.coverageDomain,'rhythm');assert.equal(l.contentKind,'exercise');assert.notEqual(A.pianoSignature(l),A.pianoSignature(frozen[i]));app.state.lesson=l;assert.equal(app.challengeEligible(),true);}
});

test('the old early and late releases reproduce as clean controls but the selected new contracts reject both',()=>{
  for(const id of ids){const input=score(app.lessons.find(l=>l.id===id));assert.equal(A.assessPiano({...input,events:events(input)}).clean,true);for(const mode of ['early','late']){assert.equal(A.assessPiano({...input,timingPrecision:undefined,events:events(input,mode)}).clean,true,id+' old '+mode);const result=A.assessPiano({...input,events:events(input,mode)});assert.equal(result.clean,false,id+' new '+mode);assert.ok(result.durationErrors>0);}}
});

test('actual MIDI completion enforces the new contract and waits for the final release in each basic lesson',()=>{
  for(const id of ids)for(const mode of ['correct','early','late']){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id),input=score(l),take=events(input,mode);a.setTestLesson(l);a.state.attemptMode='challenge';for(const [i,e] of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.completed,true);assert.equal(a.state.passed,mode==='correct',id+' '+mode);assert.equal(a.state.assessment.timingPrecision,'beat-boundary-v1');a.resetLessonState();}
});

test('only the frozen basic editions migrate and personal classifications, music and text remain unchanged',()=>{
  const lessons=originals();assert.equal(P.reviewBasicDurations(lessons,adapter(app)),3);const saved=copy(lessons);assert.equal(P.reviewBasicDurations(lessons,adapter(app)),0);assert.deepEqual(copy(lessons),saved);
  for(const original of originals())for(const edit of [l=>l.description='Мой урок',l=>l.learning.goal='Моя цель',l=>l.learning.timingPrecision='my-check',l=>l.learning.requires=['my-preparation'],l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.contentKind='exercise',l=>l.learning.contentReview={id:'mine'}]){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewBasicDurations([l],adapter(app)),0);assert.deepEqual(l,before);}
});

test('each new contract preserves the former progress record and survives catalog exchange with personal edits',()=>{
  for(const [i,id] of ids.entries()){const now=app.lessons.find(l=>l.id===id),oldSig=A.pianoSignature(frozen[i]),newSig=A.pianoSignature(now);let p=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:oldSig,mode:'challenge',clean:true,now:1000});p=A.record(p,{instrument:'piano',lessonId:id,fingerprint:newSig,mode:'challenge',clean:true,now:2000});assert.equal(p.cleanTakes,1);assert.equal(p.history['1:'+oldSig].cleanTakes,1);}
  const a=loadApp(),snapshot=a.catalogSnapshot();for(const id of ids)snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Мой разбор '+id;a.applyCatalogSnapshot(snapshot);for(const id of ids){const l=a.lessons.find(l=>l.id===id);assert.equal(l.learning.practiceSteps[0],'Мой разбор '+id);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');}assert.equal(a.installReviewedLessons(),false);
});

test('basic duration materials explain full boundaries, phrase-specific fingers, sources and separate transfer trials',()=>{
  for(const id of ids){const html=D.materialHtml(app.lessons.find(l=>l.id===id),'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/для нового зачёта нужен повтор/);assert.match(html,/не фраза текущего зачёта/);assert.match(html,/Gotham, Hamm, Shaffer/);}const whole=app.lessons.find(l=>l.id===ids[1]);assert.match(whole.learning.practiceSteps[1],/«четыре» начинает четвёртую долю/);const mixed=app.lessons.find(l=>l.id===ids[2]);assert.match(mixed.description,/1–1–2, 1–1–2, 3–3–2, 3–3–1/);assert.match(mixed.learning.practiceSteps[1],/Последний|последний C4/);
});

test('repositioning an existing lesson keeps one route entry and merges old and new preparation',()=>{
  const plan=require('../tools/build-curriculum-plan.cjs').build().piano,entries=plan.filter(e=>e.id==='course04-04');assert.equal(plan.length,app.lessons.length);assert.equal(new Set(plan.map(e=>e.id)).size,plan.length);assert.equal(entries.length,1);
  const entry=entries[0];assert.deepEqual(new Set(entry.preparation),new Set(['course04-03','course02-02','course04-02']));const index=plan.findIndex(e=>e.id===entry.id);for(const req of entry.preparation)assert.ok(plan.findIndex(e=>e.id===req)>=0&&plan.findIndex(e=>e.id===req)<index,req);
});

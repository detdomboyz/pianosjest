'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),Q=require('../lesson-quality.js'),B=require('../lesson-review-baseline.js'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
const copy=x=>JSON.parse(JSON.stringify(x)),id='course08-06',app=loadApp(),raw=loadApp({unreviewed:true});
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide,parsePattern:a.parsePattern,midis:a.stepMidiList,spacesBefore:a.lessonSpacesBefore});
const original=raw.lessons.find(l=>l.id===id);assert.equal(Q.repairPiano(original,B,adapter(raw)),true);const frozen=copy(original);
const notes=[60,64,67,67,64,60,65,69,72,72,69,65,67,71,74,74,71,67];
const starts=[0,.5,1,1.5,2,2.5,4,4.5,5,5.5,6,6.5,8,8.5,9,9.5,10,10.5],beat=60000/56;
function score(l){return {steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:56,targetBpm:56};}
function events(mode='correct'){
 const out=[];for(const [i,midi]of notes.entries()){
  if(mode==='held-top'&&i===3)continue;
  let start=starts[i],end=start+.5;
  if(mode==='held-top'&&i===2)end+=.5;
  if(mode==='carry-into-rest'&&i===5)end+=.6;
  if(mode==='shorten-rest'&&i>=6){start-=1;end-=1;}
  out.push({type:'on',midi,source:'midi',at:1000+start*beat},{type:'off',midi,at:1000+end*beat});
 }
 if(mode==='extra-in-rest')out.push({type:'on',midi:61,source:'midi',at:1000+3.25*beat},{type:'off',midi:61,at:1000+3.5*beat});
 return out.sort((a,b)=>a.at-b.at);
}

test('broken-chord instructions replace the confirmed blocked-chord mismatch while retaining exact notes, fingers and music version',()=>{
 const l=app.lessons.find(l=>l.id===id);assert.match(frozen.guide.motion,/Нажимай аккорд/);
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),notes.map(n=>[n]));assert.ok(l.steps.every(s=>app.stepMidiList(s).length===1));
 assert.deepEqual(copy(l.fingeringSpec),frozen.fingeringSpec);assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),Array(3).fill([1,3,5,5,3,1]).flat());assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand==='right'));
 assert.deepEqual(copy(l.rhythm),frozen.rhythm);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===.5));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>s.restBeforeBeats),notes.map((_,i)=>i===6||i===12?1:0));assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,11);
 assert.equal(A.pianoSignature(l),'c1cf2e24');assert.equal(A.pianoSignature(l),A.pianoSignature(frozen));assert.doesNotMatch(l.guide.motion,/Нажимай аккорд/);assert.match(l.guide.motion,/по одной клавише/);
 assert.deepEqual(copy(l.learning.contentReview.previousInstruction),{description:frozen.description,guide:frozen.guide,learning:frozen.learning});
 assert.deepEqual(copy(l.learning.requires),['course08-05','course04-05','course04-06']);assert.equal(l.learning.stage,'p5');assert.equal(l.learning.after,'course08-05');
});

test('independent eighth-note traces require a fresh top attack, both internal rests and the final release',()=>{
 const input=score(app.lessons.find(l=>l.id===id));assert.equal(A.assessPiano({...input,events:events()}).clean,true);
 for(const mode of ['held-top','carry-into-rest','shorten-rest','extra-in-rest'])assert.equal(A.assessPiano({...input,events:events(mode)}).clean,false,mode);
 const take=events();take.pop();assert.equal(A.assessPiano({...input,events:take}).clean,false,'the last held note is not completed');
});

test('actual MIDI path waits for final note-off and cannot pass a merged repeated top note',()=>{
 for(const mode of ['correct','held-top','extra-in-rest']){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id),take=events(mode);a.setTestLesson(l);a.state.attemptMode='challenge';
  for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1&&mode==='correct')assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct'){assert.equal(a.state.completed,true);assert.equal(clock.now,1000+11*beat);assert.equal(l.rhythm.trailingRestBeats,undefined);}a.resetLessonState();
 }
});

test('instruction migration is guarded and preserves personalized editions and progress under the unchanged music contract',()=>{
 const l=copy(frozen);assert.equal(P.reviewBrokenChords([l],adapter(app)),1);const after=copy(l);assert.equal(P.reviewBrokenChords([l],adapter(app)),0);assert.deepEqual(copy(l),after);
 for(const edit of [l=>l.description='Мой текст',l=>l.guide.motion='Моё движение',l=>l.learning.practiceSteps[0]='Мой разбор',l=>l.rhythm.steps[0].durationBeats=1,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'mine'}]){const custom=copy(frozen);edit(custom);const before=copy(custom);assert.equal(P.reviewBrokenChords([custom],adapter(app)),0);assert.deepEqual(custom,before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(frozen),mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.cleanTakes,2);assert.equal(progress.memory,true);
});

test('materials and catalog roundtrip retain clear count, project origin, qualified history and independent transfer task',()=>{
 const l=app.lessons.find(l=>l.id===id),html=D.materialHtml(l,'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/раз-и, два-и, три-и, четыре-и/);assert.match(html,/конечная тишина не оценивается/);assert.match(html,/не текущая фраза зачёта/);assert.match(html,/не является независимым тестом слуха/);assert.match(html,/не факсимиле/);assert.match(html,/с\. 20–21/);
 assert.equal(l.learning.provenance.author,'Упражнение проекта');assert.ok(l.learning.sourceEvidenceIds.includes('czerny-letter3-release-2026-11-05'));
 const a=loadApp(),snapshot=a.catalogSnapshot();snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(copy(snapshot));const restored=a.lessons.find(l=>l.id===id);assert.equal(restored.learning.practiceSteps[0],'Моя подготовка');assert.deepEqual(copy(restored.learning.contentReview.previousInstruction),{description:frozen.description,guide:frozen.guide,learning:frozen.learning});assert.equal(a.installReviewedLessons(),false);assert.equal(A.pianoSignature(restored),'c1cf2e24');
});

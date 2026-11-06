'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js');
const originals=require('./fixtures/piano-ode-phrases-v1.json'),source=require('../docs/sources/mutopia-528-ode-source.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),prepId='detail-p-dotted-quarter-01';
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide,parsePattern:a.parsePattern,midis:a.stepMidiList,spacesBefore:a.lessonSpacesBefore});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:l.rhythm.practiceBpm,targetBpm:l.rhythm.practiceBpm,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/input.bpm,out=[];
 for(const [i,s]of input.steps.entries())for(const midi of s.midis){
  if(mode==='missing-repeat'&&i===input.steps.length-1)continue;
  let on=1000+s.startBeat*beat,off=on+s.durationBeats*beat;
  if(i===input.steps.length-1){if(mode==='early')off-=.45*beat;if(mode==='late')off+=.45*beat;}
  out.push({type:'on',midi,source:'midi',at:on},{type:'off',midi,at:off});
 }
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('Ode phrases match independently read soprano bars, transpose G to C and retain all explicit piano fingers',()=>{
 const digits=new Map([[60,1],[62,2],[64,3],[65,4],[67,5]]);
 for(const [i,ref]of source.phrases.entries()){
  const l=app.lessons.find(l=>l.id===ref.lessonId),expected=ref.sourceMidi.map(m=>m-7);
  assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),expected.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec),originals[i].fingeringSpec);assert.deepEqual(copy(l.fingeringSpec.steps),expected.map(m=>[{hand:'right',num:digits.get(m)}]));
  assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),ref.quarterDurations);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,1,2,3,4,5,6,7,8,9,10,11,12,13.5,14]);assert.ok(l.rhythm.steps.every(s=>s.restBeforeBeats===0));assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.practiceBpm,64);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.provenance.type,'study-or-adaptation');assert.deepEqual(copy(l.learning.provenance.score.bars),ref.bars);assert.equal(l.learning.provenance.score.transpositionSemitones,-7);assert.equal(l.learning.provenance.score.sourceQuarterBpm,100);assert.match(l.learning.provenance.sourceNote,/Public Domain|Source: Various/);assert.deepEqual(copy(l.learning.contentReview.previousRhythm),originals[i].rhythm);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,A.pianoSignature(originals[i]));
  app.state.lesson=l;assert.equal(app.challengeEligible(),true);
 }
});

test('a distinct dotted-quarter preparation precedes the phrases and does not require a specific piece',()=>{
 const l=app.lessons.find(l=>l.id===prepId);assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),[[64],[62],[62],[64],[62],[62]]);assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),[3,2,2,3,2,2]);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand==='right'));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>[s.startBeat,s.durationBeats]),[[0,1.5],[1.5,.5],[2,2],[4,1.5],[5.5,.5],[6,2]]);assert.equal(l.rhythm.practiceBpm,48);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.deepEqual(copy(l.learning.requires),['course04-06','course04-02','course02-02']);assert.equal(l.learning.nextLessonId,'course04-08');assert.equal(app.lessons.find(l=>l.id==='course09-01').learning.after,prepId);assert.equal(app.lessons.find(l=>l.id==='course09-02').learning.after,'course09-01');
 assert.ok(l.learning.references.some(x=>x.endsWith('content-section-3.5')));assert.match(l.learning.practiceSteps.join(' '),/E4–F4–F4/);assert.match(l.learning.practiceSteps.join(' '),/конкретной пьесы.*не требуется/);
});

test('old phrase rhythm and permissive long-note releases are reproduced and rejected after revision',()=>{
 for(const [i,ref]of source.phrases.entries()){
  const old=score(originals[i]),fresh=score(app.lessons.find(l=>l.id===ref.lessonId));assert.equal(A.assessPiano({...old,events:events(old)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(old)}).clean,false);
  for(const mode of ['early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true);assert.equal(A.assessPiano({...old,timingPrecision:'beat-boundary-v1',events:events(old,mode)}).clean,false);assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false);}
  assert.equal(A.assessPiano({...fresh,events:events(fresh)}).clean,true);assert.equal(A.assessPiano({...fresh,events:events(fresh,'missing-repeat')}).clean,false);
 }
});

test('actual MIDI requires dotted timing, fresh repeated attacks and the last full half note',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});
 for(const id of [prepId,'course09-01','course09-02'])for(const mode of ['correct','early','late','missing-repeat','flat']){
  const l=a.lessons.find(l=>l.id===id),input=score(l),take=events(mode==='flat'?{...input,steps:input.steps.map((s,i)=>({...s,...(id===prepId?(i%3===0?{durationBeats:1}:i%3===1?{startBeat:s.startBeat-.5,durationBeats:1}:{}):(i===12?{durationBeats:1}:i===13?{startBeat:13,durationBeats:1}:{}))}))}:input,mode);
  a.setTestLesson(l);a.state.attemptMode='challenge';for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1&&mode==='correct')assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',id+' '+mode);if(mode==='correct'){assert.equal(a.state.completed,true);const end=id===prepId?8:16;assert.ok(Math.abs(clock.now-(1000+end*60000/input.bpm))<1e-6);}a.resetLessonState();
 }
});

test('guarded phrase migration, private edits and versioned history survive JSON roundtrips',()=>{
 const ls=copy(originals);assert.equal(P.reviewOdePhrases(ls,adapter(app)),2);const after=copy(ls);assert.equal(P.reviewOdePhrases(ls,adapter(app)),0);assert.deepEqual(copy(ls),after);
 for(const old of originals)for(const edit of [l=>l.title='Моя фраза',l=>l.description='Мой текст',l=>l.guide.motion='Моё движение',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[12].durationBeats=2,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const l=copy(old);edit(l);const before=copy(l);assert.equal(P.reviewOdePhrases([l],adapter(app)),0);assert.deepEqual(copy(l),before);}
 for(const [i,ref]of source.phrases.entries()){const l=app.lessons.find(l=>l.id===ref.lessonId),old=A.pianoSignature(originals[i]);let p=A.record(undefined,{instrument:'piano',lessonId:l.id,fingerprint:old,mode:'memory',clean:true,now:1000});p=A.record(p,{instrument:'piano',lessonId:l.id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(p.memory,false);assert.equal(p.history['1:'+old].memory,true);}
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===prepId).learning.practiceSteps[0]='Моя подготовка';snapshot.lessons.find(l=>l.id==='course09-02').description='Моя редакция';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===prepId).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.lessons.find(l=>l.id==='course09-02').description,'Моя редакция');assert.equal(a.installReviewedLessons(),false);
});

test('dotted-quarter target guidance respects the beat unit and disappears completely in memory',()=>{
 const a=loadApp();for(const id of [prepId,'course09-01','course09-02']){a.state.lesson=a.lessons.find(l=>l.id===id);a.state.stepIndex=id===prepId?0:12;assert.match(a.currentNoteHtml(),/dotted-quarter-hint/);assert.match(a.currentNoteHtml(),/полторы доли, как три равные восьмые/);a.state.stepIndex++;assert.doesNotMatch(a.currentNoteHtml(),/dotted-quarter-hint/);a.state.stepIndex--;a.state.attemptMode='memory';a.state.learningMaterialMode='expanded';assert.doesNotMatch(a.currentNoteHtml(),/dotted-quarter-hint|1\.5|полторы|E4|D4|C4/);assert.equal(a.learningMaterialHtml(),'');a.state.attemptMode='practice';}
 for(const denominator of [2,8,16,undefined])assert.equal(UI.dottedQuarterHtml(1.5,denominator),'');for(const duration of [undefined,NaN,Infinity,.5,1,2])assert.equal(UI.dottedQuarterHtml(duration,4),'');
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const original=require('./fixtures/piano-chordmove-cadence-v1.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),id='detail-p-chordmove-04';
const notes=[[60,64,67],[65,69,72],[67,71,74],[60,64,67]],adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:56,targetBpm:56,profile:'standard',timingPrecision:l.learning.timingPrecision});
function events(duration=2,mode='correct',spread=360){const beat=60000/56,out=[];for(let i=0;i<4;i++)for(const[j,midi]of notes[i].entries()){
 let on=1000+i*3*beat,off=1000+(i*3+duration)*beat;
 if(i===3){if(mode==='early')off-=beat*.45;if(mode==='late')off+=beat*.45;if(mode==='split')off+=(j-1)*spread/2;if(mode==='rolled')on+=j*100;}
 if(mode==='missing'&&i===2&&j===1)continue;
 out.push({type:'on',midi,source:'midi',at:on},{type:'off',midi,at:off});
 }if(mode==='extra-in-rest')out.push({type:'on',midi:62,source:'midi',at:1000+2.25*beat},{type:'off',midi:62,at:1000+2.5*beat});return out.sort((a,b)=>a.at-b.at);}

test('cadence is a retained same-goal repetition with independent notes, fingers and a readable 2+1 rhythm',()=>{
 const l=app.lessons.find(l=>l.id===id),primary=app.lessons.find(l=>l.id==='course08-05');
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),notes);assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand==='right'));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(f=>f.num))),notes.map(()=>[1,3,5]));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>[s.startBeat,s.durationBeats,s.restBeforeBeats,s.measure,s.beatInMeasure]),[[0,2,0,1,0],[3,2,1,2,0],[6,2,1,3,0],[9,2,1,4,0]]);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:3,denominator:4});assert.equal(l.rhythm.practiceBpm,56);assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.sameGoalAs,primary.id);assert.equal(l.learning.after,primary.id);assert.deepEqual(copy(l.learning.requires),[primary.id]);assert.equal(l.learning.nextLessonId,'course08-06');assert.deepEqual(copy(l.rhythm.steps.map(s=>s.durationBeats)),copy(primary.rhythm.steps.map(s=>s.durationBeats)));assert.equal(l.learning.provenance.type,'project-technical-drill');assert.match(l.learning.practiceSteps.join(' '),/не новая цель|не отдельный новый урок/);
 assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'1c8c4ed0');assert.notEqual(A.pianoSignature(l),'1c8c4ed0');app.state.lesson=l;assert.equal(app.challengeEligible(),true);
});

test('cadence reproduces the old duration and release gaps, then rejects them with the actual scoped contract',()=>{
 const old=score(original),fresh=score(app.lessons.find(l=>l.id===id));
 for(const mode of ['early','late','split']){const take=events(1.7,mode);assert.equal(A.assessPiano({...old,events:take}).clean,true);assert.equal(A.assessPiano({...old,timingPrecision:'beat-boundary-v2',events:take}).clean,false);assert.equal(A.assessPiano({...fresh,events:events(2,mode)}).clean,false);}
 assert.equal(A.assessPiano({...fresh,events:events()}).clean,true);
 for(const spread of [119,121,360]){const take=events(2,'split',spread),result=A.assessPiano({...fresh,events:take});assert.equal(A.assessPiano({...fresh,timingPrecision:'beat-boundary-v1',events:take}).clean,true);assert.equal(result.clean,spread<=120);assert.equal(result.releaseErrors,spread<=120?0:1);assert.equal(result.durationErrors,0);}
 for(const mode of ['rolled','missing','extra-in-rest'])assert.equal(A.assessPiano({...fresh,events:events(2,mode)}).clean,false,mode);
});

test('actual cadence MIDI path requires the final release and observes internal rests without claiming a trailing rest',()=>{
 const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id);
 for(const mode of ['correct','early','late','split','rolled','extra-in-rest']){a.setTestLesson(l);a.state.attemptMode='challenge';const take=events(2,mode);
  for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.completed,true);assert.equal(a.state.passed,mode==='correct',mode);if(mode==='correct'){assert.ok(Math.abs(clock.now-(1000+11*60000/56))<1e-6);assert.equal(l.rhythm.trailingRestBeats,undefined);}a.resetLessonState();
 }
});

test('cadence migration preserves edited variants, JSON metadata and previous-version memory results',()=>{
 const l=copy(original);assert.equal(P.reviewChordMoveCadence([l],adapter(app)),1);const reviewed=copy(l);assert.equal(P.reviewChordMoveCadence([l],adapter(app)),0);assert.deepEqual(copy(l),reviewed);
 for(const edit of [l=>l.title='Моя фраза',l=>l.description='Мой текст',l=>l.guide.motion='Моё движение',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[0].durationBeats=3,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const edited=copy(original);edit(edited);const before=copy(edited);assert.equal(P.reviewChordMoveCadence([edited],adapter(app)),0);assert.deepEqual(edited,before);}
 let p=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:'1c8c4ed0',mode:'memory',clean:true,now:1000});p=A.record(p,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(p.memory,false);assert.equal(p.cleanTakes,1);assert.equal(p.history['1:1c8c4ed0'].memory,true);
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Мой разбор';a.applyCatalogSnapshot(snapshot);const restored=a.lessons.find(l=>l.id===id);assert.equal(restored.learning.sameGoalAs,'course08-05');assert.equal(restored.learning.practiceSteps[0],'Мой разбор');assert.equal(a.installReviewedLessons(),false);
});

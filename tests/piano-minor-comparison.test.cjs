'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
const originals=require('./fixtures/piano-minor-comparison-v1.json'),copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp();
const refs=[{id:'detail-p-minor-triads-03',root:60,hand:'right',fingers:[1,3,5],old:'9d5f4adf'},{id:'detail-p-minor-triads-04',root:48,hand:'left',fingers:[5,3,1],old:'654b4224'}];
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide,parsePattern:a.parsePattern,midis:a.stepMidiList,spacesBefore:a.lessonSpacesBefore});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:52,targetBpm:52,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(root,mode='correct',spread=360){const beat=60000/52,out=[];for(let i=0;i<4;i++)for(const [j,midi]of [root,root+(i%2?3:4),root+7].entries()){
 if(mode==='held-outer'&&j!==1&&i>0)continue;
 let on=1000+i*3*beat,off=1000+(i*3+2)*beat;
 if(mode==='held-outer'&&j!==1&&i===0)off=1000+11*beat;
 if(i===3){if(mode==='early')off-=beat/2;if(mode==='late')off+=beat/2;if(mode==='split')off+=(j-1)*spread/2;if(mode==='rolled')on+=j*100;}
 out.push({type:'on',midi,source:'midi',at:on},{type:'off',midi,at:off});
 }if(mode==='extra-in-rest')out.push({type:'on',midi:root+1,source:'midi',at:1000+2.25*beat},{type:'off',midi:root+1,at:1000+2.5*beat});return out.sort((a,b)=>a.at-b.at);}

test('C/C minor preserves independent pitches, digits and absolute timing with explicit triple meter and E-flat spelling',()=>{
 for(const [i,r]of refs.entries()){const l=app.lessons.find(l=>l.id===r.id),old=originals[i];assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),Array.from({length:4},(_,j)=>[r.root,r.root+(j%2?3:4),r.root+7]));assert.deepEqual(copy(l.fingeringSpec),old.fingeringSpec);assert.deepEqual(copy(l.fingeringSpec.steps[0].map(f=>f.num)),r.fingers);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand===r.hand));
  assert.deepEqual(Array.from(l.rhythm.steps,s=>[s.startBeat,s.durationBeats,s.restBeforeBeats]),[[0,2,0],[3,2,1],[6,2,1],[9,2,1]]);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:3,denominator:4});assert.deepEqual(Array.from(l.rhythm.steps,s=>s.measure),[1,2,3,4]);assert.ok(l.rhythm.steps.every(s=>s.beatInMeasure===0));assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.contentReview.previousAssessmentFingerprint,r.old);assert.deepEqual(copy(l.learning.contentReview.previousRhythm),old.rhythm);
  app.state.lesson=l;app.state.stepIndex=1;assert.match(app.currentNoteHtml(),r.hand==='right'?/D#4/:/D#3/);assert.match(l.learning.practiceSteps[0],r.hand==='right'?/E♭4 и D#4/:/E♭3 и D#3/);
 }
});

test('isolated old-contract reproduction rejects early, late and split endings after the scoped upgrade',()=>{
 for(const [i,r]of refs.entries()){const old=score(originals[i]),fresh=score(app.lessons.find(l=>l.id===r.id));assert.equal(A.assessPiano({...fresh,events:events(r.root)}).clean,true);for(const mode of ['early','late','split']){const take=events(r.root,mode);assert.equal(A.assessPiano({...old,events:take}).clean,true);assert.equal(A.assessPiano({...old,timingPrecision:'beat-boundary-v2',events:take}).clean,false);assert.equal(A.assessPiano({...fresh,events:take}).clean,false);}
  for(const spread of [119,121,360]){const take=events(r.root,'split',spread),result=A.assessPiano({...fresh,events:take});assert.equal(A.assessPiano({...fresh,timingPrecision:'beat-boundary-v1',events:take}).clean,true);assert.equal(result.clean,spread<=120);assert.equal(result.releaseErrors,spread<=120?0:1);}
  for(const mode of ['held-outer','extra-in-rest','rolled'])assert.equal(A.assessPiano({...fresh,events:events(r.root,mode)}).clean,false,mode);
 }
});

test('actual MIDI checks common release, quiet rests and new outer-note attacks in both hands',()=>{
 for(const r of refs)for(const mode of ['correct','early','split','held-outer','extra-in-rest']){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===r.id),take=events(r.root,mode);a.setTestLesson(l);a.state.attemptMode='challenge';
  for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1&&mode==='correct')assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',r.id+' '+mode);if(mode==='correct'){assert.equal(a.state.completed,true);assert.equal(clock.now,1000+11*60000/52);assert.equal(l.rhythm.trailingRestBeats,undefined);}a.resetLessonState();
 }
});

test('guarded comparison migration and JSON preserve private editions and keep old passes in their history',()=>{
 const ls=copy(originals);assert.equal(P.reviewMinorComparison(ls,adapter(app)),2);const after=copy(ls);assert.equal(P.reviewMinorComparison(ls,adapter(app)),0);assert.deepEqual(copy(ls),after);
 for(const old of originals)for(const edit of [l=>l.title='Мой урок',l=>l.description='Мой текст',l=>l.guide.motion='Моё движение',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[0].durationBeats=3,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const l=copy(old);edit(l);const before=copy(l);assert.equal(P.reviewMinorComparison([l],adapter(app)),0);assert.deepEqual(l,before);}
 for(const r of refs){const l=app.lessons.find(l=>l.id===r.id);let p=A.record(undefined,{instrument:'piano',lessonId:r.id,fingerprint:r.old,mode:'memory',clean:true,now:1000});p=A.record(p,{instrument:'piano',lessonId:r.id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(p.memory,false);assert.equal(p.history['1:'+r.old].memory,true);}
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===refs[1].id).learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===refs[1].id).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.installReviewedLessons(),false);
});

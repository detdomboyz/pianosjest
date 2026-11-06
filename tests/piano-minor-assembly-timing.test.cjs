'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
// Authored originals captured before this migration; never regenerate from revised lessons.
const originals=require('./fixtures/piano-minor-assembly-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),starts=[0,2,4,8,10,12,14,18],oldStarts=[0,2,4,7,9,11,13,16],beat=60000/52;
const refs=[{id:'detail-p-minor-triads-01',root:69,hand:'right',digits:[1,3,5],old:'a1ff3b4a'},{id:'detail-p-minor-triads-02',root:57,hand:'left',digits:[5,3,1],old:'92e48f05'}];
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide,parsePattern:a.parsePattern,midis:a.stepMidiList,spacesBefore:a.lessonSpacesBefore});
const notes=root=>[[root],[root+3],[root+7],[root,root+3,root+7],[root+7],[root+3],[root],[root,root+3,root+7]];
function score(l){return {steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:52,targetBpm:52,profile:'legato',timingPrecision:l.learning.timingPrecision};}
function events(root,mode='correct',onsets=starts,spread=360){
 const out=[];notes(root).forEach((midis,i)=>midis.forEach((midi,j)=>{
  if(mode==='held-upper'&&i===3&&j===2)return;
  let on=1000+onsets[i]*beat,off=1000+(onsets[i]+2)*beat;
  if(mode==='held-upper'&&i===2)off=1000+(onsets[3]+2)*beat;
  if(i===7){if(mode==='early')off-=beat/2;if(mode==='late')off+=beat/2;if(mode==='split')off+=(j-1)*spread/2;if(mode==='rolled')on+=j*100;}
  if(mode==='legato-gap'&&i===0)off-=.3*beat;
  out.push({type:'on',midi,source:'midi',at:on},{type:'off',midi,at:off});
 }));
 if(mode==='extra-in-rest')out.push({type:'on',midi:root+1,source:'midi',at:1000+6.5*beat},{type:'off',midi:root+1,at:1000+7*beat});
 return out.sort((a,b)=>a.at-b.at);
}

test('A minor keeps independent pitches and fingers in both hands and fits five complete 4/4 bars',()=>{
 for(const [i,r]of refs.entries()){const l=app.lessons.find(l=>l.id===r.id),old=originals[i];
  assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),notes(r.root));assert.deepEqual(copy(l.fingeringSpec),old.fingeringSpec);assert.equal(l.handMode,r.hand);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand===r.hand));
  assert.deepEqual(copy(l.fingeringSpec.steps[3].map(f=>f.num)),r.digits);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===2&&s.beatInMeasure+2<=4));assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});
  assert.deepEqual(Array.from(l.rhythm.steps,s=>s.restBeforeBeats),[0,0,0,2,0,0,0,2]);assert.equal(l.rhythm.practiceBpm,52);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,20);assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.articulation,'legato');
  assert.deepEqual(copy(l.learning.contentReview.previousRhythm),old.rhythm);assert.equal(l.learning.contentReview.previousAssessmentFingerprint,r.old);assert.notEqual(A.pianoSignature(l),r.old);
 }
});

test('old early/late and split chord endings are reproduced independently of the new rhythm and then rejected by v2',()=>{
 for(const [i,r]of refs.entries()){
  const old=score(originals[i]),fresh=score(app.lessons.find(l=>l.id===r.id));assert.equal(A.assessPiano({...fresh,events:events(r.root)}).clean,true);
  for(const mode of ['early','late','split']){const take=events(r.root,mode,oldStarts);assert.equal(A.assessPiano({...old,events:take}).clean,true,r.id+' legacy '+mode);assert.equal(A.assessPiano({...old,timingPrecision:'beat-boundary-v2',events:take}).clean,false,r.id+' isolated v2 '+mode);assert.equal(A.assessPiano({...fresh,events:events(r.root,mode)}).clean,false);}
  for(const spread of [119,121,360]){const take=events(r.root,'split',starts,spread);assert.equal(A.assessPiano({...fresh,timingPrecision:'beat-boundary-v1',events:take}).clean,true);const result=A.assessPiano({...fresh,events:take});assert.equal(result.clean,spread<=120);assert.equal(result.releaseErrors,spread<=120?0:1);assert.equal(result.durationErrors,0);}
  for(const mode of ['held-upper','extra-in-rest','legato-gap','rolled'])assert.equal(A.assessPiano({...fresh,events:events(r.root,mode)}).clean,false,mode);
  assert.equal(A.assessPiano({...fresh,events:events(r.root,'correct',oldStarts)}).clean,false,'previous rhythm is a different edition');
 }
});

test('actual MIDI requires final release of every chord voice and cannot pass held upper notes or wrong endings',()=>{
 for(const r of refs)for(const mode of ['correct','early','late','split','held-upper','extra-in-rest']){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===r.id),take=events(r.root,mode);a.setTestLesson(l);a.state.attemptMode='challenge';
  for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1&&mode==='correct')assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',r.id+' '+mode);if(mode==='correct'){assert.equal(a.state.completed,true);assert.equal(clock.now,1000+20*beat);assert.equal(l.rhythm.trailingRestBeats,undefined);}a.resetLessonState();
 }
});

test('revision guards preserve personal notes, timing, fingers, descriptions, classification and older progress',()=>{
 const fresh=copy(originals);assert.equal(P.reviewMinorAssembly(fresh,adapter(app)),2);const after=copy(fresh);assert.equal(P.reviewMinorAssembly(fresh,adapter(app)),0);assert.deepEqual(copy(fresh),after);
 for(const old of originals)for(const edit of [l=>l.title='Мой урок',l=>l.description='Мой текст',l=>l.guide.motion='Моё движение',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[0].durationBeats=3,l=>l.rhythm.timeSignature.numerator=5,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'mine'}]){const l=copy(old);edit(l);const before=copy(l);assert.equal(P.reviewMinorAssembly([l],adapter(app)),0);assert.deepEqual(l,before);}
 for(const r of refs){const fingerprint=A.pianoSignature(app.lessons.find(l=>l.id===r.id));let progress=A.record(undefined,{instrument:'piano',lessonId:r.id,fingerprint:r.old,mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:r.id,fingerprint,mode:'challenge',clean:true,now:2000});assert.equal(progress.cleanTakes,1);assert.equal(progress.memory,false);assert.equal(progress.history['1:'+r.old].memory,true);}
});

test('left preparation uses left studies, half-note counting and linked skills without requiring the specific right A minor',()=>{
 const right=app.lessons.find(l=>l.id===refs[0].id),left=app.lessons.find(l=>l.id===refs[1].id);
 assert.deepEqual(copy(right.learning.requires),['detail-p-triads-04','detail-p-relocate-03','course04-02','detail-p-position-skips-02']);assert.deepEqual(copy(left.learning.requires),['course08-02','detail-p-left-position-triad-02','detail-p-position-skips-05']);assert.ok(!left.learning.requires.includes(right.id));assert.equal(left.learning.after,'course08-02');
 const leftPair=app.lessons.find(l=>l.id==='detail-p-position-skips-05'),rightPair=app.lessons.find(l=>l.id==='detail-p-position-skips-02');assert.deepEqual(Array.from(new Set(leftPair.fingeringSpec.steps.flat().map(f=>f.num))).sort(),[1,3]);assert.deepEqual(Array.from(new Set(rightPair.fingeringSpec.steps.flat().map(f=>f.num))).sort(),[3,5]);
 for(const id of left.learning.requires){const l=app.lessons.find(l=>l.id===id);assert.ok(l,id);assert.notEqual(l.handMode,'right');}
 for(const l of [right,left]){const html=D.materialHtml(l,'piano',String);assert.match(html,/пять полных тактов 4\/4/);assert.match(html,/20 долей/);assert.match(html,/для нового зачёта нужен повтор/i);assert.match(html,/конечная тишина не оценивается/);assert.match(html,/не фраза текущего MIDI-зачёта/);assert.match(html,/не является независимым слуховым тестом/);assert.match(html,/не утверждены этими авторами/);}
});

test('JSON roundtrip preserves the revised music and original-edition history without replacing personalized guidance',()=>{
 const a=loadApp(),snapshot=a.catalogSnapshot();for(const r of refs)snapshot.lessons.find(l=>l.id===r.id).learning.practiceSteps[0]='Моя подготовка '+r.id;
 a.applyCatalogSnapshot(copy(snapshot));for(const [i,r]of refs.entries()){const l=a.lessons.find(l=>l.id===r.id);assert.equal(l.learning.practiceSteps[0],'Моя подготовка '+r.id);assert.deepEqual(copy(l.learning.contentReview.previousRhythm),originals[i].rhythm);assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),starts);}assert.equal(a.installReviewedLessons(),false);
});

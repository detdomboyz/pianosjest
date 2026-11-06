'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js');
const original=require('./fixtures/piano-twinkle-v1.json'),source=require('../docs/sources/mozart-k265-theme-source.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),mainId='course09-03',prepId='detail-p-position-return-01',adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide});
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:l.rhythm.practiceBpm,targetBpm:l.rhythm.practiceBpm,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/input.bpm,out=[];for(const [i,s]of input.steps.entries())for(const midi of s.midis){
  if(mode==='missing-repeat'&&i===3)continue;
  let at=1000+s.startBeat*beat,off=1000+(s.startBeat+s.durationBeats)*beat;
  if(mode==='missing-pause'&&i===1){at-=beat;off-=beat;}
  if(i===input.steps.length-1){if(mode==='early')off-=.27*beat;if(mode==='late')off+=.27*beat;}
  out.push({type:'on',midi,source:'midi',at},{type:'off',midi,at:off});
 }return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('Twinkle is an explicitly simplified adaptation of the independently read 1878 theme, not its literal note text',()=>{
 const l=app.lessons.find(l=>l.id===mainId),bars=source.sourceBars;
 assert.deepEqual(bars[3],{bar:4,midi:[79,79],quarterDurations:[1,1]});assert.deepEqual(bars[6],{bar:7,midi:[74,74,76],quarterDurations:[1,.75,.25]});assert.deepEqual(bars[7],{bar:8,midi:[72],quarterDurations:[2]});
 const adapted=bars.flatMap(b=>b.bar===4?[{midi:b.midi[0]-12,duration:2}]:b.bar===7?[{midi:b.midi[0]-12,duration:1},{midi:b.midi[1]-12,duration:1}]:b.midi.map((m,i)=>({midi:m-12,duration:b.quarterDurations[i]})));
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),adapted.map(n=>[n.midi]));assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),adapted.map(n=>n.duration));assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);
 assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:2,denominator:4});assert.equal(l.rhythm.practiceBpm,60);assert.ok(l.rhythm.steps.every(s=>!s.restBeforeBeats));assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,16);
 assert.deepEqual(copy(l.learning.provenance.score.bars),[1,8]);assert.equal(l.learning.provenance.type,'study-or-adaptation');assert.equal(l.learning.provenance.score.transpositionSemitones,-12);assert.match(l.learning.provenance.sourceNote,/не указанием Моцарта/);assert.match(l.learning.practiceSteps.join(' '),/такте 7 убран короткий E/);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source.sourceFile.path)).digest('hex'),source.sourceFile.sha256);
});

test('the new preparation explicitly alternates C–G and D–A after release, with two measured rests and no terminal rest',()=>{
 const l=app.lessons.find(l=>l.id===prepId);
 assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),[[60],[67],[69],[67],[65]]);assert.deepEqual(copy(l.fingeringSpec.steps.flat()),[1,4,5,4,4].map(num=>({hand:'right',num})));
 assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,2,3,4,6]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),[1,1,1,1,2]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.restBeforeBeats),[0,1,0,0,1]);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,8);
 assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.match(l.learning.provenance.context,/от переноса 1→1/);assert.match(l.guide.motion,/после последнего G4|После последнего G4/);assert.equal(l.learning.practiceSteps.length,3);
 assert.equal(original.learning.requires,undefined);assert.match(original.guide.motion,/верни ладонь/); // Return guidance existed; explicit preparation did not.
 const ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=ctx.MUSIC_CURRICULUM_PLAN.piano,prep=route.find(r=>r.id===prepId),main=route.find(r=>r.id===mainId);
 assert.deepEqual(copy(prep.preparation),['detail-p-relocate-01','detail-p-legato-pairs-02','course04-02']);assert.deepEqual(copy(main.preparation),[prepId,'course02-02','course05-06']);assert.ok(route.findIndex(r=>r.id===prepId)<route.findIndex(r=>r.id===mainId));assert.ok(prep.challenge&&main.challenge);
 assert.equal(l.learning.nextLessonId,mainId);assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.requires.some(id=>id.startsWith('course09')),false);
});

test('legacy permissive final releases are reproduced, while both revised contracts require their full endings',()=>{
 const old=score(original),main=score(app.lessons.find(l=>l.id===mainId)),prep=score(app.lessons.find(l=>l.id===prepId));
 for(const mode of ['early','late']){assert.equal(A.assessPiano({...old,events:events(old,mode)}).clean,true);assert.equal(A.assessPiano({...main,events:events(main,mode)}).clean,false);assert.equal(A.assessPiano({...prep,events:events(prep,mode)}).clean,false);}
 for(const input of [main,prep]){assert.equal(A.assessPiano({...input,events:events(input)}).clean,true);assert.equal(A.assessPiano({...input,events:events(input,'missing-repeat')}).clean,false);}
 assert.equal(A.assessPiano({...prep,events:events(prep,'missing-pause')}).clean,false);
});

test('actual MIDI requires each repeated attack, both preparation rests and the final release',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});
 for(const id of [prepId,mainId])for(const mode of ['correct','early','late','missing-repeat',...(id===prepId?['missing-pause']:[])]){
  const l=a.lessons.find(l=>l.id===id),input=score(l),take=events(input,mode);a.setTestLesson(l);a.state.attemptMode='memory';
  for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,mode==='correct',id+' '+mode);if(mode==='correct')assert.ok(Math.abs(clock.now-(1000+(id===prepId?8:16)*60000/input.bpm))<1e-6);a.resetLessonState();
 }
});

test('guarded Twinkle migration preserves personal editions, old timing and previous-version progress',()=>{
 const l=copy(original);assert.equal(P.reviewTwinkle([l],adapter(app)),1);const after=copy(l);assert.equal(P.reviewTwinkle([l],adapter(app)),0);assert.deepEqual(copy(l),after);
 assert.equal(l.learning.contentReview.previousAssessmentFingerprint,'129f9be4');assert.deepEqual(copy(l.learning.contentReview.previousRhythm),original.rhythm);assert.deepEqual(copy(l.learning.contentReview.previousInstruction.guide),original.guide);assert.deepEqual(copy(l.steps),original.steps);
 for(const edit of [l=>l.title='Моя фраза',l=>l.description='Мой разбор',l=>l.guide.motion='Моя позиция',l=>l.learning.requires=['personal'],l=>l.rhythm.steps[6].durationBeats=1,l=>l.fingeringSpec.steps[2][0].num=5,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewTwinkle([x],adapter(app)),0);assert.deepEqual(copy(x),before);}
 let progress=A.record(undefined,{instrument:'piano',lessonId:mainId,fingerprint:'129f9be4',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:mainId,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,false);assert.equal(progress.history['1:129f9be4'].memory,true);
 const a=loadApp(),snapshot=copy(a.catalogSnapshot()),user=snapshot.lessons.find(l=>l.id===prepId);user.learning.positionCues[0].text='Мой ориентир';user.learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===prepId).learning.positionCues[0].text,'Мой ориентир');assert.equal(a.lessons.find(l=>l.id===prepId).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.installReviewedLessons(),false);
});

test('explicit position cues are escaped, shown only at the edited action and absent from memory or hidden-finger targets',()=>{
 assert.equal(UI.positionChangeHtml(null,2),'');assert.equal(UI.positionChangeHtml([{stepIndex:2,text:'<img src=x onerror="bad()">'}],-1),'');assert.equal(UI.positionChangeHtml([{stepIndex:2,text:'G4'}],3),'');assert.equal(UI.positionChangeHtml([null,{stepIndex:2,text:23}],2),'');
 const html=UI.positionChangeHtml([{stepIndex:2,text:'<img src=x onerror="bad()">'}],2);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 const a=loadApp({events:true}),l=a.lessons.find(l=>l.id===mainId);a.setTestLesson(l);a.state.showFingers=true;a.state.attemptMode='practice';a.state.stepIndex=2;assert.match(a.currentNoteHtml(),/position-change-hint/);assert.match(a.currentNoteHtml(),/D4–A4/);a.state.stepIndex=3;assert.doesNotMatch(a.currentNoteHtml(),/position-change-hint/);
 a.state.stepIndex=7;assert.match(a.currentNoteHtml(),/C4–G4/);a.state.showFingers=false;assert.doesNotMatch(a.currentNoteHtml(),/position-change-hint/);a.state.showFingers=true;
 for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/position-change-hint|C4|G4|F4|D4–A4/);}
 assert.equal(A.pianoSignature(l),A.pianoSignature({...l,learning:{...l.learning,positionCues:[{stepIndex:2,text:'Другое объяснение'}]}})); // presentation is not a new musical edition.
});

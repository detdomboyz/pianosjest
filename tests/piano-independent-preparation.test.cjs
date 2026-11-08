'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),Coverage=require('../tools/piano-skill-coverage.cjs'),originals=require('./fixtures/piano-left-prerequisites-v1.json');
const app=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),ids=originals.map(l=>l.id),triadId='detail-p-triads-02',adapter={normalizeGuide:app.normalizeLessonGuide};
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:56,targetBpm:56,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/56,out=[];for(const[i,s]of input.steps.entries())for(const[j,midi]of s.midis.entries()){
  if(mode==='missing-voice'&&i===3&&j===1&&s.midis.length===3)continue;
  let start=s.startBeat,end=start+s.durationBeats;
  if(mode==='split'&&i===3&&j===0&&s.midis.length===3)end+=.18;
  if(mode==='staggered'&&i===3&&j===2&&s.midis.length===3)start+=.45;
  if(i===input.steps.length-1){if(mode==='early')end-=.3;if(mode==='late')end+=.3;}
  out.push({type:'on',midi,source:'midi',at:1000+start*beat},{type:'off',midi,at:1000+end*beat});
 }return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('four preparation reviews retain every original note, finger, event and tempo',()=>{
 for(const original of originals){const l=app.lessons.find(l=>l.id===original.id);for(const key of ['steps','fingeringSpec','rhythm'])assert.deepEqual(copy(l[key]),original[key],l.id+' / '+key);assert.equal(l.bpm,original.bpm);assert.equal(l.learning.articulation,original.learning.articulation);assert.equal(l.learning.after,original.learning.after);assert.equal(l.learning.preparationReview.previousAssessmentFingerprint,A.pianoSignature(original));if(l.id!==triadId)assert.equal(A.pianoSignature(l),A.pianoSignature(original));}
 const l=app.lessons.find(l=>l.id===triadId);assert.equal(l.learning.coverageDomain,'triads');assert.ok(Coverage.build().domains.find(d=>d.id==='triads').lessonIds.includes(triadId));assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(A.pianoSignature(l),'d0fdd9a4');assert.deepEqual(Array.from(l.steps,s=>Array.from(app.stepMidiList(s))),[[48],[52],[55],[48,52,55]]);assert.deepEqual(copy(l.fingeringSpec.steps).map(g=>g.map(n=>[n.hand,n.num])),[[['left',5]],[['left',3]],[['left',1]],[['left',5],['left',3],['left',1]]]);
});

test('left preparation follows the active hand while display anchors and compiled order stay intact',()=>{
 const expected={
  'detail-p-release-02':['course01-02'],
  'detail-p-release-03':['detail-p-release-01'],
  'detail-p-release-04':['detail-p-release-02'],
  'detail-p-triads-02':['course03-08','detail-p-release-04']
 },ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano),order=route.map(l=>l.id),byId=new Map(app.lessons.map(l=>[l.id,l]));
 for(const id of ids){const l=byId.get(id),r=route.find(l=>l.id===id);assert.deepEqual(copy(l.learning.requires),expected[id]);assert.deepEqual(copy(r.preparation),expected[id]);for(const prep of expected[id])assert.ok(order.indexOf(prep)<order.indexOf(id));assert.equal(r.challenge,true);}
 const ancestors=(id,visited=new Set())=>{assert.ok(!visited.has(id),'Preparation cycle at '+id);const next=new Set(visited);next.add(id);return Array.from(byId.get(id).learning.requires||[]).flatMap(p=>[p,...ancestors(p,next)]);};
 assert.deepEqual(ancestors('detail-p-release-04'),['detail-p-release-02','course01-02']);assert.deepEqual([...new Set(ancestors(triadId))],['course03-08','course03-07','course03-06','course03-05','course03-04','course03-03','detail-p-left-upper-position-01','course03-02','course03-01','course01-04','course01-02','detail-p-release-04','detail-p-release-02']);for(const prepId of ancestors(triadId))assert.ok(byId.get(prepId).fingeringSpec.steps.every(g=>g.every(n=>n.hand==='left')),prepId);assert.equal(byId.get('detail-p-release-02').learning.nextLessonId,'detail-p-release-04');assert.equal(byId.get('detail-p-release-04').learning.nextLessonId,'course03-01');
});

test('triad common-end contract rejects the reproduced split without changing raw timing',()=>{
 const old=score(originals.find(l=>l.id===triadId)),fresh=score(app.lessons.find(l=>l.id===triadId));for(const input of [old,fresh])assert.equal(A.assessPiano({...input,events:events(input)}).clean,true);
 assert.equal(A.assessPiano({...old,events:events(old,'split')}).clean,true);const split=A.assessPiano({...fresh,events:events(fresh,'split')});assert.equal(split.clean,false);assert.equal(split.durationErrors,0);assert.equal(split.releaseErrors,1);
 for(const mode of ['missing-voice','staggered','early','late'])assert.equal(A.assessPiano({...fresh,events:events(fresh,mode)}).clean,false,mode);
});

test('actual MIDI controller waits for every final release in all four studies',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});for(const id of ids){const l=a.lessons.find(l=>l.id===id),modes=id===triadId?['correct','split','early','late']:['correct','early','late'];for(const mode of modes){a.setTestLesson(l);a.state.attemptMode='memory';const take=events(score(l),mode);for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,mode==='correct',id+' / '+mode);a.resetLessonState();}}
});

test('preparation migration is guarded and idempotent with earlier reviews archived intact',()=>{
 for(const original of originals){const l=copy(original);assert.equal(P.reviewIndependentPreparation([l],adapter),1);const reviewed=copy(l);assert.equal(P.reviewIndependentPreparation([l],adapter),0);assert.deepEqual(copy(l),reviewed);assert.deepEqual(copy(l.learning.preparationReview.previousInstruction.learning),original.learning);assert.deepEqual(copy(l.learning.preparationReview.previousRhythm),original.rhythm);if(original.learning.contentReview)assert.deepEqual(copy(l.learning.contentReview),original.learning.contentReview);
  for(const edit of [x=>x.title='Моя версия',x=>x.description='Моя цель',x=>x.guide.motion='Моё движение',x=>x.learning.requires=['mine'],x=>x.rhythm.steps[0].durationBeats=.5,x=>x.fingeringSpec.steps[0][0].num=2,x=>x.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewIndependentPreparation([x],adapter),0);assert.deepEqual(copy(x),before);}
 }
});

test('only the changed triad assessment contract requires new memory credit',()=>{
 for(const old of originals){const l=app.lessons.find(l=>l.id===old.id),oldFp=A.pianoSignature(old);let progress=A.record(undefined,{instrument:'piano',lessonId:l.id,fingerprint:oldFp,mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:l.id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,l.id!==triadId);if(l.id===triadId)assert.equal(progress.history['1:'+oldFp].memory,true);}
});

test('catalog JSON preserves preparation history and personal edits across registration',()=>{
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());for(const id of ids){const l=snapshot.lessons.find(l=>l.id===id);l.learning.practiceSteps[0]='Моя подготовка '+id;l.description='Мой текст '+id;}a.applyCatalogSnapshot(snapshot);assert.equal(a.installReviewedLessons(),false);for(const id of ids){const l=a.lessons.find(l=>l.id===id);assert.equal(l.description,'Мой текст '+id);assert.equal(l.learning.practiceSteps[0],'Моя подготовка '+id);assert.ok(l.learning.preparationReview.previousInstruction);assert.deepEqual(copy(l.learning.requires),copy(app.lessons.find(l=>l.id===id).learning.requires));}
});

test('actual lesson cards name the corrected preparation, explain the common end and remove memory hints',()=>{
 const a=loadApp({events:true});for(const id of ids){const l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();for(const prep of l.learning.requires)assert.ok(html.includes('data-learning-prerequisite="'+prep+'"'));if(id===triadId){assert.match(html,/0,85|3,85/);assert.match(html,/G3–E3–C3/);a.state.stepIndex=3;a.state.showFingers=true;assert.match(a.currentNoteHtml(),/chord-release-hint/);}
  a.state.attemptMode='memory';assert.doesNotMatch(a.learningMaterialHtml(),/data-learning-prerequisite|Подготовка|C3|C4|E3|G3|practiceSteps/);assert.doesNotMatch(a.currentNoteHtml(),/chord-release-hint|C3|C4|D3|D4|E3|G3/);
 }
});

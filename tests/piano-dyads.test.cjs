'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),D=require('../lesson-development.js'),A=require('../practice-assessment.js');
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x)),app=loadApp(),ids=['detail-p-dyads-01','detail-p-dyads-02','detail-p-dyads-03','detail-p-dyads-04'];
const expected=[
 {notes:[60,64],fingers:[1,3],hand:'right',old:'e6811dd5',requires:['course02-08','detail-p-release-01']},
 {notes:[62,65],fingers:[2,4],hand:'right',old:'5211bd5d',requires:['detail-p-dyads-01','course02-08']},
 {notes:[48,52],fingers:[5,3],hand:'left',old:'eb7b9aba',requires:['course03-08','detail-p-release-02']},
 {notes:[50,53],fingers:[4,2],hand:'left',old:'2cbdd76a',requires:['detail-p-dyads-03','course03-08']}
];
const originals=[];
D.registerPiano(originals,[],{makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide},D.piano.filter(s=>ids.includes(s.id)));
const adapter={normalizeGuide:app.normalizeLessonGuide};
function score(l){return {steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:56,targetBpm:56,timingPrecision:l.learning.timingPrecision};}
function events(input,kind='correct',spread=300){const beat=60000/input.bpm;return input.steps.flatMap((s,i)=>s.midis.flatMap((midi,j)=>[
 {type:'on',midi,source:'midi',at:1000+s.startBeat*beat+(kind==='rolled'&&i===3&&j===1?121:0)},
 {type:'off',midi,at:1000+(s.startBeat+s.durationBeats)*beat+(i===3?(kind==='split'?(j?1:-1)*spread/2:kind==='early'?-.5*beat:kind==='late'?.5*beat:0):0)}
 ])).filter(e=>kind!=='missing'||e.midi!==input.steps[0].midis[1]).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));}

test('four dyads preserve independent pitches, hand-specific fingers, raw timing and original display anchors',()=>{
 assert.equal(originals.length,4);
 for(const[i,id]of ids.entries()){const l=app.lessons.find(l=>l.id===id),old=originals.find(l=>l.id===id),e=expected[i];
  for(const key of ['pattern','rhythm','fingeringSpec','handMode','bpm','title'])assert.deepEqual(copy(l[key]),copy(old[key]),id+' / '+key);
  assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),Array.from({length:4},()=>e.notes));
  assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(n=>n.num))),Array.from({length:4},()=>e.fingers));assert.ok(l.fingeringSpec.steps.every(s=>s.every(n=>n.hand===e.hand)));
  assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,1,2,3]);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===.85));assert.equal(l.rhythm.bpm,56);
  assert.equal(e.notes[1]-e.notes[0],i%2?3:4);assert.equal(A.pianoSignature(old),e.old);assert.notEqual(A.pianoSignature(l),e.old);assert.equal(l.learning.after,old.learning.after);assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.ending,undefined);app.state.lesson=l;assert.equal(app.challengeEligible(),true);
 }
});

test('compiled dyad prerequisites prepare the active hand independently of the other hand',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano),order=route.map(l=>l.id),byId=new Map(app.lessons.map(l=>[l.id,l]));
 function ancestors(id,path=new Set()){assert.ok(!path.has(id),'Cycle at '+id);const next=new Set(path);next.add(id);return Array.from(byId.get(id).learning.requires||[]).flatMap(p=>[p,...ancestors(p,next)]);}
 for(const[i,id]of ids.entries()){const l=byId.get(id),entry=route.find(l=>l.id===id);assert.deepEqual(copy(l.learning.requires),expected[i].requires);assert.deepEqual(copy(entry.preparation),expected[i].requires);for(const prep of ancestors(id)){assert.ok(order.indexOf(prep)<order.indexOf(id));assert.ok(byId.get(prep).fingeringSpec.steps.every(s=>s.every(n=>n.hand===expected[i].hand)),id+' / '+prep);}assert.ok(byId.has(l.learning.nextLessonId));}
 assert.equal(byId.get(ids[2]).learning.requires.includes(ids[1]),false);
});

test('dyad grading rejects split release, rolled entry, incomplete pairs and changed holds in both hands',()=>{
 for(const id of ids){const input=score(app.lessons.find(l=>l.id===id));assert.equal(A.assessPiano({...input,events:events(input)}).clean,true);
  for(const spread of [119,121,300]){const take=events(input,'split',spread),r=A.assessPiano({...input,events:take});assert.equal(A.assessPiano({...input,timingPrecision:undefined,events:take}).clean,true);assert.equal(r.clean,spread<=120);assert.equal(r.releaseErrors,spread<=120?0:1);assert.equal(r.durationErrors,0);}
  for(const kind of ['rolled','missing','early','late'])assert.equal(A.assessPiano({...input,events:events(input,kind)}).clean,false,id+' / '+kind);
 }
});

test('actual MIDI event route waits for both final note-offs and applies the dyad contract',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});
 for(const id of ids)for(const kind of ['correct','split','rolled','early','late']){const l=a.lessons.find(l=>l.id===id),take=events(score(l),kind);a.setTestLesson(l);a.state.attemptMode='challenge';
  for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.completed,true,id+' / '+kind);assert.equal(a.state.passed,kind==='correct',id+' / '+kind);assert.equal(a.state.assessment.timingPrecision,'beat-boundary-v2');if(kind==='split')assert.equal(a.state.assessment.releaseErrors,1);a.resetLessonState();
 }
});

test('exact-source dyad migrations archive original instructions and leave personal editions untouched',()=>{
 for(const old of originals){const l=copy(old);assert.equal(P.reviewDyads([l],adapter),1);const after=copy(l);assert.equal(P.reviewDyads([l],adapter),0);assert.deepEqual(copy(l),after);assert.deepEqual(copy(l.learning.contentReview.previousInstruction),copy({description:old.description,guide:old.guide,learning:old.learning}));assert.equal(l.learning.contentReview.previousAssessmentFingerprint,A.pianoSignature(old));
  for(const edit of [x=>x.title='Мой вариант',x=>x.description='Мой текст',x=>x.guide.motion='Моё движение',x=>x.learning.goal='Моя цель',x=>x.learning.requires=['mine'],x=>x.learning.after='mine',x=>x.learning.references=['https://example.com/my-source'],x=>x.rhythm.steps[0].durationBeats=.5,x=>x.fingeringSpec.steps[0][0].num=x.fingeringSpec.steps[0][0].num===2?1:2,x=>x.contentKind='piece',x=>x.learning.contentReview={id:'mine'}]){const x=copy(old);edit(x);const before=copy(x);assert.equal(P.reviewDyads([x],adapter),0);assert.deepEqual(copy(x),before);}
 }
});

test('first new dyad take archives old memory credit without inheriting it or changing other records',async()=>{
 for(const[i,id]of ids.entries()){const prior=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:expected[i].old,mode:'memory',clean:true,now:1000}),other={lessonId:'mine',memory:true},stored=new Map([['music-learning-piano-v1',JSON.stringify({[id]:prior,mine:other})]]),clock={now:1000},locks={request:async(name,options,work)=>work({name})},a=loadApp({events:true,clock,locks,storage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)}});a.loadLearningProgress();const l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='challenge';for(const e of events(score(l))){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}assert.equal(a.state.passed,true);await a.legacyProgressStore.settled();const p=JSON.parse(stored.get('music-learning-piano-v1'));assert.equal(p[id].cleanTakes,1);assert.equal(p[id].memory,false);assert.equal(p[id].fingerprint,A.pianoSignature(l));assert.equal(p[id].history['1:'+expected[i].old].memory,true);assert.deepEqual(p.mine,other);a.resetLessonState();}
});

test('dyad catalogue transfer keeps personal guidance, classifications, ordering and review archives',()=>{
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());for(const[i,id]of ids.entries()){const l=snapshot.lessons.find(l=>l.id===id);l.learning.practiceSteps[0]='Моя подготовка '+id;l.order=900+ids.length-i;if(i===3)l.contentKind='piece';}const exported=JSON.parse(JSON.stringify(snapshot));assert.equal(a.applyCatalogSnapshot(exported),true);assert.equal(a.installReviewedLessons(),false);
 assert.deepEqual(Array.from(a.lessons.filter(l=>ids.includes(l.id)).sort((a,b)=>a.order-b.order),l=>l.id),ids.slice().reverse());
 for(const[i,id]of ids.entries()){const l=a.lessons.find(l=>l.id===id);assert.equal(l.learning.practiceSteps[0],'Моя подготовка '+id);assert.equal(l.contentKind,i===3?'piece':'exercise');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.ok(l.learning.contentReview.previousInstruction);assert.equal(A.pianoSignature(l),A.pianoSignature(app.lessons.find(l=>l.id===id)));}
});

test('dyad materials and existing release cue explain independent transfer and disappear from memory',()=>{
 const a=loadApp({events:true});for(const[i,id]of ids.entries()){const l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.learningMaterialMode='expanded';a.state.attemptMode='practice';a.state.showFingers=true;const html=a.learningMaterialHtml(),target=a.currentNoteHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/0,85 доли/);assert.match(html,/0,15/);assert.match(html,/3,85/);assert.match(html,/56 BPM/);assert.match(html,/3–5 минут/);assert.match(html,/на «раз» и «три»/);assert.match(html,/не текущий MIDI-зачёт и не новый урок/);assert.match(html,/после перерыва/);assert.match(html,/следующий день/);assert.match(html,/не независимый тест слуха|не доказывает независимое распознавание/);assert.match(html,/Kovarsky/);assert.equal(l.learning.sourceEvidenceIds.length,5);assert.match(target,/chord-release-hint/);for(const midi of expected[i].notes)assert.ok(target.includes(app.KEY_MAP&&({48:'C3',50:'D3',52:'E3',53:'F3',60:'C4',62:'D4',64:'E4',65:'F4'})[midi]));
  for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/chord-release-hint|Созвучие целиком|C3|E3|D3|F3|C4|E4|D4|F4|Аппликатура|Ритм:/);}
 }
});

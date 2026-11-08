'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const originals=require('./fixtures/piano-first-two-fingers-v1.json').lessons,published=require('./fixtures/piano-before-first-two-fingers-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[
 {id:'course01-03',notes:[60,62,60,62,60,62,60,62],digits:[1,2,1,2,1,2,1,2],hand:'right',starts:[0,1,2,3,4,5,6,7],grade:'688220a6',fingerprint:'a29fab60',requires:['course01-01'],stage:'p1',next:'detail-p-release-01'},
 {id:'course01-04',notes:[48,50,48,50,48,50,48,50],digits:[5,4,5,4,5,4,5,4],hand:'left',starts:[0,1,2,3,4,5,6,7],grade:'356420d6',fingerprint:'e72ce411',requires:['course01-02'],stage:'p1',next:'detail-p-release-02'},
 {id:'course03-01',notes:[48,50,48,50,50,48,50,48],digits:[5,4,5,4,4,5,4,5],hand:'left',starts:[0,1,2,3,5,6,7,8],grade:'0035c9a1',fingerprint:'c0d500a5',requires:['course01-04','detail-p-release-04'],stage:'p2',next:'course03-02'}
];
const score=e=>e.notes.map((m,i)=>({midis:[m],startBeat:e.starts[i],durationBeats:1}));
const events=e=>e.notes.flatMap((m,i)=>[{type:'on',midi:m,at:1000+e.starts[i]*60000/56,source:'midi',step:i},{type:'off',midi:m,at:1000+(e.starts[i]+1)*60000/56-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('independent two-finger scores preserve notes, handedness, fingers and whole-beat silence at 56 BPM',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id),old=originals.find(l=>l.id===e.id);
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(g=>g[0].num)),e.digits);assert.ok(l.fingeringSpec.steps.every(g=>g.length===1&&g[0].hand===e.hand));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),e.starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.rhythm.practiceBpm,56);assert.deepEqual(copy(l.rhythm),old.rhythm);assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),e.grade);
 }
});
test('all 572 published editions keep music, grade keys, IDs, classification and physical catalog order',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(crypto.createHash('sha256').update(JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old))).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);assert.equal(l.contentKind,old.contentKind);}
});
test('three exact-match reviews archive the old instructions and are idempotent',()=>{
 assert.equal(typeof P.reviewFirstTwoFingers,'function');const lessons=copy(originals);assert.equal(P.reviewFirstTwoFingers(lessons,adapter),3);
 for(const e of cases){const l=lessons.find(l=>l.id===e.id),old=originals.find(l=>l.id===e.id),r=l.learning.contentReview;assert.equal(r.id,'first-two-finger-patterns-v1');assert.equal(r.sourceFingerprint,e.fingerprint);assert.equal(r.previousAssessmentFingerprint,e.grade);assert.deepEqual(r.previousInstruction,{description:old.description,guide:old.guide,learning:old.learning});}
 assert.equal(P.reviewFirstTwoFingers(lessons,adapter),0);
});
test('personal notes, timing, fingers, guides, classification, exams and review history are preserved',()=>{
 assert.equal(typeof P.reviewFirstTwoFingers,'function');
 for(const old of originals)for(const edit of [l=>l.title+=' моё',l=>l.description='Мой разбор',l=>l.guide.motion='Моя кисть',l=>l.learning.goal='Моя цель',l=>l.learning.requires=['private'],l=>l.learning.articulation='legato',l=>l.rhythm.steps[0].durationBeats=.5,l=>l.rhythm.practiceBpm=42,l=>l.fingeringSpec.steps[0][0].num=3,l=>l.contentKind='piece',l=>l.exam=true,l=>l.learning.contentReview={id:'private'}]){const l=copy(old);edit(l);const before=copy(l);assert.equal(P.reviewFirstTwoFingers([l],adapter),0);assert.deepEqual(l,before);}
});
test('first pairs require only their own hand while the later left phrase requires prepared release',()=>{
 const ids=require('../tools/build-curriculum-plan.cjs').build().piano.map(l=>l.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.deepEqual(copy(l.learning.requires),e.requires);assert.equal(l.learning.stage,e.stage);assert.equal(l.learning.nextLessonId,e.next);assert.ok(e.requires.every(id=>ids.indexOf(id)>=0&&ids.indexOf(id)<ids.indexOf(e.id)));assert.ok(ids.indexOf(e.next)>ids.indexOf(e.id));assert.equal(l.learning.coverageDomain,'fingers');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.ok(l.learning.practiceSteps.some(x=>/3–5 минут/.test(x)));assert.ok(l.learning.practiceSteps.some(x=>/на следующий день/.test(x)));}
});
test('the later left task names its distinct silent repeat and shifted entry rather than claiming a new speed variant',()=>{
 const plain=app.lessons.find(l=>l.id==='course01-04'),paused=app.lessons.find(l=>l.id==='course03-01');
 assert.match(plain.learning.rhythmNotice,/без.*пауз/);assert.match(paused.learning.rhythmNotice,/4–5/);assert.match(paused.learning.goal,/D3.*повтор/);assert.ok(paused.learning.practiceSteps.some(x=>/«два».*второго такта/.test(x)));assert.match(paused.learning.provenance.purpose,/повтор.*паузы/);
});
test('real assessor rejects missing silence and one held D replacing two attacks',()=>{
 for(const e of cases){assert.equal(A.assessPiano({steps:score(e),events:events(e),bpm:56,targetBpm:56,profile:'standard'}).clean,true);}
 const e=cases[2],options={steps:score(e),bpm:56,targetBpm:56,profile:'standard'},noRest=events(e).map(x=>x.step>=4?{...x,at:x.at-60000/56}:x);assert.equal(A.assessPiano({...options,events:noRest}).clean,false);
 const held=events(e).filter(x=>!(x.step===3&&x.type==='off')&&!(x.step===4&&x.type==='on'));assert.equal(A.assessPiano({...options,events:held}).clean,false);
});
test('actual cards retain separate goals and no instructional DOM in any memory setting',()=>{
 const a=loadApp();for(const e of cases){a.state.lesson=a.lessons.find(l=>l.id===e.id);a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.ok(e.requires.every(id=>html.includes(id)));assert.match(html,/MIDI.*пальц/);
  for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');}
 }
});
test('private catalog roundtrip and old progress keys survive the instructional upgrade',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const [i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Моя редакция '+e.id;l.order=970-i;if(i===2)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);assert.equal(JSON.stringify(a.state.learningProgress),raw);
 for(const e of cases){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Моя редакция '+e.id);assert.equal(A.pianoSignature(l),e.grade);assert.ok(l.learning.contentReview?.previousInstruction);}
});

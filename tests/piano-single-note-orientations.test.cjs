'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const originals=require('./fixtures/piano-single-note-orientations-v1.json').lessons,published=require('./fixtures/piano-before-first-two-fingers-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const cases=[{id:'course01-01',midi:60,note:'C4',hand:'right',finger:1,grade:'5df64aea',fingerprint:'7989f596',next:'course01-03'},{id:'course01-02',midi:48,note:'C3',hand:'left',finger:5,grade:'73d2378a',fingerprint:'6411d9df',next:'course01-04'}];
const starts=[0,1,2,3,5,6,7,8],score=e=>starts.map(startBeat=>({midis:[e.midi],startBeat,durationBeats:1}));
const events=e=>starts.flatMap((s,i)=>[{type:'on',midi:e.midi,at:1000+s*60000/54,source:'midi',step:i},{type:'off',midi:e.midi,at:1000+(s+1)*60000/54-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('independent single-note scores retain register, handedness, eight quarters and the full silent beat',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id),old=originals.find(l=>l.id===e.id);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),starts.map(()=>[e.midi]));assert.deepEqual(copy(l.fingeringSpec.steps),starts.map(()=>[{hand:e.hand,num:e.finger}]));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.rhythm.practiceBpm,54);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.deepEqual(copy(l.rhythm),old.rhythm);assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),e.grade);}
});
test('both starting cards explain silence at 4-5 and the next attack on beat two without a mandatory previous lesson',()=>{
 const route=require('../tools/build-curriculum-plan.cjs').build().piano.map(l=>l.id);
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.match(l.learning.rhythmNotice,/4–5/);assert.match(l.learning.rhythmNotice,/54 BPM/);assert.ok(l.learning.practiceSteps.some(s=>/«два» второго такта/.test(s)));assert.deepEqual(copy(l.learning.requires),[]);assert.equal(l.learning.stage,'p1');assert.equal(l.learning.coverageDomain,'orientation');assert.equal(l.learning.nextLessonId,e.next);assert.ok(route.indexOf(e.id)>=0&&route.indexOf(e.id)<route.indexOf(e.next));assert.match(l.learning.goal,new RegExp(e.note));assert.equal(l.learning.provenance.type,'project-technical-drill');}
});
test('the exact published instructions are archived and each root-card migration is idempotent',()=>{
 assert.equal(typeof P.reviewSingleNoteOrientations,'function');const lessons=copy(originals);assert.equal(P.reviewSingleNoteOrientations(lessons,adapter),2);
 for(const e of cases){const l=lessons.find(l=>l.id===e.id),old=originals.find(l=>l.id===e.id),r=l.learning.contentReview;assert.equal(r.id,'single-note-orientations-v1');assert.equal(r.sourceFingerprint,e.fingerprint);assert.equal(r.previousAssessmentFingerprint,e.grade);assert.deepEqual(r.previousInstruction,{description:old.description,guide:old.guide,learning:old.learning});assert.deepEqual(l.lessonReview,old.lessonReview);}
 assert.equal(P.reviewSingleNoteOrientations(lessons,adapter),0);
});
test('private instructions, rhythm, fingers, classification and prior reviews never match the root-card upgrade',()=>{
 assert.equal(typeof P.reviewSingleNoteOrientations,'function');
 for(const old of originals)for(const edit of [l=>l.title+=' моя',l=>l.description='Моя инструкция',l=>l.guide.setup='Моя посадка',l=>l.learning.goal='Моя цель',l=>l.learning.requires=['private'],l=>l.learning.articulation='non-legato',l=>l.rhythm.steps[0].startBeat=.5,l=>l.rhythm.practiceBpm=40,l=>l.fingeringSpec.steps[0][0].num=3,l=>l.contentKind='piece',l=>l.exam=true,l=>l.learning.contentReview={id:'private'}]){const l=copy(old);edit(l);const before=copy(l);assert.equal(P.reviewSingleNoteOrientations([l],adapter),0);assert.deepEqual(l,before);}
});
test('all 572 published musical versions and physical catalog identities survive both root-card reviews',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(crypto.createHash('sha256').update(JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old))).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);assert.equal(l.contentKind,old.contentKind);}
});
test('real MIDI assessor accepts the original scores and rejects missing rest, held repeats and a wrong octave',()=>{
 for(const e of cases){const opts={steps:score(e),bpm:54,targetBpm:54,profile:'standard'};assert.equal(A.assessPiano({...opts,events:events(e)}).clean,true);assert.equal(A.assessPiano({...opts,events:events(e).map(x=>x.step>=4?{...x,at:x.at-60000/54}:x)}).clean,false);assert.equal(A.assessPiano({...opts,events:events(e).filter(x=>!(x.step===3&&x.type==='off')&&!(x.step===4&&x.type==='on'))}).clean,false);assert.equal(A.assessPiano({...opts,events:events(e).map(x=>({...x,midi:x.midi+12}))}).clean,false);}
});
test('actual cards keep a complete beginner explanation and no hint DOM in every memory preference',()=>{
 const a=loadApp();for(const e of cases){a.state.lesson=a.lessons.find(l=>l.id===e.id);a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);assert.match(html,/MIDI.*пальц/);assert.match(html,/4–5/);assert.match(html,/«два»/);assert.ok(a.state.lesson.learning.references.includes('https://www.open.edu/openlearn/history-the-arts/introduction-music-theory-2-pitch-and-notation/content-section-1.1'));
  for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');}
 }
});
test('guided open transfer and delayed repeat are distinct from a new lesson or an unseen aural test',()=>{
 for(const e of cases){const l=app.lessons.find(l=>l.id===e.id);assert.ok(l.learning.practiceSteps.some(s=>/два звука.*долю тишины.*один звук/.test(s)));assert.ok(l.learning.practiceSteps.some(s=>/на следующий день/.test(s)));assert.match(l.learning.provenance.sourceNote,/неизвестн.*слухов/);assert.ok(l.learning.selfCheck.some(s=>/«раз».*тишин/.test(s)));}
});
test('personal v7 roundtrip and existing memory progress keys remain intact',()=>{
 const progress=Object.fromEntries(cases.map(e=>[e.id,A.record(undefined,{instrument:'piano',lessonId:e.id,fingerprint:e.grade,mode:'memory',clean:true,now:1000})])),raw=JSON.stringify(progress),writes=[],a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot());
 for(const [i,e]of cases.entries()){const l=snapshot.lessons.find(l=>l.id===e.id);l.learning.practiceSteps[0]='Мой начальный разбор '+e.id;l.order=980-i;if(i===1)l.contentKind='piece';}
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);assert.equal(JSON.stringify(a.state.learningProgress),raw);
 for(const e of cases){const l=a.lessons.find(l=>l.id===e.id);assert.equal(l.learning.practiceSteps[0],'Мой начальный разбор '+e.id);assert.equal(A.pianoSignature(l),e.grade);assert.ok(l.learning.contentReview?.previousInstruction);}
});

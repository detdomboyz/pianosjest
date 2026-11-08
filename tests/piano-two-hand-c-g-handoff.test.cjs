'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const fixture=require('./fixtures/piano-two-hand-c-g-handoff-v1.json'),original=fixture.lessons[0],published=require('./fixtures/piano-before-first-two-fingers-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const starts=[0,1,2,3,5,6,7,8],notes=[48,60,48,60,55,67,55,67],lesson=()=>app.lessons.find(l=>l.id==='course01-06');
const digits=[['left',5],['right',1],['left',5],['right',1],['left',1],['right',5],['left',1],['right',5]];
const score=notes.map((midi,i)=>({midis:[midi],startBeat:starts[i],durationBeats:1}));
const events=()=>starts.flatMap((s,i)=>[{type:'on',midi:notes[i],at:1000+s*60000/56,source:'midi',step:i},{type:'off',midi:notes[i],at:1000+(s+1)*60000/56-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('the C/G handoff keeps each real register, opposite end fingers and the complete quiet beat',()=>{
 const l=lesson();assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes.map(midi=>[midi]));assert.deepEqual(copy(l.fingeringSpec.steps),digits.map(([hand,num])=>[{hand,num}]));
 assert.deepEqual(copy(l.rhythm),original.rhythm);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.rhythm.practiceBpm,56);assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),'59d644dd');
});
test('both prepared hands precede alternation and the shared pulse continues through the rest',()=>{
 const l=lesson();assert.deepEqual(copy(l.learning.requires),['course01-01','course01-02','course02-08','course03-08']);assert.equal(l.learning.stage,'p4');assert.equal(l.learning.coverageDomain,'coordination');assert.equal(l.learning.nextLessonId,'course01-07');
 const route=require('../tools/build-curriculum-plan.cjs').build(),ids=route.piano.map(x=>x.id);for(const id of l.learning.requires)assert.ok(ids.indexOf(id)<ids.indexOf(l.id));assert.ok(ids.indexOf(l.id)<ids.indexOf('course01-07'));
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(route.guitar)).digest('hex'),fixture.protectedGuitarRouteSha256);
 assert.match(l.learning.rhythmNotice,/4–5/);assert.ok(l.learning.practiceSteps.some(s=>/«два» второго такта/.test(s)));assert.ok(l.learning.practiceSteps.some(s=>/«два» третьего такта.*9/.test(s)));
});
test('only the frozen C/G edition is reviewed once and its full prior explanation survives',()=>{
 assert.equal(typeof P.reviewTwoHandCGHandoff,'function');const list=[copy(original)];assert.equal(P.reviewTwoHandCGHandoff(list,adapter),1);const r=list[0].learning.contentReview;
 assert.equal(r.id,'two-hand-c-g-handoff-v1');assert.equal(r.sourceFingerprint,'cd91581f');assert.equal(r.sourceStepsFingerprint,'94b54ed8');assert.equal(r.previousAssessmentFingerprint,'59d644dd');assert.deepEqual(r.previousInstruction,{description:original.description,guide:original.guide,learning:original.learning});assert.deepEqual(list[0].lessonReview,original.lessonReview);assert.equal(P.reviewTwoHandCGHandoff(list,adapter),0);
});
test('private C/G notes without a pattern change, timing, fingers, instructions and grading settings block the review',()=>{
 for(const edit of [l=>{l.steps[0].keys=['y'];l.steps[0].key='y';},l=>l.pattern+=' t',l=>l.title+=' моя',l=>l.description='Мой обмен',l=>l.guide.setup='Моя посадка',l=>l.learning.goal='Моя цель',l=>l.learning.requires=['private'],l=>l.learning.articulation='non-legato',l=>l.rhythm.practiceBpm=40,l=>l.rhythm.steps[0].startBeat=.5,l=>l.fingeringSpec.steps[0][0].num=4,l=>l.contentKind='piece',l=>l.exam=true,l=>l.timeLimit=45,l=>l.maxErrors=2,l=>l.learning.contentReview={id:'private'}]){
  const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewTwoHandCGHandoff([l],adapter),0);assert.deepEqual(l,before);
 }
});
test('all published musical versions, IDs, theme membership, user order and the immutable baseline remain intact',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(crypto.createHash('sha256').update(JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old))).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}
 assert.equal(crypto.createHash('sha256').update(require('node:fs').readFileSync(require('node:path').join(__dirname,'../lesson-review-baseline.js'))).digest('hex'),fixture.protectedBaselineSha256);
});
test('the actual MIDI assessor rejects wrong G, simultaneous entries, a missing rest and sound held through silence',()=>{
 const opts={steps:score,bpm:56,targetBpm:56,profile:'standard'};assert.equal(A.assessPiano({...opts,events:events()}).clean,true);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.midi===55?{...x,midi:56}:x)}).clean,false);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.step===1&&x.type==='on'?{...x,at:1000}:x)}).clean,false);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.step>=4?{...x,at:x.at-60000/56}:x)}).clean,false);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.step===3&&x.type==='off'?{...x,at:x.at+60000/56}:x)}).clean,false);
});
test('the actual full C/G explanation has no fixed-wrist command and memory contains no material for all preferences',()=>{
 const a=loadApp();a.state.lesson=a.lessons.find(l=>l.id==='course01-06');a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();
 for(const part of ['Техническое упражнение проекта','G3','G4','Коротко найди','3–5 минут','«два» второго такта'])assert.ok(html.includes(part),part);
 assert.doesNotMatch(html,/Сохраняй одинаковую высоту обеих кистей/);assert.match(html,/каждая рука работает из удобного ей положения/);
 for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');}
});
test('open reverse exchange, immediate MIDI and delayed memory have explicit separate limits',()=>{
 const l=lesson(),text=l.learning.practiceSteps.join(' ');assert.match(text,/G4 правой 5 → G3 левой 1 → C4 правой 1 → C3 левой 5/);assert.match(text,/вне MIDI-зачёта/);assert.match(text,/3–5 минут/);assert.match(text,/на следующий день/);assert.match(text,/не новый урок/);assert.match(text,/неизвестный слуховой ответ/);
 assert.ok(l.learning.selfCheck.some(s=>/отдельно от MIDI/.test(s)));assert.equal(l.learning.provenance.type,'project-technical-drill');assert.ok(l.learning.sourceEvidenceIds.includes('pierce-hands-learning-2026-11-05'));
});
test('private catalog instructions, classification, semantic order and the old memory record survive catalog transfer',()=>{
 const progress={'course01-06':A.record(undefined,{instrument:'piano',lessonId:'course01-06',fingerprint:'59d644dd',mode:'memory',clean:true,now:1000})},raw=JSON.stringify(progress),writes=[];
 const a=loadApp({storage:{getItem:key=>key==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot()),l=snapshot.lessons.find(x=>x.id==='course01-06');l.learning.practiceSteps[0]='Моя передача';l.contentKind='piece';l.order=99999;
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);const restored=a.lessons.find(x=>x.id==='course01-06');assert.equal(restored.learning.practiceSteps[0],'Моя передача');assert.equal(restored.contentKind,'piece');assert.equal(a.lessons.filter(x=>x.themeId===restored.themeId).sort((x,y)=>x.order-y.order).at(-1).id,'course01-06');assert.equal(A.pianoSignature(restored),'59d644dd');assert.equal(JSON.stringify(a.state.learningProgress),raw);
});

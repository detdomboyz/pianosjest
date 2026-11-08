'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),P=require('../piano-lesson-development.js');
const original=require('./fixtures/piano-right-c-f-landmarks-v1.json').lessons[0],published=require('./fixtures/piano-before-first-two-fingers-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),adapter={normalizeGuide:app.normalizeLessonGuide};
const starts=[0,1,2,3,5,6,7,8],notes=[60,65,60,65,60,65,60,65],lesson=()=>app.lessons.find(l=>l.id==='course01-05');
const score=notes.map((midi,i)=>({midis:[midi],startBeat:starts[i],durationBeats:1}));
const events=()=>starts.flatMap((s,i)=>[{type:'on',midi:notes[i],at:1000+s*60000/52,source:'midi',step:i},{type:'off',midi:notes[i],at:1000+(s+1)*60000/52-15,source:'midi',step:i}]).sort((a,b)=>a.at-b.at);

test('the C/F project score preserves the actual two landmarks, eight right thumbs, quarters and silent beat',()=>{
 const l=lesson();assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes.map(midi=>[midi]));assert.deepEqual(copy(l.fingeringSpec.steps),notes.map(()=>[{hand:'right',num:1}]));
 assert.deepEqual(copy(l.rhythm),original.rhythm);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.rhythm.practiceBpm,52);assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),'a8570ed5');
});
test('the beginner branch requires its own C4 root and spells out the full rest and cross-bar ending',()=>{
 const l=lesson();assert.deepEqual(copy(l.learning.requires),['course01-01']);assert.equal(l.learning.stage,'p1');assert.equal(l.learning.coverageDomain,'orientation');assert.equal(l.learning.nextLessonId,'detail-p-release-01');
 assert.match(l.learning.rhythmNotice,/4–5/);assert.match(l.learning.rhythmNotice,/52 BPM/);assert.ok(l.learning.practiceSteps.some(s=>/«два» второго такта/.test(s)));assert.ok(l.learning.practiceSteps.some(s=>/«два» третьего такта.*9/.test(s)));
 const path=require('../tools/build-curriculum-plan.cjs').build().piano.map(x=>x.id);assert.ok(path.indexOf('course01-01')<path.indexOf(l.id));
});
test('only the exact published C/F instruction is migrated once and its complete prior edition is retained',()=>{
 assert.equal(typeof P.reviewRightCFLandmarks,'function');const list=[copy(original)];assert.equal(P.reviewRightCFLandmarks(list,adapter),1);
 const r=list[0].learning.contentReview;assert.equal(r.id,'right-c-f-landmarks-v1');assert.equal(r.sourceFingerprint,'22375162');assert.equal(r.sourceStepsFingerprint,'646bf554');assert.equal(r.previousAssessmentFingerprint,'a8570ed5');assert.deepEqual(r.previousInstruction,{description:original.description,guide:original.guide,learning:original.learning});assert.deepEqual(list[0].lessonReview,original.lessonReview);assert.equal(P.reviewRightCFLandmarks(list,adapter),0);
});
test('personal notes without a changed pattern, private instructions, fingers, rhythm and classification block this migration',()=>{
 assert.equal(typeof P.reviewRightCFLandmarks,'function');
 for(const edit of [l=>{l.steps[0].keys=['y'];l.steps[0].key='y';},l=>l.title+=' моя',l=>l.description='Мои ориентиры',l=>l.guide.setup='Мой разбор',l=>l.learning.goal='Моя цель',l=>l.learning.requires=['private'],l=>l.learning.articulation='non-legato',l=>l.rhythm.practiceBpm=40,l=>l.rhythm.steps[0].startBeat=.5,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.exam=true,l=>l.learning.contentReview={id:'private'}]){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewRightCFLandmarks([l],adapter),0);assert.deepEqual(l,before);}
});
test('the landmark correction retains every published musical version and catalog placement',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,published.lessons),published.lessons.map(l=>l.id));
 for(const old of published.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(crypto.createHash('sha256').update(JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old))).digest('hex'),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),expectedGrade(old));assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}
});
test('the actual MIDI assessor accepts C4/F4 and rejects F-sharp, a missing quiet beat, or a held note across it',()=>{
 const opts={steps:score,bpm:52,targetBpm:52,profile:'standard'};
 assert.equal(A.assessPiano({...opts,events:events()}).clean,true);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.midi===65?{...x,midi:66}:x)}).clean,false);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.step>=4?{...x,at:x.at-60000/52}:x)}).clean,false);
 assert.equal(A.assessPiano({...opts,events:events().map(x=>x.step===3&&x.type==='off'?{...x,at:x.at+60000/52}:x)}).clean,false);
});
test('actual instruction views retain the full explanation while all memory preferences have no hint DOM',()=>{
 const a=loadApp();a.state.lesson=a.lessons.find(l=>l.id==='course01-05');a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();
 for(const part of ['Техническое упражнение проекта','C4','F4','3–5 минут','4–5'])assert.ok(html.includes(part),part);
 assert.match(html,/MIDI.*пальц/);assert.ok(a.state.lesson.learning.references.includes('https://www.open.edu/openlearn/history-the-arts/introduction-music-theory-2-pitch-and-notation/content-section-1.1'));
 for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');}
});
test('relocation is prepared slowly in both directions and open transfer is separate from delayed memory and an unseen aural test',()=>{
 const l=lesson();assert.ok(l.learning.practiceSteps.some(s=>/без пульса/.test(s)));assert.ok(l.learning.practiceSteps.some(s=>/F4–C4–F4/.test(s)));assert.ok(l.learning.practiceSteps.some(s=>/на следующий день/.test(s)));
 assert.ok(l.learning.selfCheck.some(s=>/перенос.*рук/.test(s)));assert.match(l.learning.provenance.sourceNote,/неизвестн.*слухов/);assert.equal(l.learning.provenance.type,'project-technical-drill');
});
test('personal catalog transfer and the unchanged memory progress fingerprint survive the C/F review',()=>{
 const progress={'course01-05':A.record(undefined,{instrument:'piano',lessonId:'course01-05',fingerprint:'a8570ed5',mode:'memory',clean:true,now:1000})},raw=JSON.stringify(progress),writes=[];
 const a=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});a.loadLearningProgress();const snapshot=copy(a.catalogSnapshot()),l=snapshot.lessons.find(l=>l.id==='course01-05');l.learning.practiceSteps[0]='Мой поиск C/F';l.order=977;l.contentKind='piece';
 assert.equal(a.applyCatalogSnapshot(snapshot),true);assert.equal(a.installReviewedLessons(),false);assert.equal(writes.length,0);assert.equal(JSON.stringify(a.state.learningProgress),raw);
 const restored=a.lessons.find(candidate=>candidate.id==='course01-05');assert.equal(restored.learning.practiceSteps[0],'Мой поиск C/F');assert.equal(restored.contentKind,'piece');assert.equal(a.lessons.filter(x=>x.themeId===restored.themeId).sort((x,y)=>x.order-y.order).at(-1).id,'course01-05');assert.equal(A.pianoSignature(restored),'a8570ed5');
});

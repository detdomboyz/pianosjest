'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),D=require('../lesson-development.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),id='detail-p-hearing-01',copy=v=>JSON.parse(JSON.stringify(v));
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide};
function original(){const lessons=[];D.registerPiano(lessons,[],adapter,D.piano.filter(s=>s.id===id));return lessons[0];}
const current=()=>app.lessons.find(l=>l.id===id);

test('known-third review preserves the existing pitches, fingers, rhythm and progress version',()=>{
  const l=current(),old=original();assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),[60,64,60,64]);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),[1,3,1,3]);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand==='right'));assert.equal(l.handMode,'right');
  assert.deepEqual(copy(l.rhythm),copy(old.rhythm));assert.equal(l.rhythm.practiceBpm,56);assert.ok(l.rhythm.steps.every((s,i)=>s.startBeat===i&&s.durationBeats===.85));assert.equal(l.learning.articulation,'standard');assert.equal(A.pianoSignature(l),'f4ba5fc5');assert.equal(A.pianoSignature(l),A.pianoSignature(old));assert.deepEqual(copy(l.learning.requires),['course05-03','course02-03','course04-01']);assert.equal(l.learning.coverageDomain,'ear-transfer');assert.equal(l.learning.contentReview.id,'known-third-imagery-v2');assert.equal(l.learning.contentReview.previous.id,'known-third-imagery-v1');app.state.lesson=l;assert.equal(app.challengeEligible(),true);
});

test('known-third MIDI check measures notes and endings and rejects the wrong third or unfinished final sound',()=>{
  const l=current(),beat=60000/56,steps=l.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))}));
  const events=steps.flatMap(s=>[{type:'on',midi:s.midis[0],at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+s.durationBeats)*beat}]);const assess=ev=>A.assessPiano({steps,events:ev,bpm:56,targetBpm:56,profile:'standard'});
  assert.equal(assess(events).clean,true);assert.equal(assess(events.slice(0,-1)).clean,false);assert.equal(assess(events.map(e=>e.midi===64?{...e,midi:63}:e)).clean,false);assert.equal(assess(events.map(e=>e.type==='off'?{...e,at:e.at-.7*beat}:e)).clean,false);
  assert.match(l.guide.mastery,/MIDI не оценивает пение/);assert.match(l.learning.selfCheck.join(' '),/не независимое распознавание на слух/);
});

test('only the frozen original known-third description migrates and personal editions remain intact',()=>{
  const l=original();assert.equal(P.reviewKnownThird([l],adapter),1);const saved=copy(l);assert.equal(P.reviewKnownThird([l],adapter),0);assert.deepEqual(copy(l),saved);
  for(const edit of [l=>l.title='Моя терция',l=>l.learning.goal='Моя задача',l=>l.guide.blind='Моя память',l=>l.rhythm.steps[0].durationBeats=.6,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.pattern='t y t y',l=>l.contentKind='piece',l=>l.learning.contentReview={id:'my-review'}]){const changed=copy(original());edit(changed);const before=copy(changed);assert.equal(P.reviewKnownThird([changed],adapter),0);assert.deepEqual(changed,before);}
});

test('known-third materials explain the auditory aim, exact endings and transfer and survive catalog exchange',()=>{
  const l=current(),html=D.materialHtml(l,'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/звуковой образ/);assert.match(html,/последняя E4 тоже заканчивается через 0,85 доли/);assert.match(html,/не фраза текущего зачёта/);assert.match(html,/E4–C4–D4–E4 пальцами 3–1–2–3/);assert.match(html,/четыре полутона/);assert.match(html,/не независимый тест распознавания/);assert.doesNotMatch(html,/Cliff Smith/);assert.equal(l.learning.nextLessonId,'detail-p-hearing-02');
  const a=loadApp(),snapshot=a.catalogSnapshot(),raw=snapshot.lessons.find(l=>l.id===id);raw.learning.practiceSteps[0]='Моё слуховое представление';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моё слуховое представление');assert.equal(a.lessons.find(l=>l.id===id).learning.contentReview.id,'known-third-imagery-v2');assert.equal(a.installReviewedLessons(),false);
});

test('a guarded preparation upgrade removes the required piece and preserves previous reviews and personal editions',()=>{
  const v1=original();P.reviewKnownThird([v1],adapter);assert.equal(v1.learning.contentReview.reviewedFingerprint,'e49388c7');const music=A.pianoSignature(v1);assert.equal(P.upgradeKnownThirdPreparation([v1]),1);assert.equal(A.pianoSignature(v1),music);assert.equal(v1.learning.after,'detail-p-black-01');assert.equal(v1.learning.contentReview.previous.reviewedFingerprint,'e49388c7');assert.equal(P.upgradeKnownThirdPreparation([v1]),0);
  for(const edit of [l=>l.learning.requires=['my-preparation'],l=>l.guide.motion='Мой разбор',l=>l.learning.practiceSteps[0]='Моя подготовка',l=>l.contentKind='piece',l=>l.learning.contentReview.reviewedFingerprint='changed']){const l=original();P.reviewKnownThird([l],adapter);edit(l);const before=copy(l);assert.equal(P.upgradeKnownThirdPreparation([l]),0);assert.deepEqual(copy(l),before);}
});

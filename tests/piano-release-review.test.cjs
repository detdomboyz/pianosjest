'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),D=require('../lesson-development.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),copy=v=>JSON.parse(JSON.stringify(v));
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide,parsePattern:app.parsePattern,midis:app.stepMidiList,spacesBefore:app.lessonSpacesBefore};
function originals(){const lessons=[],themes=[];D.registerPiano(lessons,themes,adapter,D.piano.filter(s=>s.group==='release'));return lessons;}

test('release instruction review preserves both hands, the sounding score and the MIDI version',()=>{
  const old=originals(),expected=[[[60,60,60,60],[1,1,1,1],'right'],[[48,48,48,48],[5,5,5,5],'left'],[[60,62,60,62,60,62],[1,2,1,2,1,2],'right'],[[48,50,48,50,48,50],[5,4,5,4,5,4],'left']];
  old.forEach((before,i)=>{
    const lesson=app.lessons.find(l=>l.id===before.id),[notes,fingers,hand]=expected[i];
    assert.deepEqual(Array.from(lesson.steps,s=>app.stepMidiList(s)[0]),notes);
    assert.deepEqual(Array.from(lesson.fingeringSpec.steps,s=>s[0].num),fingers);assert.equal(lesson.handMode,hand);
    assert.ok(lesson.fingeringSpec.steps.every(s=>s[0].hand===hand));assert.equal(A.pianoSignature(lesson),A.pianoSignature(before));
    assert.deepEqual(copy(lesson.rhythm),copy(before.rhythm));assert.ok(lesson.rhythm.steps.every((s,j)=>s.startBeat===j&&s.durationBeats===.65));
    const requires=[['course01-01'],['course01-02'],['detail-p-release-01'],['detail-p-release-02']];
    assert.deepEqual(copy(lesson.learning.requires),requires[i]);
    if(lesson.learning.preparationReview)assert.deepEqual(copy(lesson.learning.preparationReview.previousInstruction.learning.requires),before.learning.requires);
    assert.equal(lesson.learning.contentReview.id,i>=2?'early-release-v2':'early-release-v1');
    assert.equal(lesson.learning.provenance.type,'project-technical-drill');assert.equal(lesson.learning.coverageDomain,'fingers');
    assert.ok(app.lessons.some(l=>l.id===lesson.learning.nextLessonId));app.state.lesson=lesson;assert.equal(app.challengeEligible(),true);
  });
});
test('only frozen original instructions are reviewed, once; personal notes, timing, fingering and pieces survive',()=>{
  const lessons=originals();assert.equal(P.reviewEarlyRelease(lessons,adapter),4);const reviewed=copy(lessons);assert.equal(P.reviewEarlyRelease(lessons,adapter),0);assert.deepEqual(copy(lessons),reviewed);
  const edits=[l=>l.title='Мой заголовок',l=>l.description='Мой разбор',l=>l.guide.motion='Моё движение',l=>l.learning.goal='Моя учебная цель',l=>l.learning.practiceSteps.push('Моя заметка'),l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.bpm=40,l=>l.learning.contentReview={id:'my-own-review'}];
  for(const edit of edits){const modified=originals()[0];edit(modified);const saved=copy(modified);assert.equal(P.reviewEarlyRelease([modified],adapter),0);assert.deepEqual(copy(modified),saved);}
});
test('catalogue export and reload retain the review and protect a personal early-lesson explanation',()=>{
  const a=loadApp(),snapshot=a.catalogSnapshot(),id='detail-p-release-03',initial=a.lessons.find(l=>l.id===id),signature=A.pianoSignature(initial);
  const saved=snapshot.lessons.find(l=>l.id===id);saved.learning.practiceSteps[0]='Моя подсказка';saved.guide.motion='Мой вариант объяснения';
  a.applyCatalogSnapshot(snapshot);const restored=a.lessons.find(l=>l.id===id);
  assert.equal(restored.learning.practiceSteps[0],'Моя подсказка');assert.equal(restored.guide.motion,'Мой вариант объяснения');assert.equal(restored.learning.contentReview.id,'early-release-v2');
  assert.equal(A.pianoSignature(restored),signature);assert.equal(a.installReviewedLessons(),false);
});
test('the material explains count, releases, manual transfer, honest history and the next step',()=>{
  for(const lesson of app.lessons.filter(l=>l.id.startsWith('detail-p-release-'))){
    const html=D.materialHtml(lesson,'piano',String);assert.match(html,/Non-legato означает раздельно/);assert.match(html,/раз, два, три, четыре/);assert.match(html,/перенос/);assert.match(html,/не фраза текущего зачёта/);
    assert.match(html,/Diana Dumlavwalla/);assert.match(html,/Карл Черни: письмо 3, с\. 20–21/);assert.match(html,/Ноты, пальцы и ритм придуманы/);assert.match(html,/не независимый тест слуха/);
  }
  const first=app.lessons.find(l=>l.id==='detail-p-release-01');assert.match(first.learning.provenance.history,/с\. 20–21/);assert.doesNotMatch(first.learning.provenance.history,/Лист|Бетховен|учился|утвержд/);
});
test('MIDI examples distinguish the intended non-legato ending from taps and overheld notes',()=>{
  for(const lesson of app.lessons.filter(l=>l.id.startsWith('detail-p-release-'))){
    const bpm=56,beat=60000/bpm,steps=lesson.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(lesson.steps[i]))}));
    const events=steps.flatMap(s=>[{type:'on',midi:s.midis[0],at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+s.durationBeats)*beat}]);
    assert.equal(A.assessPiano({steps,events,bpm,targetBpm:bpm,profile:'nonlegato'}).clean,true);
    for(const duration of [.1,1]){const wrong=events.map((e,i)=>i===events.length-1?{...e,at:1000+(steps.at(-1).startBeat+duration)*beat}:e);assert.equal(A.assessPiano({steps,events:wrong,bpm,targetBpm:bpm,profile:'nonlegato'}).clean,false);}
  }
});

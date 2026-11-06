'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),D=require('../lesson-development.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),copy=v=>JSON.parse(JSON.stringify(v));
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide,parsePattern:app.parsePattern,midis:app.stepMidiList,spacesBefore:app.lessonSpacesBefore};
function originals(){const lessons=[],themes=[];D.registerPiano(lessons,themes,adapter,D.piano.filter(s=>s.group==='legato'));return lessons;}
const actual=()=>app.lessons.filter(l=>/^detail-p-legato-0[1-4]$/.test(l.id));

test('legato review keeps pitches, fingers, timing, preparation and existing musical versions',()=>{
  const expected=[[[60,62,60,62,60,62],[1,2,1,2,1,2],'right'],[[48,50,48,50,48,50],[5,4,5,4,5,4],'left'],[[60,62,64,62,60],[1,2,3,2,1],'right'],[[48,50,52,50,48],[5,4,3,4,5],'left']],old=originals();
  actual().forEach((lesson,i)=>{
    const [notes,digits,hand]=expected[i],before=old.find(l=>l.id===lesson.id);
    assert.deepEqual(Array.from(lesson.steps,s=>app.stepMidiList(s)[0]),notes);assert.deepEqual(Array.from(lesson.fingeringSpec.steps,s=>s[0].num),digits);
    assert.equal(lesson.handMode,hand);assert.ok(lesson.fingeringSpec.steps.every(s=>s[0].hand===hand));assert.equal(lesson.learning.articulation,'legato');
    assert.ok(lesson.rhythm.steps.every((s,j)=>s.startBeat===j&&s.durationBeats===1));assert.deepEqual(copy(lesson.rhythm),copy(before.rhythm));
    assert.equal(A.pianoSignature(lesson),A.pianoSignature(before));assert.deepEqual(copy(lesson.learning.requires),before.learning.requires);
    app.state.lesson=lesson;assert.equal(app.challengeEligible(),true);assert.ok(app.lessons.some(l=>l.id===lesson.learning.nextLessonId));
  });
});
test('both-hand legato examples reject audible gaps and sustained overlap while ordinary duration checks pass',()=>{
  for(const lesson of actual()){
    const bpm=56,beat=60000/bpm,steps=lesson.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(lesson.steps[i]))}));
    function events(offset){return steps.flatMap((s,i)=>[{type:'on',midi:s.midis[0],source:'midi',at:1000+s.startBeat*beat},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+1)*beat+(i===steps.length-1?0:offset)}]).sort((a,b)=>a.at-b.at);}
    for(const offset of [-20,0,20])assert.equal(A.assessPiano({steps,events:events(offset),bpm,targetBpm:bpm,profile:'legato'}).clean,true);
    for(const offset of [-160,160]){
      const input={steps,events:events(offset),bpm,targetBpm:bpm};assert.equal(A.assessPiano(input).clean,true);
      const legato=A.assessPiano({...input,profile:'legato'});assert.equal(legato.clean,false);assert.equal(legato.durationErrors,0);assert.equal(legato.articulationErrors,steps.length-1);
    }
  }
});
test('frozen legato corrections run once and preserve personal instructions, notes and classification',()=>{
  const lessons=originals();assert.equal(P.reviewEarlyLegato(lessons,adapter),4);const saved=copy(lessons);assert.equal(P.reviewEarlyLegato(lessons,adapter),0);assert.deepEqual(copy(lessons),saved);
  const edits=[l=>l.description='Мой разбор',l=>l.learning.goal='Моя цель',l=>l.guide.motion='Моё движение',l=>l.pattern+=' t',l=>l.rhythm.steps[0].durationBeats=.75,l=>l.fingeringSpec.steps[0][0].num=3,l=>l.contentKind='piece'];
  for(const original of originals())for(const edit of edits){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewEarlyLegato([l],adapter),0);assert.deepEqual(l,before);}
});
test('the app exports the reviewed material, source location and manual transfer without erasing personal edits',()=>{
  const a=loadApp(),id='detail-p-legato-03',snapshot=a.catalogSnapshot(),raw=snapshot.lessons.find(l=>l.id===id);raw.learning.practiceSteps[0]='Моя подсказка';a.applyCatalogSnapshot(snapshot);
  assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моя подсказка');assert.equal(a.installReviewedLessons(),false);
  for(const lesson of actual()){
    assert.equal(lesson.learning.contentReview.id,'early-legato-v1');assert.equal(lesson.learning.provenance.type,'project-technical-drill');assert.equal(lesson.learning.coverageDomain,'articulation');
    const html=D.materialHtml(lesson,'piano',String);assert.match(html,/Карл Черни: письмо 2, с\. 17/);assert.match(html,/Legato — связная линия/);assert.match(html,/последнюю тоже удержи одну долю/);assert.match(html,/самостоятельная проба за инструментом/);assert.match(html,/не фраза текущего зачёта/);assert.doesNotMatch(html,/Cliff Smith/);
  }
});

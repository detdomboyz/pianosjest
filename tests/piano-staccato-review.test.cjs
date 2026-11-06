'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),D=require('../lesson-development.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),copy=v=>JSON.parse(JSON.stringify(v));
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide,parsePattern:app.parsePattern,midis:app.stepMidiList,spacesBefore:app.lessonSpacesBefore};
function originals(){const lessons=[];D.registerPiano(lessons,[],adapter,D.piano.filter(s=>s.group==='staccato'));return lessons;}
const actual=()=>app.lessons.filter(l=>/^detail-p-staccato-0[1-4]$/.test(l.id));
test('staccato instruction review preserves both hands, exact notes, timing and musical versions',()=>{
  const old=originals(),expected=[[[60,60,60,60],[1,1,1,1],'right'],[[48,48,48,48],[5,5,5,5],'left'],[[60,62,64,62,60],[1,2,3,2,1],'right'],[[48,50,52,50,48],[5,4,3,4,5],'left']];
  actual().forEach((l,i)=>{const [notes,digits,hand]=expected[i],before=old.find(x=>x.id===l.id);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),notes);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),digits);assert.equal(l.handMode,hand);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand===hand));assert.equal(l.learning.articulation,'staccato');
    assert.deepEqual(copy(l.rhythm),copy(before.rhythm));assert.ok(l.rhythm.steps.every((s,j)=>s.startBeat===j&&s.durationBeats===.3&&(!j||Math.abs(s.restBeforeBeats-.7)<1e-9)));
    assert.equal(A.pianoSignature(l),A.pianoSignature(before));assert.deepEqual(copy(l.learning.requires),copy(before.learning.requires));assert.equal(l.learning.contentReview.id,'early-staccato-v1');app.state.lesson=l;assert.equal(app.challengeEligible(),true);assert.ok(app.lessons.some(x=>x.id===l.learning.nextLessonId));
  });
});
test('the current MIDI evaluator requires a short ending, a full pulse interval and the final release',()=>{
  for(const l of actual()){
    const bpm=56,beat=60000/bpm,steps=l.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))}));
    const events=(spacing=1,hold=.3)=>steps.flatMap((s,i)=>[{type:'on',midi:s.midis[0],at:1000+i*spacing*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(i*spacing+hold)*beat}]);
    const assess=e=>A.assessPiano({steps,events:e,bpm,targetBpm:bpm,profile:l.learning.articulation});assert.equal(assess(events()).clean,true);
    assert.equal(assess(events(1,.8)).clean,false);assert.equal(assess(events(1,.02)).clean,false);assert.ok(assess(events(.7,.3)).onsetErrors>0);
    const late=events();late.at(-1).at=1000+(steps.length-1+.9)*beat;assert.equal(assess(late).clean,false);
  }
});
test('only frozen original staccato descriptions migrate once; personal changes and pieces remain intact',()=>{
  const lessons=originals();assert.equal(P.reviewEarlyStaccato(lessons,adapter),4);const saved=copy(lessons);assert.equal(P.reviewEarlyStaccato(lessons,adapter),0);assert.deepEqual(copy(lessons),saved);
  const edits=[l=>l.title='Мой урок',l=>l.learning.goal='Моя цель',l=>l.guide.motion='Мой разбор',l=>l.rhythm.steps[0].durationBeats=.4,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'my-review'}];
  for(const original of originals())for(const edit of edits){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewEarlyStaccato([l],adapter),0);assert.deepEqual(l,before);}
});
test('saved staccato materials retain provenance, count, manual transfer and the source location',()=>{
  const a=loadApp(),snapshot=a.catalogSnapshot(),id='detail-p-staccato-03',saved=snapshot.lessons.find(l=>l.id===id);saved.learning.practiceSteps[0]='Моя подготовка';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.installReviewedLessons(),false);
  for(const l of actual()){
    const html=D.materialHtml(l,'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/0,3 доли/);assert.match(html,/не универсальная длительность/);assert.match(html,/Последний звук тоже короткий/);assert.match(html,/не фраза текущего зачёта/);assert.match(html,/Карл Черни: письмо 4, с\. 31–33/);assert.match(html,/Коротко не означает обязательно громко/);assert.doesNotMatch(html,/Cliff Smith|Трезвучия|Open Music Theory/);
  }
  assert.match(actual()[0].learning.provenance.history,/горячего железа/);
});

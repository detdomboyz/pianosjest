'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),D=require('../lesson-development.js'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),copy=v=>JSON.parse(JSON.stringify(v)),ids=['detail-p-hearing-02','detail-p-hearing-03','detail-p-hearing-04'];
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide};
function originals(){const lessons=[];D.registerPiano(lessons,[],adapter,D.piano.filter(s=>ids.includes(s.id)));return lessons;}

test('minor third, fourth and fifth keep independent pitches, fingers and old musical versions',()=>{
  const old=originals();for(const [id,notes,digits,signature] of [[ids[0],[60,63,60,63],[1,3,1,3],'6483fc25'],[ids[1],[60,65,60,65],[1,4,1,4],'5d97f2c5'],[ids[2],[60,67,60,67],[1,5,1,5],'4b03cb1d']]){
    const l=app.lessons.find(l=>l.id===id);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),notes);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),digits);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand==='right'));assert.equal(l.handMode,'right');assert.equal(A.pianoSignature(l),signature);assert.equal(A.pianoSignature(l),A.pianoSignature(old.find(l=>l.id===id)));assert.deepEqual(copy(l.rhythm),copy(old.find(l=>l.id===id).rhythm));assert.ok(l.rhythm.steps.every((s,i)=>s.startBeat===i&&s.durationBeats===.85));assert.equal(l.rhythm.practiceBpm,56);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.contentReview.id,'known-interval-imagery-v1');app.state.lesson=l;assert.equal(app.challengeEligible(),true);
  }
});

test('all interval prerequisites precede the lesson and no known-interval branch requires Twinkle',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'),'utf8'),context);const plan=context.MUSIC_CURRICULUM_PLAN.piano,index=id=>plan.findIndex(e=>e.id===id),seen=new Set();
  function dependencies(id){if(seen.has(id))return;seen.add(id);const l=app.lessons.find(l=>l.id===id);for(const req of l?.learning?.requires||[]){assert.notEqual(req,'course09-03');assert.ok(index(req)>=0&&index(req)<index(id),req+' before '+id);dependencies(req);}}
  for(const id of ['detail-p-hearing-01',...ids])dependencies(id);assert.ok(app.lessons.find(l=>l.id===ids[0]).learning.requires.includes('detail-p-black-01'));assert.ok(app.lessons.find(l=>l.id===ids[2]).learning.requires.includes('course05-04'));
});

test('only the untouched original interval instructions migrate; saved personal editions remain intact',()=>{
  const lessons=originals();assert.equal(P.reviewRemainingKnownIntervals(lessons,adapter),3);const saved=copy(lessons);assert.equal(P.reviewRemainingKnownIntervals(lessons,adapter),0);assert.deepEqual(copy(lessons),saved);
  for(const original of originals())for(const edit of [l=>l.title='Мой интервал',l=>l.learning.requires=['my-preparation'],l=>l.guide.setup='Моя посадка',l=>l.rhythm.steps[0].durationBeats=.4,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece',l=>l.learning.contentReview={id:'my-review'}]){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.reviewRemainingKnownIntervals([l],adapter),0);assert.deepEqual(l,before);}
});

test('interval materials name the right final note, separate the aural aim from MIDI, and survive export',()=>{
  for(const [id,last,name,transfer] of [[ids[0],'E♭4','малая терция','E♭4–C4–D4–E♭4'],[ids[1],'F4','чистая кварта','F4–C4–D4–C4'],[ids[2],'G4','чистая квинта','G4–C4–E4–C4']]){const l=app.lessons.find(l=>l.id===id),html=D.materialHtml(l,'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.ok(html.includes(name));assert.ok(html.includes('последнюю '+last+' тоже отпусти через 0,85 доли'));assert.ok(html.includes(transfer));assert.match(html,/автоматического теста слуха здесь нет/);assert.match(html,/не фраза текущего зачёта/);assert.match(html,/Chelsey Hamm и Bryn Hughes/);assert.doesNotMatch(html,/Cliff Smith/);}
  const a=loadApp(),snapshot=a.catalogSnapshot(),count=a.lessons.length;for(const id of ids)snapshot.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка '+id;a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.length,count);for(const id of ids)assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моя подготовка '+id);assert.equal(a.installReviewedLessons(),false);
});

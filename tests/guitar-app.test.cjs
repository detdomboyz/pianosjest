'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {loadGuitarApp}=require('./helpers/load-guitar-app.cjs');
// During a sibling-folder update this can point at the exact staged artifacts.
const root=process.env.GUITAR_TEST_ROOT||path.resolve(__dirname,'../../guitarjest');
const available=fs.existsSync(path.join(root,'practice-assessment.js'));
test('shared unchanged contracts stay identical while piano data can evolve independently',{skip:!available},()=>{
  for(const name of ['curriculum.js','guitar-curriculum-quality.js','catalog-sections.js','catalog-sections.css','lesson-quality.js','lesson-review-baseline.js','lesson-quality-apply.js'])assert.equal(fs.readFileSync(path.join(root,name),'utf8'),fs.readFileSync(path.resolve(__dirname,'..',name),'utf8'),name+' is out of sync');
  const vm=require('node:vm'),readPlan=file=>{const c={};vm.runInNewContext(fs.readFileSync(file,'utf8'),c);return JSON.parse(JSON.stringify(c.MUSIC_CURRICULUM_PLAN));};
  const pianoPlan=readPlan(path.resolve(__dirname,'../curriculum-plan.js')),guitarPlan=readPlan(path.join(root,'curriculum-plan.js'));
  assert.deepEqual(pianoPlan.guitar,guitarPlan.guitar,'piano-only work changed guitar routing or fingerprints');
  const ours=require('../lesson-development.js'),theirs=require(path.join(root,'lesson-development.js'));
  assert.deepEqual(JSON.parse(JSON.stringify(ours.guitar)),JSON.parse(JSON.stringify(theirs.guitar)),'guitar authored exercises changed');
  const {loadGuitarCourse}=require('../tools/curriculum-inventory.cjs'),portable=loadGuitarCourse(root,{correct:false}),native=loadGuitarCourse(root);
  require('../guitar-curriculum-quality.js').correctBuiltins(portable);require('../lesson-quality.js').repairGuitar(portable,require('../lesson-review-baseline.js'));ours.registerGuitar(portable);
  assert.deepEqual(JSON.parse(JSON.stringify(portable)),JSON.parse(JSON.stringify(native)),'shared extension changed actual guitar data');
});

test('piano timing extension preserves real guitar signatures, assessment and progress contracts',{skip:!available},()=>{
  const ours=require('../practice-assessment.js'),theirs=require(path.join(root,'practice-assessment.js')),course=require('../tools/curriculum-inventory.cjs').loadGuitarCourse(root);
  for(const lesson of course.lessons)assert.equal(ours.guitarSignature(lesson),theirs.guitarSignature(lesson),lesson.id);
  const notes=course.lessons.find(l=>l.notes.length>=2&&!l.notes.some(n=>n.group!==undefined)).notes;
  const base={notes,hits:notes.length,errors:0,cents:notes.map(()=>0)};
  for(const change of [{},{manualAttempts:1},{errors:1},{timedOut:true},{hits:0},{cents:[90]},{pitchToleranceCents:20}])assert.deepEqual(ours.assessGuitar({...base,...change}),theirs.assessGuitar({...base,...change}));
  const take={instrument:'guitar',lessonId:course.lessons[0].id,fingerprint:ours.guitarSignature(course.lessons[0]),mode:'challenge',clean:true,now:1000};assert.deepEqual(ours.record(undefined,take),theirs.record(undefined,take));
});
test('actual guitar completion preserves old progress but does not pass manual/error/late attempts',{skip:!available},()=>{
  const app=loadGuitarApp(root),lesson=app.guidedLessons()[0];app.state.selectedLessonId=lesson.id;app.state.progress.passed.old=true;
  for(const changes of [{errors:1},{manualAttempts:lesson.notes.length},{timedOut:true}]){
    Object.assign(app.state.session,{running:true,hits:lesson.notes.length,errors:0,manualAttempts:0,timedOut:false,cents:lesson.notes.map(()=>0),deadline:0,...changes});
    app.completeLesson();assert.equal(app.state.session.status,'completed');assert.equal(app.state.progress.passed[lesson.id],undefined);assert.equal(app.state.progress.pitchChecks[lesson.id],undefined);
    assert.match(app.renderSessionResult(),/Практика завершена/);
  }
  assert.equal(app.state.progress.passed.old,true);assert.ok(app.saved.size);
});
test('actual guitar clean pitch completion never claims rhythm or technique mastery',{skip:!available},()=>{
  const app=loadGuitarApp(root),lesson=app.guidedLessons()[0];app.state.selectedLessonId=lesson.id;
  Object.assign(app.state.session,{running:true,hits:lesson.notes.length,errors:0,manualAttempts:0,timedOut:false,cents:lesson.notes.map(()=>0),deadline:0});app.completeLesson();
  assert.equal(app.state.session.status,'passed');assert.equal(app.state.session.assessment.mastered,false);assert.equal(app.state.progress.passed[lesson.id],undefined);assert.ok(app.state.progress.pitchChecks[lesson.id]);assert.match(app.renderSessionResult(),/Ритм и исполнительские приёмы ещё не проверены/);
});
test('guitar practice route starts from tuning and respects the chosen right-hand method',{skip:!available},()=>{
  const app=loadGuitarApp(root);assert.equal(app.guidedLessons()[0].id,'t01-l07');
  app.state.progress.playingMethod='fingers';assert.ok(!app.guidedLessons().some(l=>l.id==='t02-l01'));assert.ok(app.guidedLessons().some(l=>l.id==='topic-string-pima-l01'));
  app.state.progress.playingMethod='pick';assert.ok(app.guidedLessons().some(l=>l.id==='t02-l01'));assert.ok(!app.guidedLessons().some(l=>l.id==='topic-string-pima-l01'));
});
test('the actual guitar UI hides questionable finger assignments and explains why',{skip:!available},()=>{
  const app=loadGuitarApp(root);app.state.progress.fingerHintsEnabled=true;
  app.state.selectedLessonId='topic-study-ride-a-white-swan-part-1';assert.equal(app.lessonAllowsFingerHints(),false);
  // Retrieve the actual lesson through the bundled source, not a duplicated fixture.
  const lesson=require('../tools/curriculum-inventory.cjs').loadGuitarCourse().lessons.find(l=>l.id===app.state.selectedLessonId);
  assert.match(app.learningContractHtml(lesson),/требующих редакции|требующие редакции/);
  app.state.selectedLessonId='t01-l07';assert.equal(app.lessonAllowsFingerHints(),true);
});

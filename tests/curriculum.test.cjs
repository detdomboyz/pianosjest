'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs');
const A=require('../practice-assessment.js'),C=require('../curriculum.js');
const {loadGuitarCourse}=require('../tools/curriculum-inventory.cjs');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../curriculum-plan.js'),'utf8'),context);const plan=context.MUSIC_CURRICULUM_PLAN;

test('every bundled lesson belongs to exactly one named learning stage',()=>{
  const app=loadApp(),guitar=loadGuitarCourse();
  for(const [instrument,lessons] of [['piano',app.lessons],['guitar',guitar.lessons]]){
    const entries=plan[instrument];assert.equal(entries.length,lessons.length);assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
    assert.deepEqual(new Set(entries.map(e=>e.id)),new Set(lessons.map(l=>l.id)));
    for(const entry of entries){assert.ok(C.stages[entry.stage],entry.id);const lesson=lessons.find(l=>l.id===entry.id);assert.equal(entry.fingerprint,instrument==='piano'?A.pianoSignature(lesson):A.guitarSignature(lesson),entry.id+' stale plan');}
  }
});
test('dependencies are acyclic and come before the learning stage',()=>{
  for(const instrument of ['piano','guitar']){const stages=[...new Set(plan[instrument].map(e=>e.stage))];for(const [i,id] of stages.entries())for(const prerequisite of C.stages[id].requires)assert.ok(stages.indexOf(prerequisite)<i,id+' requires '+prerequisite);}
});
test('piano learns fingers, melodies and separate hands before coordination and chords',()=>{
  const ids=Array.from(plan.piano,e=>e.id),before=(a,b)=>assert.ok(ids.indexOf(a)<ids.indexOf(b),a+' before '+b);
  before('course02-08','course01-07');before('course03-08','course01-07');before('course09-01','course07-03');before('course08-01','course07-07');before('course05-06','course09-03');
  before('course02-02','course04-04');before('course02-02','course04-05');
  for(const entry of plan.piano)for(const id of entry.preparation||[])before(id,entry.id);
  const route=C.route(plan,'piano',loadApp().lessons);assert.equal(route.length,80+require('../lesson-development.js').piano.length+require('../piano-lesson-development.js').piano.length);assert.equal(route.at(-1).id,'course10-08');assert.equal(C.next(plan,'piano',route,'course10-08'),null);
});
test('guitar foundations no longer follow repertoire or the final exam',()=>{
  const ids=Array.from(plan.guitar,e=>e.id),index=id=>ids.indexOf(id);
  assert.ok(index('topic-string-open-control-l01')<index('t03-l01'));
  assert.ok(index('topic-string-fretted-l01')<index('t07-l01'));
  assert.ok(index('t25-l01')<index('t12-l01'));
  assert.equal(plan.guitar[0].id,'t01-l07');
  assert.ok(C.stages[plan.guitar.find(e=>e.id==='t31-l01').stage].optional);
});

const steps=[{midis:[60],startBeat:0,durationBeats:1},{midis:[62],startBeat:2,durationBeats:1},{midis:[64,67],startBeat:3,durationBeats:2}];
function cleanEvents(){return [{type:'on',midi:60,at:1000,source:'midi'},{type:'off',midi:60,at:1950},{type:'on',midi:62,at:3000,source:'midi'},{type:'off',midi:62,at:3950},{type:'on',midi:64,at:4000,source:'midi'},{type:'on',midi:67,at:4020,source:'midi'},{type:'off',midi:64,at:5950},{type:'off',midi:67,at:5980}];}
const assess=events=>A.assessPiano({steps,events,bpm:60,targetBpm:60});
test('a musical take with a rest, chord and final releases passes',()=>assert.equal(assess(cleanEvents()).clean,true));
test('correct keys without correct pauses do not pass',()=>{const events=cleanEvents();events[2].at=2100;events[3].at=2990;assert.equal(assess(events).clean,false);assert.ok(assess(events).onsetErrors);});
test('taps and missing final release cannot pass a held-note lesson',()=>{for(const events of [cleanEvents().slice(0,-1),cleanEvents().map(e=>e.type==='off'?{...e,at:e.midi===60?1050:e.at}:e)])assert.equal(assess(events).clean,false);});
test('a rolled or sequentially released chord does not count as simultaneous',()=>{const events=cleanEvents();events[5].at=4500;assert.ok(assess(events).chordErrors);events[5].at=4020;events[6].at=4010;assert.ok(assess(events).chordErrors);});
test('manual input, slow tempo, assisted take and wrong keys cannot become mastery',()=>{
  for(const changes of [{events:cleanEvents().map(e=>({...e,source:'manual'}))},{bpm:30},{supported:false},{errors:1},{timedOut:true},{mode:'practice'}])assert.equal(A.assessPiano({steps,events:cleanEvents(),bpm:60,targetBpm:60,...changes}).clean,false);
});
test('three immediate repeats do not prove next-day retention; versions stay separate',()=>{
  let progress;for(let i=0;i<3;i++)progress=A.record(progress,{instrument:'piano',lessonId:'one',fingerprint:'v1',mode:i===2?'memory':'challenge',clean:true,now:1000+i*1000});
  assert.equal(progress.ready,true);assert.equal(progress.retained,false);
  progress=A.record(progress,{instrument:'piano',lessonId:'one',fingerprint:'v1',mode:'memory',clean:true,now:86402000});assert.equal(progress.retained,true);
  progress=A.record(progress,{instrument:'piano',lessonId:'one',fingerprint:'v2',mode:'memory',clean:false,now:86403000});assert.equal(progress.cleanTakes,0);
  assert.equal(progress.history['1:v1'].cleanTakes,4);
});
test('guitar manual marks, mistakes, timeout and polyphony never certify a performance',()=>{
  const notes=[{midi:40},{midi:45}],base={notes,hits:2,errors:0,cents:[0,0]};
  assert.equal(A.assessGuitar(base).pitchClean,true);assert.equal(A.assessGuitar(base).mastered,false);
  for(const changes of [{manualAttempts:1},{errors:1},{timedOut:true},{hits:1},{cents:[0,90]},{notes:[{midi:40,group:1},{midi:45,group:1}]}])assert.equal(A.assessGuitar({...base,...changes}).pitchClean,false);
});
test('natural harmonics use sounding partials: E3, B3, E4, not fretted B2/A2',()=>{
  const guitar=loadGuitarCourse(),lessons=guitar.topics.find(t=>t.id==='tech-31').lessons;
  assert.equal(lessons[0].notes[0].midi,52);assert.equal(lessons[2].notes[0].midi,59);assert.equal(lessons[3].notes[0].midi,64);
  assert.ok(Math.abs(lessons[2].notes[0].frequency-82.406889*3)<.001);
  const custom={topics:[{id:'tech-31',lessons:[{id:'t31-l03',notes:[{string:6,fret:7,midi:61,technique:'флажолет'}]}]}]};require('../guitar-curriculum-quality.js').correctBuiltins(custom);assert.equal(custom.topics[0].lessons[0].notes[0].midi,61);
});
test('actual piano event handler cannot assemble a chord from released notes',()=>{
  const clock={now:1000},app=loadApp({events:true,clock});const lesson=app.lessons.find(l=>l.id==='course01-07');app.setTestLesson(lesson);
  app.handleNoteOn(48,'midi');app.handleNoteOff(48);app.handleNoteOn(60,'midi');assert.equal(app.state.stepIndex,0);
  app.handleNoteOn(48,'midi');assert.equal(app.state.stepIndex,1);app.resetLessonState();
});
test('actual piano engine waits for the final release and persists clean evidence',async()=>{
  const clock={now:1000},saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},locks={request:async(name,options,work)=>work({name})},app=loadApp({events:true,clock,storage,locks});
  const lesson=app.lessons.find(l=>l.id==='course01-01');app.setTestLesson(lesson);assert.equal(app.challengeEligible(),true);app.state.attemptMode='challenge';
  const beatMs=60000/lesson.rhythm.practiceBpm;
  lesson.rhythm.steps.forEach((t,i)=>{clock.now=1000+t.startBeat*beatMs;app.handleNoteOn(60,'midi');if(i===lesson.steps.length-1){assert.equal(app.state.completed,false);assert.equal(app.state.awaitingRelease,true);}clock.now+=t.durationBeats*beatMs*.95;app.handleNoteOff(60);});
  assert.equal(app.state.completed,true);assert.equal(app.state.passed,true);assert.equal(app.state.learningProgress[lesson.id].cleanTakes,1);await app.legacyProgressStore.settled();assert.ok(saved.has('music-learning-piano-v1'));app.resetLessonState();
  app.state.attemptMode='memory';app.handleNoteOn(60,'midi');app.openLessonEditor(lesson.id);assert.equal(app.state.attemptAssisted,true);app.resetLessonState();
});
test('changed or legacy piano lessons cannot retain a checked-course badge',()=>{
  const app=loadApp(),lesson=app.lessons.find(l=>l.id==='course01-01');app.state.lesson=lesson;assert.equal(app.challengeEligible(),true);lesson.pattern+=' t';assert.equal(app.challengeEligible(),false);
  const unchanged=app.lessons.find(l=>l.id==='course01-02');app.state.lesson=unchanged;assert.equal(app.challengeEligible(),true);unchanged.handMode='right';assert.equal(app.challengeEligible(),false);
  app.state.lesson=app.lessons.find(l=>l.id==='mel201');assert.equal(app.challengeEligible(),false);
});
test('a whole-note listening example actually sustains four beats at the chosen tempo',()=>{
  const app=loadApp(),lesson=app.lessons.find(l=>l.id==='course04-03');
  assert.equal(app.previewSoundDurationMs(lesson,0,60,4000),4000);
  assert.equal(app.previewSoundDurationMs(lesson,0,30,8000),8000);
});
test('memory evidence never crosses instruments, lessons or malformed storage',()=>{
  const base={version:1,instrument:'guitar',lessonId:'one',fingerprint:'v1',takes:[{at:1000,mode:'memory'}]};
  const options={instrument:'piano',lessonId:'one',fingerprint:'v1',mode:'challenge',clean:false,now:2000};
  assert.equal(A.record(base,options).cleanTakes,0);
  assert.equal(A.record({...base,instrument:'piano',takes:{}},options).cleanTakes,0);
});
test('wide guitar positions are marked for review and their finger hints are suppressed',()=>{
  const quality=require('../guitar-curriculum-quality.js');
  assert.equal(quality.inspectLesson({notes:[{string:6,fret:1,group:1},{string:1,fret:8,group:1}]}).hideFingerHints,true);
  assert.equal(quality.inspectLesson({notes:[{string:6,fret:1,group:1},{string:1,fret:8,group:2}]}).hideFingerHints,false);
  assert.equal(quality.inspectLesson({notes:[{string:6,fret:0,group:1},{string:1,fret:8,group:1}]}).hideFingerHints,false);
});
test('extra notes during the final hold are recorded and prevent piano credit',()=>{
  const clock={now:1000},app=loadApp({events:true,clock}),lesson=app.lessons.find(l=>l.id==='course04-03');app.setTestLesson(lesson);app.state.attemptMode='challenge';
  const beat=60000/lesson.rhythm.practiceBpm;
  lesson.rhythm.steps.forEach((t,i)=>{clock.now=1000+t.startBeat*beat;app.handleNoteOn(60,'midi');if(i===lesson.steps.length-1){clock.now+=100;app.handleNoteOn(62,'midi');clock.now+=100;app.handleNoteOff(62);}clock.now=1000+(t.startBeat+t.durationBeats)*beat;app.handleNoteOff(60);});
  assert.equal(app.state.completed,true);assert.equal(app.state.passed,false);app.resetLessonState();
});

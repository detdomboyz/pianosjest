'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../practice-assessment.js');
const {loadApp}=require('./helpers/load-app.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
// Independent one-bar fixture, not built from the lesson definition.
const steps=[{midis:[60],startBeat:0,durationBeats:1},{midis:[60],startBeat:2,durationBeats:1}],ending={version:1,endBeat:4};
const events=[{type:'on',midi:60,at:1000,source:'midi'},{type:'off',midi:60,at:2000},{type:'on',midi:60,at:3000,source:'midi'},{type:'off',midi:60,at:4000}];
const input={steps,events,bpm:60,targetBpm:60,ending};

test('ending v1 requires live observation through the full last beat, not only the final release',()=>{
  for(const observedUntil of [undefined,NaN,4000,4999]){const r=A.assessPiano({...input,observedUntil});assert.equal(r.clean,false);assert.equal(r.endingObserved,false);}
  assert.equal(A.assessPiano({...input,observedUntil:5000}).clean,true);
  assert.equal(A.assessPiano({...input,observedUntil:5100}).clean,true);
  const offset=steps.map(s=>({...s,startBeat:s.startBeat+8}));assert.equal(A.pianoEnding({steps:offset,ending:{version:1,endBeat:12},bpm:60,anchorAt:1000,observedUntil:5000}).endAt,5000);
});

test('a new note or held sound in the final rest fails even if the ending was observed',()=>{
  for(const at of [4000,4500,4999]){const extra=[...events,{type:'on',midi:62,at,source:'midi'},{type:'off',midi:62,at:at+.5}].sort((a,b)=>a.at-b.at);assert.equal(A.assessPiano({...input,events:extra,observedUntil:5100}).clean,false);assert.ok(A.assessPiano({...input,events:extra,observedUntil:5100}).restErrors>0);}
  for(const off of [4300,5000,null]){const take=copy(events);if(off===null)take.pop();else take.at(-1).at=off;const r=A.assessPiano({...input,events:take,observedUntil:5100});assert.equal(r.clean,false);assert.ok(r.restErrors>0);}
  const small=copy(events);small.at(-1).at=4100;assert.equal(A.assessPiano({...input,events:small,observedUntil:5000}).clean,true);
});

test('invalid ending versions, missing clocks and contradictory observation cannot earn credit',()=>{
  for(const bad of [null,{}, {version:2,endBeat:4},{version:1,endBeat:3},{version:1,endBeat:2},{version:1,endBeat:65},{version:1,endBeat:'4'},{version:1,endBeat:Infinity}])assert.equal(A.assessPiano({...input,ending:bad,observedUntil:5000}).clean,false);
  const malformed=copy(events);malformed.push({type:'off',midi:62,at:NaN});assert.equal(A.assessPiano({...input,events:malformed,observedUntil:5000}).clean,false);
  assert.equal(A.assessPiano({...input,observedUntil:3900}).clean,false);
  assert.equal(A.pianoEnding({steps,ending,bpm:60,anchorAt:NaN,observedUntil:5000}).ready,false);
});

test('the optional ending changes only its lesson fingerprint and archives older progress',()=>{
  const a=loadApp(),l=a.lessons.find(l=>l.id==='detail-p-rhythm-03'),before=A.pianoSignature(l),changed=copy(l);changed.learning.ending=ending;
  assert.notEqual(A.pianoSignature(changed),before);const prior=A.record(undefined,{instrument:'piano',lessonId:l.id,fingerprint:before,mode:'memory',clean:true,now:1000}),next=A.record(prior,{instrument:'piano',lessonId:l.id,fingerprint:A.pianoSignature(changed),mode:'challenge',clean:false,now:2000});assert.equal(next.cleanTakes,0);assert.equal(next.history['1:'+before].memory,true);
  assert.equal(A.assessPiano({...input,ending:undefined}).clean,true);assert.equal(A.VERSION,1);
});

function testClock(){
  const clock={now:1000},tasks=new Map();let id=0;
  const add=(fn,ms,repeat)=>{const key=++id;tasks.set(key,{fn,at:clock.now+ms,repeat});return key;};
  clock.timers={setTimeout:(fn,ms)=>add(fn,ms,0),clearTimeout:key=>tasks.delete(key),setInterval:(fn,ms)=>add(fn,ms,ms),clearInterval:key=>tasks.delete(key)};
  clock.advance=until=>{let iterations=0;while(true){const next=[...tasks].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;assert.ok(iterations++<1000,'Timer loop');const[key,v]=next;clock.now=v.at;if(!v.repeat)tasks.delete(key);v.fn();if(v.repeat&&tasks.has(key))v.at+=v.repeat;}clock.now=until;};
  clock.timeouts=()=>[...tasks.values()].filter(v=>!v.repeat).length;return clock;
}
const lessonId='detail-p-rhythm-final-rest-01',beat=60000/56;
function setup(mode='challenge',extra={}){const clock=testClock(),a=loadApp({events:true,playback:true,clock,timers:clock.timers,...extra});a.setTestLesson(a.lessons.find(l=>l.id===lessonId));a.state.attemptMode=mode;return {a,clock};}
function twoNotes(a,clock){for(const start of [0,2]){clock.advance(1000+start*beat);a.handleNoteOn(60,'midi');clock.advance(1000+(start+1)*beat);a.handleNoteOff(60);}}

test('the new one-bar lesson has independently checked notes, fingers, prerequisite IDs and ending',()=>{
  const {a}=setup(),l=a.state.lesson;assert.deepEqual(Array.from(l.steps,s=>a.stepMidiList(s)[0]),[60,60]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,2]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),[1,1]);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.restBeforeBeats),[0,1]);assert.deepEqual(copy(l.learning.ending),{version:1,endBeat:4});assert.equal(l.rhythm.practiceBpm,56);assert.deepEqual(copy(l.fingeringSpec.steps),[[{hand:'right',num:1}],[{hand:'right',num:1}]]);assert.equal(l.learning.stage,'p2');assert.equal(l.learning.after,'detail-p-rhythm-03');assert.deepEqual(copy(l.learning.requires),['detail-p-rhythm-03','detail-p-release-01']);assert.ok(l.learning.requires.every(id=>a.lessons.some(l=>l.id===id)));assert.equal(l.learning.provenance.type,'project-technical-drill');assert.match(l.learning.practiceSteps.join(' '),/три C4/);assert.match(l.learning.practiceSteps.join(' '),/3–5 минут/);assert.equal(a.challengeEligible(),true);assert.equal(l.contentKind,'exercise');assert.equal(l.learning.coverageDomain,'rhythm');a.resetLessonState();
});

test('actual challenge and memory wait to beat four; direct completion cannot bypass the rest',()=>{
  for(const mode of ['challenge','memory']){const {a,clock}=setup(mode);twoNotes(a,clock);assert.equal(a.state.completed,false);assert.equal(a.state.passed,false);assert.equal(a.state.awaitingEnding,true);assert.equal(a.state.awaitingRelease,false);assert.equal(a.state.learningProgress[lessonId],undefined);a.completeLesson();assert.equal(a.state.completed,false);
    if(mode==='memory'){assert.equal(a.lessonStatusText(),'Идёт проверка');for(const materialMode of ['compact','expanded','hidden']){a.state.learningMaterialMode=materialMode;assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/C4|Тишина|пауза/);}}else{assert.match(a.currentNoteHtml(),/Тишина/);assert.doesNotMatch(a.currentNoteHtml(),/Готово/);}
    clock.advance(1000+4*beat-1);assert.equal(a.state.completed,false);clock.advance(1000+4*beat);assert.equal(a.state.completed,true);assert.equal(a.state.passed,true);assert.equal(a.state.assessment.endingObserved,true);assert.equal(a.state.learningProgress[lessonId].cleanTakes,1);assert.equal(a.state.learningProgress[lessonId].memory,mode==='memory');assert.equal(clock.timeouts(),0);a.resetLessonState();
  }
});

test('actual ending detects a note during silence, missing release and early release',()=>{
  for(const kind of ['extra','held','early']){const {a,clock}=setup();if(kind==='extra'){twoNotes(a,clock);clock.advance(1000+3.5*beat);a.handleNoteOn(62,'midi');a.handleNoteOff(62);}else{a.handleNoteOn(60,'midi');clock.advance(1000+beat);a.handleNoteOff(60);clock.advance(1000+2*beat);a.handleNoteOn(60,'midi');if(kind==='early'){clock.advance(1000+2.3*beat);a.handleNoteOff(60);}}
    clock.advance(1000+4*beat);assert.equal(a.state.completed,true);assert.equal(a.state.passed,false);assert.equal(a.state.learningProgress[lessonId].cleanTakes,0);a.resetLessonState();
  }
});

test('reset, lesson change and mode change cancel the pending ending without awarding progress',()=>{
  for(const operation of [a=>a.resetLessonState(),a=>a.selectLesson('detail-p-rhythm-03'),a=>a.setAttemptMode('practice')]){const {a,clock}=setup();twoNotes(a,clock);assert.ok(clock.timeouts()>0);operation(a);clock.advance(1000+5*beat);assert.equal(a.state.completed,false);assert.equal(a.state.learningProgress[lessonId],undefined);assert.equal(a.state.awaitingEnding,false);assert.equal(clock.timeouts(),0);a.resetLessonState();}
});

test('a delayed timer is checked before a new note and captured attempt BPM controls the ending',()=>{
  const {a,clock}=setup();twoNotes(a,clock);a.state.playbackBpm=112;clock.advance(1000+3.5*beat);assert.equal(a.state.completed,false);clock.now=1000+4*beat;a.handleNoteOn(62,'midi');assert.equal(a.state.completed,true);assert.equal(a.state.passed,true);assert.equal(a.state.attemptEvents.filter(e=>e.type==='on').length,2);assert.equal(a.state.attemptBpm,56);assert.equal(clock.timeouts(),0);a.handleNoteOff(62);a.resetLessonState();
});

test('practice observes the ending but never receives an execution credit',()=>{
  const {a,clock}=setup('practice');twoNotes(a,clock);assert.equal(a.state.completed,false);clock.advance(1000+4*beat);assert.equal(a.state.completed,true);assert.equal(a.state.passed,false);assert.equal(a.state.learningProgress[lessonId],undefined);a.resetLessonState();
});

test('playback releases notes and keys before the final beat while the player continues through silence',()=>{
  const {a,clock}=setup();assert.deepEqual(Array.from(a.playbackDurations()),[2,2]);a.startPlayback();assert.equal(a.state.playbackActive.size,1);clock.advance(1000+beat);assert.equal(a.state.playbackActive.size,0);assert.equal(a.state.playbackRest,true);clock.advance(1000+2*beat);assert.equal(a.state.playbackActive.size,1);clock.advance(1000+3*beat);assert.equal(a.state.playbackActive.size,0);assert.equal(a.state.playbackRest,true);assert.equal(a.state.playbackPlaying,true);clock.advance(1000+4*beat);assert.equal(a.state.playbackPlaying,false);assert.equal(a.state.playbackRest,false);assert.equal(clock.timeouts(),0);a.resetLessonState();
});

test('pause, stop and lesson reset clear playback rest timers',()=>{
  for(const operation of [a=>a.pausePlayback(),a=>a.stopPlayback(),a=>a.resetLessonState()]){const {a,clock}=setup();a.startPlayback();assert.equal(clock.timeouts(),2);operation(a);assert.equal(clock.timeouts(),0);clock.advance(1000+5*beat);assert.equal(a.state.playbackPlaying,false);assert.equal(a.state.playbackRest,false);a.resetLessonState();}
});

test('actual Web Audio scheduling has no oscillator tail across a terminal-rest boundary',()=>{
  const stopped=[],values=[],connected=()=>({connect(){}});class AudioContext{constructor(){this.currentTime=10;this.state='running';this.destination={};}createOscillator(){return {...connected(),frequency:{},start(){},stop:at=>stopped.push(at)};}createBiquadFilter(){return {...connected(),frequency:{}};}createGain(){return {...connected(),gain:{setValueAtTime:(value,at)=>values.push({value,at}),exponentialRampToValueAtTime(){}}};}}
  const {a}=setup('practice',{AudioContext});a.playPreviewMidi(60,1000,true);assert.equal(stopped.at(-1),11);assert.ok(values.some(v=>v.value===0&&v.at===11));a.playPreviewMidi(60,1000);assert.equal(stopped.at(-1),11.04);a.resetLessonState();
});

test('ending data survives v7 JSON transfer and personal revisions without being silently repaired',()=>{
  const {a}=setup(),snapshot=copy(a.catalogSnapshot()),item=snapshot.lessons.find(l=>l.id===lessonId);item.learning.practiceSteps[0]='Мой разбор';item.learning.ending={version:2,endBeat:8};assert.equal(a.applyCatalogSnapshot(snapshot),true);const l=a.lessons.find(l=>l.id===lessonId);assert.equal(l.learning.practiceSteps[0],'Мой разбор');assert.deepEqual(copy(l.learning.ending),{version:2,endBeat:8});a.state.lesson=l;assert.equal(a.challengeEligible(),false);assert.deepEqual(copy(a.catalogSnapshot().lessons.find(l=>l.id===lessonId).learning.ending),{version:2,endBeat:8});a.resetLessonState();
});

test('the ending is visible in the actual practice score and target but absent in memory',()=>{
  const {a}=setup('practice');assert.match(a.currentNoteHtml(),/Конечная пауза:/);assert.match(a.currentNoteHtml(),/1071 мс/);assert.match(a.scoreViewHtml(),/Конечная пауза:/);a.state.attemptMode='memory';assert.doesNotMatch(a.currentNoteHtml(),/Конечная пауза|1071|C4/);assert.doesNotMatch(a.scoreViewHtml(),/Конечная пауза|1071|C4/);a.resetLessonState();
});

test('an interrupted observation is rejected even after the nominal ending; legacy contracts stay unchanged',()=>{
  const r=A.assessPiano({...input,observedUntil:5000,observationInterrupted:true});assert.equal(r.clean,false);assert.equal(r.endingObserved,false);assert.equal(r.endingInterrupted,true);assert.match(r.reasons.join(' '),/Наблюдение MIDI прервано/);assert.equal(A.assessPiano({...input,ending:undefined,observationInterrupted:true}).clean,true);
});

test('native MIDI removal, reconnection, switching or a closed input cannot create a clean ending',()=>{
  for(const mode of ['disconnect-reconnect','switch','closed-no-event']){const {a,clock}=setup(),one={id:'one',state:'connected'},two={id:'two',state:'connected'},inputs=new Map([['one',one],['two',two]]);a.state.midiAccess={inputs};a.selectMidiInput('one',false);
    for(const start of [0,2]){clock.advance(1000+start*beat);one.onmidimessage({data:[0x90,60,90]});clock.advance(1000+(start+1)*beat);one.onmidimessage({data:[0x80,60,0]});}
    if(mode==='switch')a.selectMidiInput('two',false);else if(mode==='closed-no-event')one.connection='closed';else{inputs.delete('one');a.refreshMidiDevices();inputs.set('one',one);a.refreshMidiDevices();}if(mode!=='closed-no-event')assert.equal(a.state.attemptObservationInterrupted,true);clock.advance(1000+4*beat);assert.equal(a.state.passed,false);assert.equal(a.state.assessment.endingInterrupted,true);assert.equal(a.state.learningProgress[lessonId].cleanTakes,0);a.resetLessonState();assert.equal(a.state.attemptObservationInterrupted,false);
  }
});

class TestBridge{constructor(){TestBridge.latest=this;this.handlers=new Map();}addEventListener(name,handler){this.handlers.set(name,handler);}close(){}emit(name,data){this.handlers.get(name)?.({data:JSON.stringify(data)});}}
test('local bridge loss and EventSource errors interrupt the active bridge attempt before its ending',()=>{
  for(const mode of ['status','error']){const {a,clock}=setup('challenge',{EventSource:TestBridge});a.connectMidiBridgeEvents();const source=TestBridge.latest;source.emit('status',{connected:true,windowOpen:true});for(const start of [0,2]){clock.advance(1000+start*beat);source.emit('midi',{on:true,note:60});clock.advance(1000+(start+1)*beat);source.emit('midi',{on:false,note:60});}assert.equal(a.state.attemptMidiSource,'midi-bridge');source.emit(mode,mode==='status'?{connected:false,windowOpen:true}:{});clock.advance(1000+4*beat);assert.equal(a.state.passed,false);assert.equal(a.state.assessment.endingInterrupted,true);a.resetLessonState();}
});

test('an unused bridge failure does not interrupt the independent native MIDI attempt',()=>{
  const {a,clock}=setup('challenge',{EventSource:TestBridge});a.connectMidiBridgeEvents();twoNotes(a,clock);TestBridge.latest.emit('error',{});assert.equal(a.state.attemptObservationInterrupted,false);clock.advance(1000+4*beat);assert.equal(a.state.passed,true);a.resetLessonState();
});

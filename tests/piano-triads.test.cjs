'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
const app=loadApp(),id=n=>'detail-p-minor-triads-0'+n;
test('independent triad reference: A minor is A–C–E in each explicitly assigned hand',()=>{
  for(const [n,expected,hand,digits] of [[1,[69,72,76],'right',[1,3,5]],[2,[57,60,64],'left',[5,3,1]]]){
    const l=app.lessons.find(l=>l.id===id(n));assert.deepEqual(Array.from(app.stepMidiList(l.steps[3])),expected);assert.deepEqual(Array.from(app.stepMidiList(l.steps[7])),expected);
    assert.deepEqual(Array.from(l.fingeringSpec.steps[3],f=>f.num),digits);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand===hand));assert.equal(l.handMode,hand);
    assert.deepEqual(Array.from(l.steps.slice(0,3),s=>app.stepMidiList(s)[0]),expected);assert.deepEqual(Array.from(l.steps.slice(4,7),s=>app.stepMidiList(s)[0]),expected.slice().reverse());
  }
});
test('major/minor comparison changes only the third, with a preparation rest and no fake held voices',()=>{
  for(const [n,root,hand] of [[3,60,'right'],[4,48,'left']]){const l=app.lessons.find(l=>l.id===id(n));assert.equal(l.steps.length,4);for(let i=0;i<4;i++)assert.deepEqual(Array.from(app.stepMidiList(l.steps[i])),[root,root+(i%2?3:4),root+7]);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand===hand));assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),[0,3,6,9]);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===2));assert.match(l.learning.provenance.purpose,/терци|среднего пальца/);}
});
test('new chord lessons have valid timing, feasible explicit fingers and a current MIDI contract',()=>{
  for(let n=1;n<=4;n++){const l=app.lessons.find(l=>l.id===id(n));app.state.lesson=l;assert.equal(app.challengeEligible(),true);assert.ok(app.ensureFingeringPlan(l).steps.every(s=>s.length>0));assert.ok(l.rhythm.steps.every(s=>s.durationBeats>0));assert.ok(l.timeLimit>=l.rhythm.steps.at(-1).startBeat*60/l.rhythm.practiceBpm);assert.ok(l.learning.requires.length);}
});
test('provenance and source labels are visible, escaped and never attributed to the guitar author by default',()=>{
  const l=JSON.parse(JSON.stringify(app.lessons.find(l=>l.id===id(1))));const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  let html=D.materialHtml(l,'piano',esc);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/The Open University/);assert.match(html,/Это не цитата из пьесы/);assert.doesNotMatch(html,/Cliff Smith/);
  l.learning.provenance.history='<script>bad()</script>';l.learning.references=['https://example.test/primary'];l.learning.referenceTitles={};html=D.materialHtml(l,'piano',esc);assert.match(html,/&lt;script&gt;/);assert.match(html,/Первоисточник 1/);assert.doesNotMatch(html,/<script>|Cliff Smith/);
});
test('the app migrates new lessons once, preserves user edits, and restores their descriptions',()=>{
  const a=loadApp();a.lessons.find(l=>l.id===id(1)).title='Моя редакция';const before=a.lessons.length,snapshot=a.catalogSnapshot();assert.equal(a.installReviewedLessons(),false);a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.length,before);assert.equal(a.lessons.find(l=>l.id===id(1)).title,'Моя редакция');assert.equal(a.lessons.find(l=>l.id===id(2)).learning.provenance.type,'project-technical-drill');
});
test('one complete new MIDI lesson passes, but a D in place of E cannot match the checked score',()=>{
  const l=app.lessons.find(l=>l.id===id(1)),beat=60000/l.rhythm.practiceBpm,steps=l.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),events=steps.flatMap(s=>s.midis.flatMap(midi=>[{type:'on',midi,at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi,at:1000+(s.startBeat+s.durationBeats)*beat}])).sort((a,b)=>a.at-b.at);
  assert.equal(A.assessPiano({steps,events,bpm:52,targetBpm:52,profile:'legato'}).clean,true);assert.equal(A.assessPiano({steps,events:events.map(e=>({...e,midi:e.midi===76?74:e.midi})),bpm:52,targetBpm:52}).clean,false);
});

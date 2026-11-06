'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
const app=loadApp(),id='detail-p-left-triple-pulse-01',copy=x=>JSON.parse(JSON.stringify(x));
const input=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:48,targetBpm:48,profile:'standard',timingPrecision:'beat-boundary-v1'});
function events(mode='correct'){const out=[];for(let i=0;i<3;i++){const on=1000+i*3750,off=on+2500+(mode==='early'&&i===2?-625:mode==='late'&&i===2?625:0);out.push({type:'on',midi:48,source:'midi',at:on},{type:'off',midi:48,at:off});}if(mode==='extra-in-rest')out.push({type:'on',midi:52,source:'midi',at:3900},{type:'off',midi:52,at:4100});if(mode==='omit-final-off')out.pop();return out.sort((a,b)=>a.at-b.at);}

test('new left triple pulse has independent C3/5 reference, two internal rests and exact bounded hold timing',()=>{
 const l=app.lessons.find(l=>l.id===id);assert.ok(l);assert.deepEqual(copy(Array.from(l.steps,app.stepMidiList)),[[48],[48],[48]]);assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand==='left'&&f.num===5));assert.equal(l.handMode,'left');assert.equal(l.rhythm.practiceBpm,48);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:3,denominator:4});assert.deepEqual(Array.from(l.rhythm.steps,s=>[s.startBeat,s.durationBeats,s.restBeforeBeats]),[[0,2,0],[3,2,1],[6,2,1]]);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.coverageDomain,'rhythm');app.state.lesson=l;assert.equal(app.challengeEligible(),true);
 assert.equal(A.assessPiano({...input(l),events:events()}).clean,true);for(const mode of ['early','late','extra-in-rest','omit-final-off'])assert.equal(A.assessPiano({...input(l),events:events(mode)}).clean,false,mode);
});

test('actual MIDI observes the two quiet gaps and ends only on the last release, not after an imaginary final rest',()=>{
 for(const mode of ['correct','early','extra-in-rest']){const clock={now:1000},a=loadApp({events:true,clock}),l=a.lessons.find(l=>l.id===id),take=events(mode);a.setTestLesson(l);a.state.attemptMode='challenge';for(const [i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.completed,true);assert.equal(a.state.passed,mode==='correct');if(mode==='correct')assert.equal(clock.now,11000);a.resetLessonState();}
});

test('the left comparison has actual left-hand preparation and pulse materials disclose its limited observation and transfer',()=>{
 const l=app.lessons.find(l=>l.id===id),cmp=app.lessons.find(l=>l.id==='detail-p-minor-triads-04');assert.deepEqual(copy(l.learning.requires),['course03-08','detail-p-release-02']);for(const p of l.learning.requires){const prep=app.lessons.find(l=>l.id===p);assert.ok(prep);assert.ok(prep.fingeringSpec.steps.flat().every(f=>f.hand==='left'));}
 assert.deepEqual(copy(cmp.learning.requires),['course08-02','detail-p-black-02',id]);assert.ok(!cmp.learning.requires.includes('detail-p-minor-triads-03'));
 const html=D.materialHtml(l,'piano',String);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/конечная пауза не оценивается/);assert.match(html,/не фраза текущего MIDI-зачёта/);assert.match(html,/не является независимым тестом слуха/);assert.match(html,/E3 средним 3/);assert.equal(l.learning.provenance.author,'Упражнение проекта');
});

test('new pulse registration and catalog exchange preserve personalized instructions and do not duplicate IDs',()=>{
 const a=loadApp(),total=a.lessons.length,s=copy(a.catalogSnapshot());s.lessons.find(l=>l.id===id).title='Мой левый пульс';s.lessons.find(l=>l.id===id).learning.practiceSteps[0]='Моя подготовка';const signature=A.pianoSignature(a.lessons.find(l=>l.id===id));a.applyCatalogSnapshot(s);assert.equal(a.installReviewedLessons(),false);assert.equal(a.lessons.length,total);assert.equal(a.lessons.filter(l=>l.id===id).length,1);assert.equal(a.lessons.find(l=>l.id===id).title,'Мой левый пульс');assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Моя подготовка');assert.equal(A.pianoSignature(a.lessons.find(l=>l.id===id)),signature);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),fixture=require('./fixtures/piano-single-black-position-v1.json');
const app=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const expected=[
 {id:'detail-p-black-position-right-01',hand:'right',notes:[62,64,66,64,62,62,64,66,67,69,67,66,64,62],fingers:[1,2,3,2,1,1,2,3,4,5,4,3,2,1],black:66,wrong:65,grade:'06be6163'},
 {id:'detail-p-black-position-left-01',hand:'left',notes:[57,58,60,58,57,53,55,57,58,60,58,57,55,53],fingers:[3,2,1,2,3,5,4,3,2,1,2,3,4,5],black:58,wrong:59,grade:'044e15be'}
];
const starts=[0,1,2,3,4,7,8,9,10,11,12,13,14,15],units=expected.map(e=>app.lessons.find(l=>l.id===e.id));
function score(i){return {steps:units[i].rhythm.steps.map((s,n)=>({...s,midis:[expected[i].notes[n]]})),bpm:52,targetBpm:52,articulation:'legato'};}
function take(i,mode='clean'){
 const e=expected[i],beat=60000/52,out=[];
 e.notes.forEach((m,n)=>{if(mode==='omit-black'&&n===2)return;const pitch=mode==='wrong-black'&&m===e.black?e.wrong:mode==='wrong-register'&&n===5?m+12:m,start=starts[n]-(mode==='skip-rest'&&n>=5?2:0),duration=mode==='short-last'&&n===13?.2:mode==='hold-rest'&&n===4?3:1;out.push({type:'on',midi:pitch,source:'midi',at:1000+start*beat},{type:'off',midi:pitch,at:1000+(start+duration)*beat});});
 if(mode==='rest-note')out.push({type:'on',midi:e.black,source:'midi',at:1000+5.5*beat},{type:'off',midi:e.black,at:1000+5.7*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
test('D position keeps F sharp under right3 with the neighboring white2 and4 and a five-note return',()=>{
 const l=units[0],e=expected[0];assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),e.fingers.map(num=>[{hand:e.hand,num}]));assert.equal(l.handMode,'right');assert.equal(A.pianoSignature(l),e.grade);assert.equal(l.learning.provenance.type,'project-technical-drill');assert.deepEqual([64-62,66-64,67-66,69-67],[2,2,1,2]);assert.ok(!e.notes.includes(65));
});
test('F position uses left2 on B flat and preserves the independent previous white B lesson',()=>{
 const l=units[1],e=expected[1];assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),e.fingers.map(num=>[{hand:e.hand,num}]));assert.equal(l.handMode,'left');assert.equal(A.pianoSignature(l),e.grade);assert.deepEqual([55-53,57-55,58-57,60-58],[2,2,1,2]);assert.ok(l.guide.setup.includes('A♯3'));assert.ok(l.learning.requires.includes('detail-p-shifted-left-five-01'));const old=app.lessons.find(l=>l.id==='detail-p-shifted-left-five-01');assert.ok(old.steps.flatMap(app.stepMidiList).includes(59));assert.equal(A.pianoSignature(old),'2019c5db');
});
test('executable assessment checks fourteen quarter attacks, two silent beats, both directions and final release',()=>{
 units.forEach((l,i)=>{assert.equal(l.rhythm.practiceBpm,52);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.learning.articulation,'legato');assert.equal(starts.at(-1)+l.rhythm.steps.at(-1).durationBeats,16);assert.equal(A.assessPiano({...score(i),events:take(i)}).clean,true);for(const mode of ['wrong-black','omit-black','wrong-register','skip-rest','hold-rest','rest-note','short-last'])assert.equal(A.assessPiano({...score(i),events:take(i,mode)}).clean,false,expected[i].id+' '+mode);});
});
test('actual application MIDI handlers finish each new lesson only after its last note-off',()=>{
 for(let i=0;i<2;i++){const clock={now:10000},a=loadApp({events:true,clock});a.setTestLesson(a.lessons.find(l=>l.id===expected[i].id));a.state.attemptMode='challenge';const events=take(i);for(const[n,e]of events.entries()){clock.now=10000+e.at-1000;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(n===events.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[expected[i].id].fingerprint,expected[i].grade);a.resetLessonState();}
});
test('all574 earlier musical payloads, execution settings, classifications and relative catalog order are preserved',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,fixture.allLessons),fixture.allLessons.map(l=>l.id));assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
 for(const old of fixture.allLessons){const l=app.lessons.find(x=>x.id===old.id);assert.equal(hash(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old)),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),require('./helpers/piano-assessment-revisions.cjs').expectedGrade(old),old.id);assert.deepEqual(copy({handMode:l.handMode,exam:l.exam,timeLimit:l.timeLimit,maxErrors:l.maxErrors}),old.execution,old.id);assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lesson-review-baseline.js')).digest('hex'),fixture.protectedBaselineSha256);
});
test('maintained route resolves each explicit preparation before its independent new lesson and preserves guitar',()=>{
 const context={};vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'),'utf8'),context);const plan=context.MUSIC_CURRICULUM_PLAN;assert.equal(hash(plan.guitar),fixture.guitarRouteSha256);
 for(const l of units){const index=plan.piano.findIndex(x=>x.id===l.id);assert.ok(index>=0);assert.equal(plan.piano[index].stage,'p3');assert.equal(plan.piano[index].challenge,true);for(const id of [l.learning.after,...l.learning.requires])assert.ok(plan.piano.findIndex(x=>x.id===id)<index&&plan.piano.some(x=>x.id===id),id);}
});
test('both studies explain purpose, count, distinction, project provenance and an open transfer without claiming teacher approval',()=>{
 for(const l of units){const x=l.learning;assert.equal(l.contentKind,'exercise');assert.equal(x.coverageDomain,'positions');assert.ok(x.provenance.purpose.length>60);assert.equal(x.sourceEvidenceIds.length,5);assert.ok(x.sourceEvidenceIds.includes('umta-aim-five-note-d-major-2026-11-08'));assert.equal(x.practiceSteps.length,5);assert.ok(x.practiceSteps.some(s=>s.includes('не полная гамма')));assert.ok(x.practiceSteps.some(s=>s.includes('Отдельная открытая проба')));assert.ok(x.practiceSteps.some(s=>s.includes('на следующий день')));assert.ok(x.provenance.sourceNote.includes('авторы не утверждали'));assert.equal(x.selfCheck.length,5);}
});
test('reinstalling the built-in course preserves personal editions of both new records and never duplicates them',()=>{
 const a=loadApp();for(const [i,e] of expected.entries()){const l=a.lessons.find(l=>l.id===e.id);l.title+=' personal';l.guide.setup='personal preparation';l.contentKind='piece';l.order=2-i;l.steps[0].keys=['y'];}
 const before=expected.map(e=>copy(a.lessons.find(l=>l.id===e.id)));a.installReviewedLessons();assert.deepEqual(expected.map(e=>copy(a.lessons.find(l=>l.id===e.id))),before);for(const e of expected)assert.equal(a.lessons.filter(l=>l.id===e.id).length,1);
});

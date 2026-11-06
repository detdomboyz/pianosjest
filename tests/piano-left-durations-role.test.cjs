'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js'),Coverage=require('../tools/piano-skill-coverage.cjs'),original=require('./fixtures/piano-whole-note-role-v1.json');
const app=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),ids=['detail-p-left-half-01','detail-p-left-whole-01'];
const score=l=>({steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),bpm:56,targetBpm:56,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});
function events(input,mode='correct'){
 const beat=60000/56,out=[];for(const[i,s]of input.steps.entries())for(const midi of s.midis){if(mode==='missing-reattack'&&i===1)continue;let end=s.startBeat+s.durationBeats;if(i===input.steps.length-1){if(mode==='early')end-=.27;if(mode==='late')end+=.27;}out.push({type:'on',midi,source:'midi',at:1000+s.startBeat*beat},{type:'off',midi,at:1000+end*beat});}return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('right whole-note repetition preserves every event, its existing musical version and original review',()=>{
 const l=app.lessons.find(l=>l.id==='detail-p-rhythm-01'),base=app.lessons.find(l=>l.id==='course04-03');assert.deepEqual(copy(l.steps),original.steps);assert.deepEqual(copy(l.rhythm),original.rhythm);assert.deepEqual(copy(l.fingeringSpec),original.fingeringSpec);assert.deepEqual(copy(l.learning.contentReview),original.learning.contentReview);assert.equal(A.pianoSignature(l),'e664aca0');
 const musical=x=>Array.from(x.rhythm.steps,(s,i)=>({midi:Array.from(app.stepMidiList(x.steps[i])),start:s.startBeat,duration:s.durationBeats,hand:x.fingeringSpec.steps[i][0].hand,finger:x.fingeringSpec.steps[i][0].num}));assert.deepEqual(musical(l),musical(base));assert.equal(l.rhythm.bpm,base.rhythm.bpm);assert.equal(l.learning.sameGoalAs,base.id);assert.deepEqual(copy(l.learning.requires),[base.id]);
 let progress=A.record(undefined,{instrument:'piano',lessonId:l.id,fingerprint:'e664aca0',mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:l.id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,true);
});

test('role upgrade is guarded, idempotent and leaves personal edits and old pedagogical metadata intact',()=>{
 const l=copy(original);assert.equal(P.reviewWholeNoteRole([l]),1);const revised=copy(l);assert.equal(P.reviewWholeNoteRole([l]),0);assert.deepEqual(copy(l),revised);assert.deepEqual(copy(l.learning.roleReview.previousInstruction.learning),original.learning);
 for(const edit of [l=>l.title='Мой длинный звук',l=>l.description='Моя цель',l=>l.guide.motion='Моё движение',l=>l.learning.requires=['mine'],l=>l.rhythm.steps[0].durationBeats=3,l=>l.fingeringSpec.steps[0][0].num=2,l=>l.contentKind='piece']){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewWholeNoteRole([x]),0);assert.deepEqual(copy(x),before);}
});

test('new left studies explicitly assign C3 to finger 5 with two distinct eight-beat tasks',()=>{
 const half=app.lessons.find(l=>l.id===ids[0]),whole=app.lessons.find(l=>l.id===ids[1]);for(const[l,count,duration]of [[half,4,2],[whole,2,4]]){assert.equal(l.contentKind,'exercise');assert.equal(l.steps.length,count);assert.deepEqual(Array.from(l.steps,s=>Array.from(app.stepMidiList(s))),Array.from({length:count},()=>[48]));assert.deepEqual(Array.from(l.fingeringSpec.steps,g=>Array.from(g,n=>[n.hand,n.num])),Array.from({length:count},()=>[['left',5]]));assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),Array.from({length:count},(_,i)=>i*duration));assert.ok(l.rhythm.steps.every(s=>s.durationBeats===duration&&s.restBeforeBeats===0));assert.equal(l.rhythm.bpm,56);assert.equal(l.learning.timingPrecision,'beat-boundary-v1');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.practiceSteps.length,3);assert.equal(l.rhythm.steps.at(-1).startBeat+duration,8);assert.match(l.learning.practiceSteps[2],/D3/);}
 assert.deepEqual(copy(half.learning.requires),['course01-02']);assert.deepEqual(copy(whole.learning.requires),[half.id]);assert.equal(half.learning.nextLessonId,whole.id);
});

test('left studies pass exact MIDI timing but reject early/late endings and a missing repeated attack',()=>{
 for(const id of ids){const l=app.lessons.find(l=>l.id===id),input=score(l);assert.equal(A.assessPiano({...input,events:events(input)}).clean,true);for(const mode of ['early','late','missing-reattack'])assert.equal(A.assessPiano({...input,events:events(input,mode)}).clean,false,id+' / '+mode);}
});

test('actual MIDI path waits for final release of each left-hand study and does not grade a missing repeat',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});for(const id of ids)for(const mode of ['correct','early','late','missing-reattack']){const l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='memory';const take=events(score(l),mode);for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,mode==='correct',id+' / '+mode);if(mode==='correct')assert.ok(Math.abs(clock.now-(1000+8*60000/56))<1e-6);a.resetLessonState();}
});

test('route prepares the left hand before longer holding and keeps right repetition linked without changing user order',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano),order=route.map(l=>l.id),report=Coverage.build();for(const id of ids){const l=app.lessons.find(l=>l.id===id);assert.equal(l.learning.stage,'p2');for(const prep of l.learning.requires)assert.ok(order.indexOf(prep)<order.indexOf(id));assert.equal(route.find(l=>l.id===id).challenge,true);}assert.ok(report.sameGoalGroups.find(g=>g.primaryId==='course04-03').lessonIds.includes('detail-p-rhythm-01'));assert.equal(report.counts.goalGroupUpperBound,report.counts.implementedLearningLessons-report.counts.explicitSameGoalVariants-report.counts.explicitCheckpoints);
});

test('JSON preserves personal left-hand edits, role history and long final audio durations',()=>{
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());snapshot.lessons.find(l=>l.id===ids[0]).description='Мой левый разбор';snapshot.lessons.find(l=>l.id==='detail-p-rhythm-01').learning.practiceSteps[0]='Мой повтор';a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id===ids[0]).description,'Мой левый разбор');const repeat=a.lessons.find(l=>l.id==='detail-p-rhythm-01');assert.equal(repeat.learning.practiceSteps[0],'Мой повтор');assert.equal(repeat.learning.sameGoalAs,'course04-03');assert.ok(repeat.learning.roleReview.previousInstruction);assert.equal(a.installReviewedLessons(),false);
 for(const id of ids){const l=a.lessons.find(l=>l.id===id),last=l.steps.length-1;assert.ok(Math.abs(a.previewSoundDurationMs(l,last,56,1071)-l.rhythm.steps[last].durationBeats*60000/56)<1e-6);}
});

test('Russian action counts are localized and used by the actual piano catalog',()=>{
 for(const[n,text]of [[0,'0 действий'],[1,'1 действие'],[2,'2 действия'],[4,'4 действия'],[5,'5 действий'],[11,'11 действий'],[14,'14 действий'],[21,'21 действие'],[22,'22 действия'],[23,'23 действия'],[25,'25 действий'],[101,'101 действие'],[111,'111 действий']])assert.equal(UI.actionCountText(n),text);assert.match(UI.actionCountText(1000),/^1\s000 действий$/);for(const n of [-1,1.5,NaN,Infinity,'2',null,undefined])assert.equal(UI.actionCountText(n),'');
 const html=app.sidebarHtml();assert.match(html,/23 действия/);assert.doesNotMatch(html,/23 действий/);assert.match(html,/4 действия/);assert.match(html,/2 действия/);
});

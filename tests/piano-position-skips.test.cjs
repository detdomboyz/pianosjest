'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),D=require('../lesson-development.js');
const app=loadApp(),ids=['detail-p-position-skips-01','detail-p-position-skips-03','detail-p-position-skips-02','detail-p-position-skips-04','detail-p-position-skips-05'];
test('melodic thirds have independent pitch, hand and finger references with no middle note',()=>{
  for(const [id,notes,digits,hand,middle,distance] of [[ids[0],[62,65,62,65],[2,4,2,4],'right',64,3],[ids[1],[48,52,48,52],[5,3,5,3],'left',50,4],[ids[2],[64,67,64,67],[3,5,3,5],'right',65,3],[ids[3],[50,53,50,53],[4,2,4,2],'left',52,3],[ids[4],[52,55,52,55],[3,1,3,1],'left',53,3]]){
    const l=app.lessons.find(l=>l.id===id);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),notes);assert.ok(l.steps.every(s=>app.stepMidiList(s).length===1));assert.ok(!l.steps.flatMap(app.stepMidiList).includes(middle));
    assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),digits);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand===hand));assert.equal(l.handMode,hand);assert.equal(notes[1]-notes[0],distance);assert.equal(l.learning.coverageDomain,'intervals');assert.equal(l.learning.articulation,'legato');
    assert.ok(l.rhythm.steps.every((s,i)=>s.startBeat===i&&s.durationBeats===1));assert.ok(app.ensureFingeringPlan(l).steps.every(s=>s.length===1));app.state.lesson=l;assert.equal(app.challengeEligible(),true);
  }
});
test('the actual evaluator rejects an inserted middle note and a break in the connected line',()=>{
  for(const [id,middle] of [[ids[0],64],[ids[1],50],[ids[2],65],[ids[3],52],[ids[4],53]]){const l=app.lessons.find(l=>l.id===id),bpm=52,beat=60000/bpm,steps=l.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))})),events=steps.flatMap(s=>[{type:'on',midi:s.midis[0],at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+1)*beat}]);
    const assess=e=>A.assessPiano({steps,events:e,bpm,targetBpm:bpm,profile:'legato'});assert.equal(assess(events).clean,true);
    const extra=[...events,{type:'on',midi:middle,at:1000+.5*beat,source:'midi'},{type:'off',midi:middle,at:1000+.7*beat}].sort((a,b)=>a.at-b.at);assert.equal(assess(extra).clean,false);
    const gap=events.map((e,i)=>e.type==='off'&&i<events.length-1?{...e,at:e.at-160}:e);assert.ok(assess(gap).articulationErrors>0);
  }
});
test('position-skip materials distinguish melodic thirds, final notes and a separate transfer trial',()=>{
  for(const [id,pair,last,quality] of [[ids[0],'D–F','F4','малая терция'],[ids[1],'C–E','E3','большая терция'],[ids[2],'E–G','G4','малая терция'],[ids[3],'D–F','F3','малая терция'],[ids[4],'E–G','G3','малая терция']]){
    const l=app.lessons.find(l=>l.id===id),html=D.materialHtml(l,'piano',String);assert.ok(l.learning.practiceSteps[0].includes('пропой '+pair));assert.ok(l.learning.practiceSteps[1].includes('Последнюю '+last+' удержи'));assert.ok(html.includes(quality));assert.match(html,/мелодический интервал/);assert.match(html,/Техническое упражнение проекта/);assert.match(html,/самостоятельная проба/);assert.match(html,/не фраза текущего зачёта/);assert.match(html,/The Open University: мелодические интервалы/);
  }
});
test('new lesson descriptions and personal changes survive the app export and reload',()=>{
  const a=loadApp(),snapshot=a.catalogSnapshot(),count=a.lessons.length;
  for(const id of [ids[0],ids[2],ids[3],ids[4]]){const raw=snapshot.lessons.find(l=>l.id===id);raw.title='Моя терция '+id;raw.learning.practiceSteps[0]='Мой разбор';}
  a.applyCatalogSnapshot(snapshot);
  assert.equal(a.lessons.length,count);for(const id of [ids[0],ids[2],ids[3],ids[4]]){assert.equal(a.lessons.find(l=>l.id===id).title,'Моя терция '+id);assert.equal(a.lessons.find(l=>l.id===id).learning.practiceSteps[0],'Мой разбор');}assert.equal(a.lessons.find(l=>l.id===ids[1]).learning.provenance.type,'project-technical-drill');assert.equal(a.installReviewedLessons(),false);
});

test('actual MIDI handler requires the last release and rejects the extra middle key in new finger pairs',()=>{
  for(const [id,notes,middle] of [[ids[2],[64,67,64,67],65],[ids[3],[50,53,50,53],52],[ids[4],[52,55,52,55],53]]){
    for(const extraMiddle of [false,true]){
      const clock={now:1000},a=loadApp({events:true,clock}),lesson=a.lessons.find(l=>l.id===id),beat=60000/52;
      a.setTestLesson(lesson);a.state.attemptMode='challenge';
      notes.forEach((midi,i)=>{
        clock.now=1000+i*beat;a.handleNoteOn(midi,'midi');
        if(i===0&&extraMiddle){clock.now+=.4*beat;a.handleNoteOn(middle,'midi');clock.now+=.1*beat;a.handleNoteOff(middle);}
        if(i===notes.length-1){assert.equal(a.state.completed,false);assert.equal(a.state.awaitingRelease,true);}
        clock.now=1000+(i+.98)*beat;a.handleNoteOff(midi);
      });
      assert.equal(a.state.completed,true);assert.equal(a.state.passed,!extraMiddle,id);a.resetLessonState();
    }
  }
});

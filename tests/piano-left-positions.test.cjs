'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),Catalog=require('../catalog-sections.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const expectations=[
  {id:'detail-p-left-g-position-01',notes:[[55],[59],[62],[59],[55]],digits:[[5],[3],[1],[3],[5]],starts:[0,1,2,4,6],durations:[1,1,2,2,2],precision:'beat-boundary-v1',profile:'legato'},
  {id:'detail-p-left-position-triad-01',notes:[[53],[57],[60],[53,57,60]],digits:[[5],[3],[1],[5,3,1]],starts:[0,1,2,3],durations:[1,1,1,1],precision:'beat-boundary-v2',profile:'standard'},
  {id:'detail-p-left-position-triad-02',notes:[[55],[59],[62],[55,59,62]],digits:[[5],[3],[1],[5,3,1]],starts:[0,1,2,3],durations:[1,1,1,1],precision:'beat-boundary-v2',profile:'standard'}
];
function input(a,e){const l=a.lessons.find(l=>l.id===e.id);return {steps:Array.from(l.rhythm.steps,(s,i)=>({...s,midis:Array.from(a.stepMidiList(l.steps[i]))})),bpm:48,targetBpm:48,profile:e.profile,timingPrecision:e.precision};}
function trace(e,mode='correct'){
  const beat=1250,events=[];
  e.notes.forEach((notes,i)=>notes.forEach((midi,j)=>{
    if(mode==='held-thumb'&&i===e.notes.length-1&&j===2)return;
    const on=1000+e.starts[i]*beat+(mode==='rolled'&&notes.length>1?j*100:0);
    let off=1000+(e.starts[i]+e.durations[i])*beat;
    if(mode==='early'&&i===e.notes.length-1)off-=beat/2;
    if(mode==='split'&&notes.length>1)off+=(j-1)*220;
    if(mode==='gap'&&i===0)off-=250;
    if(mode==='held-thumb'&&i===2)off=1000+4*beat;
    events.push({type:'on',midi,at:on,source:'midi'},{type:'off',midi,at:off});
  }));
  return events.sort((a,b)=>a.at-b.at);
}

test('G landmark and F/G construction use independently specified left-hand notes, fingers and complete bars',()=>{
  const a=loadApp();for(const e of expectations){const l=a.lessons.find(l=>l.id===e.id);assert.ok(l,e.id);
    assert.deepEqual(copy(Array.from(l.steps,a.stepMidiList)),e.notes);assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(f=>f.num))),e.digits);
    assert.ok(l.fingeringSpec.steps.flat().every(f=>f.hand==='left'));assert.equal(l.handMode,'left');
    assert.deepEqual(Array.from(l.rhythm.steps,s=>s.startBeat),e.starts);assert.deepEqual(Array.from(l.rhythm.steps,s=>s.durationBeats),e.durations);
    assert.equal(l.rhythm.practiceBpm,48);assert.equal(l.learning.timingPrecision,e.precision);assert.equal(l.learning.articulation,e.profile);
    assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,e.id.includes('g-position')?8:4);
    assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.provenance.author,'Упражнение проекта');
    a.state.lesson=l;assert.equal(a.challengeEligible(),true);assert.equal(a.ensureFingeringPlan().issues.length,0);
  }
});

test('preparation is playable by the left hand without requiring a right-hand F/G exercise or a piece',()=>{
  const a=loadApp(),get=id=>a.lessons.find(l=>l.id===id);
  assert.deepEqual(copy(get(expectations[0].id).learning.requires),['detail-p-relocate-04','detail-p-position-skips-05']);
  assert.deepEqual(copy(get(expectations[1].id).learning.requires),['detail-p-triads-02','detail-p-relocate-04']);
  assert.deepEqual(copy(get(expectations[2].id).learning.requires),[expectations[1].id,expectations[0].id]);
  for(const e of expectations)for(const id of get(e.id).learning.requires){assert.ok(get(id),id);assert.equal(Catalog.sectionOf('piano',get(id),a.themes),'learning');assert.notEqual(get(id).handMode,'right');}
});

test('assessment rejects wrong G landmark, missing chord thumb, arpeggiated attack and separated endings',()=>{
  const a=loadApp();for(const e of expectations){const score=input(a,e);assert.equal(A.assessPiano({...score,events:trace(e)}).clean,true,e.id);
    assert.equal(A.assessPiano({...score,events:trace(e,'early')}).clean,false);
    if(e.profile==='legato'){
      assert.equal(A.assessPiano({...score,events:trace(e,'gap')}).clean,false);
      assert.equal(A.assessPiano({...score,events:trace(e).map(v=>({...v,midi:v.midi===62?60:v.midi}))}).clean,false);
    }else for(const mode of ['held-thumb','rolled','split'])assert.equal(A.assessPiano({...score,events:trace(e,mode)}).clean,false,e.id+' '+mode);
  }
});

test('actual MIDI route waits for the final release and does not award a new chord for a held thumb',()=>{
  const clock={now:1000},a=loadApp({events:true,clock});
  for(const e of expectations)for(const mode of ['correct',...(e.profile==='standard'?['held-thumb','split']:['gap'])]){
    const l=a.lessons.find(l=>l.id===e.id),events=trace(e,mode);a.setTestLesson(l);a.state.attemptMode='challenge';
    for(const [i,event]of events.entries()){clock.now=event.at;if(event.type==='on')a.handleNoteOn(event.midi,'midi');else{if(i===events.length-1)assert.equal(a.state.completed,false,e.id);a.handleNoteOff(event.midi);}}
    assert.equal(a.state.completed,true,e.id+' '+mode);assert.equal(a.state.passed,mode==='correct',e.id+' '+mode);a.resetLessonState();
  }
});

test('catalog JSON preserves new music and personalized explanations without registering duplicates',async()=>{
  const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()});const ids=expectations.map(e=>e.id);
  const before=ids.map(id=>A.pianoSignature(a.lessons.find(l=>l.id===id)));const l=a.lessons.find(l=>l.id===ids[1]);l.title='Моя левая F-форма';l.learning.practiceSteps[0]='Моя подготовка';
  const total=a.lessons.length;assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);
  assert.equal(a.lessons.length,total);assert.equal(a.installReviewedLessons(),false);assert.equal(a.lessons.find(item=>item.id===l.id).title,'Моя левая F-форма');assert.equal(a.lessons.find(item=>item.id===l.id).learning.practiceSteps[0],'Моя подготовка');
  assert.deepEqual(ids.map(id=>A.pianoSignature(a.lessons.find(l=>l.id===id))),before);
});

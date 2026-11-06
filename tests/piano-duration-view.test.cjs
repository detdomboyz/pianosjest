'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const UI=require('../piano-learning-ui.js'),A=require('../practice-assessment.js'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),ids=['detail-p-release-02','detail-p-triads-02','detail-p-staccato-01'],fingerprints=['ae3ba34c','d0fdd9a4','f867d325'];

test('duration presenter names exact common values and dots with explicit note names',()=>{
 const expected=[[.125,'тридцать вторая'],[.1875,'тридцать вторая с точкой'],[.25,'шестнадцатая'],[.375,'шестнадцатая с точкой'],[.5,'восьмая'],[.75,'восьмая с точкой'],[1,'четверть'],[1.5,'четверть с точкой'],[2,'половинная'],[3,'половинная с точкой'],[4,'целая'],[6,'целая с точкой']];
 for(const[value,name]of expected){const view=UI.rhythmDurationView(value);assert.equal(view.valid,true);assert.equal(view.named,true);assert.ok(view.label.endsWith(' '+name));assert.ok(view.beatsText.length>0);assert.ok(view.symbol.length>0);assert.doesNotMatch(view.symbol,/\p{L}/u);}
 assert.equal(UI.rhythmDurationView(1).beatsText,'1 доля');assert.equal(UI.rhythmDurationView(2).beatsText,'2 доли');assert.equal(UI.rhythmDurationView(4).beatsText,'4 доли');
});

test('noncanonical project durations and longer holds remain numeric instead of nearest note values',()=>{
 for(const[value,text]of [[.3,'0,3 доли'],[.65,'0,65 доли'],[.85,'0,85 доли'],[1.25,'1,25 доли'],[3.85,'3,85 доли'],[4.5,'4,5 доли'],[8,'8 долей'],[11,'11 долей'],[21,'21 доля'],[22,'22 доли']]){const view=UI.rhythmDurationView(value);assert.equal(view.label,text);assert.equal(view.beatsText,text);assert.equal(view.named,false);assert.equal(view.valid,true);}
 const third=UI.rhythmDurationView(1/3);assert.equal(third.label,'≈0,333333 доли');assert.equal(third.named,false);assert.equal(UI.rhythmDurationView(.4999999999999).named,false);assert.match(UI.rhythmDurationView(.4999999999999).label,/^≈/);
});

test('malformed durations never masquerade as sixteenths and only machine arithmetic noise is tolerated',()=>{
 for(const value of [null,undefined,0,-1,NaN,Infinity,-Infinity,'0.5','<img onerror=bad()>',{},[],true])assert.deepEqual(UI.rhythmDurationView(value),{label:'Длительность не задана',beatsText:'',symbol:null,named:false,valid:false});
 assert.equal(UI.rhythmDurationView(.5+Number.EPSILON).named,true);for(const value of [.5-1e-10,.5+1e-10,1.49,1.51,.74,.76])assert.equal(UI.rhythmDurationView(value).named,false);
});

test('actual current target and score both show numeric durations for release, staccato and triad examples',()=>{
 for(const[id,text,ms]of [[ids[0],'0,65 доли',696],[ids[1],'0,85 доли',911],[ids[2],'0,3 доли',321]]){app.state.lesson=app.lessons.find(l=>l.id===id);app.state.stepIndex=0;app.state.mode='score';app.state.attemptMode='practice';const target=app.currentNoteHtml(),score=app.scoreViewHtml();assert.ok(target.includes(text+' ('+ms+' мс)'));assert.ok(score.includes('<span class="rhythm-duration">'+text+' · '+ms+' мс</span>'));assert.ok(score.includes('длительность '+text+' / '+ms+' мс'));assert.doesNotMatch(target,/восьмая|шестнадцатая|♩ четверть/);assert.doesNotMatch(score,/♪ восьмая|𝅘𝅥𝅯 шестнадцатая|♩ четверть/);}
});

test('dotted-quarter and whole-note targets retain correct named durations and numeric detail',()=>{
 for(const[id,index,name,beats]of [['course09-01',12,'четверть с точкой','1,5 доли'],['detail-p-left-half-01',0,'половинная','2 доли'],['detail-p-left-whole-01',0,'целая','4 доли'],['course08-06',0,'восьмая','0,5 доли']]){app.state.lesson=app.lessons.find(l=>l.id===id);app.state.stepIndex=index;app.state.attemptMode='practice';app.state.mode='score';const target=app.currentNoteHtml();assert.ok(target.includes(name+' ('+beats+', '));assert.ok(app.scoreViewHtml().includes(name));}
 // durationBeats are quarter-note units even when an imported meter uses eighths.
 const l=copy(app.lessons.find(l=>l.id==='course08-06'));l.rhythm.timeSignature={numerator:6,denominator:8};app.state.lesson=l;app.state.stepIndex=0;assert.match(app.currentNoteHtml(),/восьмая \(0,5 доли,/);
});

test('memory omits every duration hint regardless of the saved material preference',()=>{
 for(const id of ids){app.state.lesson=app.lessons.find(l=>l.id===id);app.state.stepIndex=0;app.state.attemptMode='memory';for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;assert.doesNotMatch(app.currentNoteHtml(),/0,65|0,85|0,3|696|911|321|длительность|восьмая|Ритм:/);assert.doesNotMatch(app.scoreViewHtml(),/rhythm-duration|rhythm-event|C3|E3|G3|696|911|321/);assert.equal(app.learningMaterialHtml(),'');}}
});

test('unchanged release and chord music still passes the real MIDI path with the same versioned credit',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});for(const[id,fp]of ids.map((id,i)=>[id,fingerprints[i]])){const l=a.lessons.find(l=>l.id===id),bpm=l.rhythm.bpm,beat=60000/bpm;assert.equal(A.pianoSignature(l),fp);a.setTestLesson(l);a.state.attemptMode='memory';const take=l.rhythm.steps.flatMap((s,i)=>Array.from(a.stepMidiList(l.steps[i])).flatMap(midi=>[{type:'on',midi,at:1000+s.startBeat*beat},{type:'off',midi,at:1000+(s.startBeat+s.durationBeats)*beat}])).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,true);let progress=A.record(undefined,{instrument:'piano',lessonId:id,fingerprint:fp,mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,true);a.resetLessonState();}
});

test('catalog roundtrip retains a personal rhythm and numeric views leave preview audio timing untouched',()=>{
 const a=loadApp(),snapshot=copy(a.catalogSnapshot()),personal=snapshot.lessons.find(l=>l.id===ids[0]);personal.description='Мой медленный разбор';personal.rhythm.steps[0].durationBeats=.625;const before=copy(personal);a.applyCatalogSnapshot(snapshot);assert.equal(a.installReviewedLessons(),false);const l=a.lessons.find(l=>l.id===ids[0]);assert.equal(l.description,before.description);assert.deepEqual(copy(l.rhythm),{...before.rhythm,steps:before.rhythm.steps.map((s,i)=>({...s,stepIndex:i}))});a.state.lesson=l;a.state.stepIndex=0;assert.match(a.currentNoteHtml(),/0,625 доли/);
 for(const id of ids){const lesson=a.lessons.find(l=>l.id===id),before=copy(lesson.rhythm);for(const bpm of [40,56,80])for(const[index,s]of lesson.rhythm.steps.entries())assert.ok(Math.abs(a.previewSoundDurationMs(lesson,index,bpm,60000/bpm)-s.durationBeats*60000/bpm)<1e-6);assert.deepEqual(copy(lesson.rhythm),before);}
});

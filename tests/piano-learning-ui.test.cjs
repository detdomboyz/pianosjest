'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const UI=require('../piano-learning-ui.js');
const {loadApp}=require('./helpers/load-app.cjs');
const UI_KEY='piano-blind-trainer-ui-v20';
test('same-goal guidance names the primary lesson once, escapes private text and remains absent in memory',()=>{
 assert.equal(UI.sameGoalHtml(null),'');assert.equal(UI.sameGoalHtml(undefined),'');
 const escaped=UI.sameGoalHtml({id:'x" onclick="bad',title:'<script>bad</script>'});assert.match(escaped,/&lt;script&gt;/);assert.match(escaped,/x&quot; onclick=&quot;bad/);assert.doesNotMatch(escaped,/<script>|data-learning-prerequisite="x"/);
 const a=loadApp();a.state.lesson=a.lessons.find(l=>l.id==='detail-p-chordmove-04');a.state.learningMaterialMode='compact';assert.match(a.learningMaterialHtml(),/Повторение навыка «Смена C–F–G–C»/);assert.doesNotMatch(a.learningMaterialHtml(),/learning-goal-relation/);
 a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();assert.match(html,/learning-goal-relation/);assert.equal((html.match(/data-learning-prerequisite="course08-05"/g)||[]).length,1);
 for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');}
 a.state.attemptMode='practice';a.state.learningMaterialMode='hidden';assert.equal(a.learningMaterialHtml(),'');a.state.lesson=a.lessons.find(l=>l.id==='course08-05');a.state.learningMaterialMode='expanded';assert.doesNotMatch(a.learningMaterialHtml(),/learning-goal-relation/);
});
function storage(initial={}){const data=new Map(Object.entries(initial));return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))};}

test('learning description modes validate persisted values and label the restore control',()=>{
  for(const bad of [null,undefined,0,{},'open','<script>'])assert.equal(UI.normalizeMode(bad),'compact');
  assert.equal(UI.normalizeMode('hidden'),'hidden');
  const html=UI.controlsHtml('hidden');
  assert.match(html,/aria-label="Вид учебного разбора"/);
  assert.match(html,/<option value="hidden" selected>Скрыто/);
  assert.match(html,/Кратко/);assert.match(html,/Развёрнуто/);
});

test('compact/hidden/memory do not build full guidance; expanded content has real links',()=>{
  let calls=0;const renderBody=()=>{calls++;return '<p>full guidance</p><a href="https://example.org">source</a>';};
  const html=UI.materialHtml({mode:'compact',preview:'<img onerror="alert(1)">\nPreparation',renderBody});
  assert.equal(calls,0);assert.match(html,/aria-expanded="false"/);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
  assert.equal(UI.materialHtml({mode:'hidden',renderBody}),'');
  assert.equal(UI.materialHtml({mode:'expanded',memory:true,renderBody}),'');
  assert.equal(calls,0);
  const full=UI.materialHtml({mode:'expanded',renderBody});
  assert.equal(calls,1);assert.match(full,/aria-expanded="true"/);
  assert.match(full,/<a href=/);assert.doesNotMatch(full,/<button[^>]*>[^]*<a[^]*<\/button>/);
});

test('actual app preserves other UI settings and progress while saving a global description choice',()=>{
  const saved=storage({[UI_KEY]:JSON.stringify({keyboardSize:88,showQwerty:false,learningMaterialMode:'hidden',futureSetting:'preserve'}),progress:'untouched'});
  const app=loadApp({storage:saved,events:true});
  assert.equal(app.state.learningMaterialMode,'hidden');assert.equal(app.state.keyboardSize,88);
  app.setLearningMaterialMode('expanded');
  const prefs=JSON.parse(saved.getItem(UI_KEY));
  assert.equal(prefs.learningMaterialMode,'expanded');assert.equal(prefs.futureSetting,'preserve');
  assert.equal(prefs.showQwerty,false);assert.equal(saved.getItem('progress'),'untouched');
  const reloaded=loadApp({storage:saved});assert.equal(reloaded.state.learningMaterialMode,'expanded');
});

test('actual app hides all guidance in a memory attempt and restores the saved display preference',()=>{
  const app=loadApp();app.state.lesson=app.lessons.find(l=>l.id==='detail-p-minor-triads-01');
  app.state.learningMaterialMode='expanded';
  assert.match(app.learningMaterialHtml(),/Автор \/ происхождение/);
  app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');
  assert.match(app.learningContractHtml(),/learning-material-mode[^>]*disabled/);
  assert.equal(app.state.learningMaterialMode,'expanded');
  app.state.attemptMode='practice';assert.match(app.learningMaterialHtml(),/Автор \/ происхождение/);
  app.state.learningMaterialMode='hidden';assert.equal(app.learningMaterialHtml(),'');
  assert.match(app.learningContractHtml(),/Вид учебного разбора/);
});

test('corrupt UI preferences can be replaced by a valid choice',()=>{
  const saved=storage({[UI_KEY]:'not json'});const app=loadApp({storage:saved,events:true});
  assert.equal(app.state.learningMaterialMode,'compact');app.setLearningMaterialMode('hidden');
  assert.equal(JSON.parse(saved.getItem(UI_KEY)).learningMaterialMode,'hidden');
});

test('native disclosure keys stay accessible while PC piano letters still work after focusing the card',t=>{
  const handlers={};const app=loadApp({events:true,onWindowEvent:(type,handler)=>{handlers[type]=handler;}});
  t.after(()=>{if(app.state.timer)clearInterval(app.state.timer);});
  let prevented=0;const buttonEvent={key:' ',code:'Space',target:{tagName:'BUTTON',closest:()=>({tagName:'BUTTON'})},preventDefault(){prevented++;}};
  handlers.keydown(buttonEvent);handlers.keyup(buttonEvent);
  handlers.keydown({...buttonEvent,key:'Enter',code:'Enter'});handlers.keyup({...buttonEvent,key:'Enter',code:'Enter'});
  assert.equal(app.state.stepIndex,0);assert.equal(app.state.active.size,0);assert.equal(app.state.errors,0);
  assert.equal(prevented,0,'browser must retain native button keyboard behavior');
  const pianoEvent={...buttonEvent,key:'t',code:'KeyT',target:{tagName:'DIV',closest:()=>null}};
  handlers.keydown(pianoEvent);handlers.keyup(pianoEvent);
  assert.equal(app.state.stepIndex,1,'PC piano input still works outside UI controls');
  const focusedCardEvent={...pianoEvent,target:buttonEvent.target};
  handlers.keydown(focusedCardEvent);handlers.keyup(focusedCardEvent);
  assert.equal(app.state.stepIndex,2,'PC piano letters work with focus on a disclosure control');
});

test('expanded guidance links to named preparation exercises and memory keeps those links out of the DOM',()=>{
  const a=loadApp();a.state.lesson=a.lessons.find(l=>l.id==='detail-p-left-position-triad-01');a.state.learningMaterialMode='expanded';
  const html=a.learningMaterialHtml();assert.match(html,/data-learning-prerequisite="detail-p-triads-02"/);assert.match(html,/Левая: собрать C major/);assert.match(html,/Левая: новая опора F3–A3–C4/);
  a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');
  const escaped=UI.preparationHtml([{id:'" onclick="bad()',title:'<img onerror=bad()>'}]);assert.match(escaped,/&quot;/);assert.match(escaped,/&lt;img/);assert.doesNotMatch(escaped,/<img| onclick="bad/);
});

test('memory masks the lesson title and catalog and returning to practice restores them without a carried note',()=>{
  const a=loadApp({events:true});a.state.lesson=a.lessons.find(l=>l.id==='detail-p-left-g-position-01');a.state.learningMaterialMode='expanded';a.state.active.add(55);
  a.setAttemptMode('memory');assert.equal(a.state.attemptMode,'memory');assert.equal(a.state.active.size,0);
  assert.equal(a.lessonTitle(),'Игра из памяти');assert.doesNotMatch(a.sidebarHtml(),/G3|B3|D4|data-lesson=/);assert.match(a.sidebarHtml(),/Вернуться к практике/);assert.equal(a.learningMaterialHtml(),'');
  a.setAttemptMode('practice');assert.equal(a.state.attemptMode,'practice');assert.match(a.lessonTitle(),/G3–B3–D4/);assert.match(a.sidebarHtml(),/data-lesson=/);assert.equal(a.state.learningMaterialMode,'expanded');assert.equal(a.state.passed,false);
});

test('repeated single-note targets request a new attack, exact timing replaces the legacy quick cue, and memory hides both',()=>{
  assert.equal(UI.repeatedNoteHtml([67],[64]),'');assert.equal(UI.repeatedNoteHtml([],[]),'');assert.equal(UI.repeatedNoteHtml([60,64],[60,64]),'');assert.match(UI.repeatedNoteHtml([67],[67]),/отпусти клавишу и нажми заново/);
  const a=loadApp();a.state.lesson=a.lessons.find(l=>l.id==='course08-06');a.state.stepIndex=3;
  assert.match(a.currentNoteHtml(),/Повтор звука/);assert.doesNotMatch(a.currentNoteHtml(),/быстро из фигурной группы/);assert.match(a.currentNoteHtml(),/восьмая/);
  a.state.stepIndex=2;assert.doesNotMatch(a.currentNoteHtml(),/Повтор звука/);a.state.stepIndex=3;
  assert.match(a.octaveChipsHtml(),/C4 начало октавы/);
  a.state.attemptMode='memory';assert.doesNotMatch(a.currentNoteHtml(),/Повтор звука|восьмая|G4|быстро из фигурной группы/);assert.equal(a.octaveChipsHtml(),'');
  a.state.attemptMode='practice';assert.match(a.octaveChipsHtml(),/C4 начало октавы/);a.state.lesson.rhythm=undefined;assert.match(a.currentNoteHtml(),/быстро из фигурной группы/);
});

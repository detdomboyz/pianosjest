'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{loadApp}=require('./helpers/load-app.cjs');
const A='detail-p-eighth-rest-middle-ring-left-g-01',B='detail-p-left-g-position-01';
// Delay the dependency used by the real boot; no browser navigation code is
// copied here. The corresponding successful12s HTTP delay is exercised in CUA.
async function pending(challenge=false){
 let app,index=0,release,reject,entered;const entries=[{url:'https://melodiajest.test/trainer.html?lesson='+A+(challenge?'&challenge=1':'')+'&qa=keep#score',state:{outside:'opaque'}}],calls=[],events=new Map(),data=new Map();
 const loading=new Promise((resolve,fail)=>{release=resolve;reject=fail;}),started=new Promise(resolve=>{entered=resolve;});
 const location={get href(){return entries[index].url;},get search(){return new URL(this.href).search;},protocol:'https:'};
 const history={get state(){return entries[index].state;},replaceState(state,_title,url){calls.push('replace');entries[index]={url,state};},pushState(state,_title,url){calls.push('push');entries.splice(index+1);entries.push({url,state});index++;}};
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},button={dataset:{learningPrerequisite:B}},focus={count:0,focus(){this.count++;}};
 const doc={addEventListener(){},getElementById(){return null;},querySelector:s=>s==='.lesson-name'?focus:null,querySelectorAll:s=>s==='[data-learning-prerequisite]'?[button]:[]};
 const client={storage,status:()=>({user:null,locked:false}),async init(){}};
 const gamePlayer={create(){return{mount(){},resetLocal(){},active(){return false;},async load(){entered();await loading;}};}};
 app=loadApp({events:true,serviceClient:client,gamePlayer,location,history,storage,document:doc,onWindowEvent:(type,fn)=>events.set(type,fn),console:{log(){},warn(){},error(){}},timers:{setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){}}});
 const boot=app.boot();await started;
 const go=delta=>{index+=delta;assert.ok(index>=0&&index<entries.length,'The initial A entry must remain available');events.get('popstate')({state:history.state});};
 const click=()=>{app.bindLearningMaterialControls();button.onclick();};
 return{app,location,history,entries,calls,focus,go,click,boot,release,reject};
}

test('ordinary prerequisite selection while the real boot awaits the route immediately pushes B and retains initial A',async()=>{
 const f=await pending();try{
  assert.equal(f.app.state.lesson.id,A);f.click();assert.equal(f.app.state.lesson.id,B);assert.equal(new URL(f.location.href).searchParams.get('lesson'),B);assert.deepEqual(f.calls,['replace','push']);assert.equal(f.entries.length,2);assert.equal(f.focus.count,1);
  f.go(-1);assert.equal(f.app.state.lesson.id,A);f.go(1);assert.equal(f.app.state.lesson.id,B);f.release();await f.boot;
  assert.deepEqual(f.calls,['replace','push'],'Finishing the route must not replace an entry after user navigation');assert.equal(f.entries.length,2);assert.equal(new URL(f.location.href).searchParams.get('qa'),'keep');assert.equal(new URL(f.location.href).hash,'#score');assert.deepEqual(f.history.state,{outside:'opaque'});
 }finally{f.release();await f.boot;}
});

test('challenge prerequisite selected during pending route clears its old query and Back restores the original entry before loading ends',async()=>{
 const f=await pending(true);try{
  const original=f.app.state.lesson,saved={cleanTakes:2,versions:{previous:{cleanTakes:1}}};f.app.state.learningProgress.synthetic=saved;f.app.state.active.add(57);f.app.state.pcPressedByCode.KeyE='e';f.app.state.started=true;f.app.state.attemptEvents=[{type:'on',midi:57,at:0}];f.click();
  assert.equal(f.app.state.lesson.id,B);assert.equal(new URL(f.location.href).searchParams.get('lesson'),B);assert.equal(new URL(f.location.href).searchParams.has('challenge'),false);assert.deepEqual(f.calls,['push']);assert.equal(f.app.state.active.size,0);assert.equal(f.app.state.started,false);assert.equal(f.app.state.attemptEvents.length,0);assert.equal(f.app.state.learningProgress.synthetic,saved);
  f.go(-1);assert.equal(f.app.state.lesson,original);assert.equal(new URL(f.location.href).searchParams.get('challenge'),'1');f.go(1);assert.equal(f.app.state.lesson.id,B);f.release();await f.boot;assert.deepEqual(f.calls,['push']);assert.equal(f.app.state.learningProgress.synthetic,saved);assert.equal(f.app.state.soundOn,false);
 }finally{f.release();await f.boot;}
});

test('a route-load failure after early selection preserves B and its Back entry without adding a late replacement',async()=>{
 const f=await pending();try{
  f.click();f.reject(Error('Synthetic route unavailable'));await f.boot;assert.equal(f.app.state.lesson.id,B);assert.equal(new URL(f.location.href).searchParams.get('lesson'),B);assert.match(f.app.state.message,/Маршрут временно недоступен/);assert.deepEqual(f.calls,['replace','push']);f.go(-1);assert.equal(f.app.state.lesson.id,A);f.go(1);assert.equal(f.app.state.lesson.id,B);assert.equal(f.entries.length,2);
 }finally{f.release();await f.boot;}
});

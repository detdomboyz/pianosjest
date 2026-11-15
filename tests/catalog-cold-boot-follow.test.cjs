'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{loadApp}=require('./helpers/load-app.cjs');
const RIGHT='detail-p-eighth-rest-thumb-middle-right-01',LEFT='detail-p-eighth-rest-thumb-middle-left-01';
// Execute the shipped async boot, render, selection and follower. The boundary
// models fresh DOM identity plus late row layout; actual CSS is checked in CUA.
function fixture({duringLoad,loadError=false,initialFollow=true}={}){
 const frames=[],quiet={log(){},warn(){},error(){}},storage={getItem(){return null;},setItem(){throw Error('No user-storage writes in boot regression');}};
 let app,side,late=false,complete=false,reads=0,privateCalls=0,rootWrites=0;
 const createSide=()=>{
  let top=0;const offset=complete?700:late?560:420;
  const active={getBoundingClientRect(){reads++;return{top:100+offset-top,bottom:180+offset-top,height:80};}};
  return{style:{},scrollHeight:1200,clientHeight:200,get scrollTop(){return top;},set scrollTop(value){top=value;},getBoundingClientRect(){return{top:100,bottom:300,height:200};},querySelector(){return active;},active};
 };
 const root={_html:'',get innerHTML(){return this._html;},set innerHTML(value){rootWrites++;this._html=value;side=createSide();}};
 const doc={documentElement:{style:{setProperty(){}}},activeElement:null,addEventListener(){},getElementById:id=>id==='app'?root:null,querySelector:s=>s==='.lessons'?side:null,querySelectorAll:()=>[]};
 const client={storage,status(){return{user:null,locked:false};},async init(){},async getObject(){privateCalls++;throw Error('Guest must not read private data');},async api(){privateCalls++;throw Error('No real network in boot regression');}};
 const gamePlayer={create(context){return{mount(){},resetLocal(){},invalidateAccount(){},active(){return false;},async load(){late=true;context.render();context.render();context.render();if(duringLoad)duringLoad({app,side,root,reads:()=>reads});complete=true;if(loadError)throw Error('Fixture route unavailable');}};}};
 app=loadApp({document:doc,storage,serviceClient:client,gamePlayer,search:'?lesson='+RIGHT,console:quiet,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},timers:{setTimeout(){return 0;},clearTimeout(){}}});
 app.state.keyWidthMode='manual';app.state.keyWidthInitialized=true;app.state.sidebarFollow=initialFollow;
 const flush=()=>{let n=0;while(frames.length){assert.ok(n++<20,'Initial correction must stay bounded');frames.shift()();}return n;};
 return{app,root,flush,side:()=>side,reads:()=>reads,privateCalls:()=>privateCalls,rootWrites:()=>rootWrites,inside(){const r=side.active.getBoundingClientRect();return r.top>=100&&r.bottom<=300;}};
}
test('final async boot render follows the selected row after intermediate DOM replacements',async()=>{
 const f=fixture();await f.app.boot();assert.ok(f.flush()<=8);assert.equal(f.app.state.lesson.id,RIGHT);assert.equal(f.inside(),true,'The final sidebar must get its own selected-row correction');assert.equal(f.app.state.sidebarScroll,f.side().scrollTop);assert.equal(f.app.state.sidebarFollowPending,false);assert.equal(f.privateCalls(),0);
});
test('turning follow off during initial loading preserves the manual sidebar position',async()=>{
 let before;const f=fixture({duringLoad({app,side,reads}){app.state.sidebarFollow=false;side.scrollTop=77;app.state.sidebarScroll=77;before=reads();}});await f.app.boot();f.flush();assert.equal(f.side().scrollTop,77);assert.equal(f.reads(),before);assert.equal(f.privateCalls(),0);
});
test('a changed search filter is not overridden by the final initial-load correction',async()=>{
 let before;const f=fixture({duringLoad({app,side,reads}){app.state.lessonFilter='левая';side.scrollTop=95;app.state.sidebarScroll=95;before=reads();}});await f.app.boot();f.flush();assert.equal(f.app.state.lessonFilter,'левая');assert.equal(f.side().scrollTop,95);assert.equal(f.reads(),before);
});
test('memory entered while initial loading is pending prevents old-row geometry reads',async()=>{
 let before;const f=fixture({duringLoad({app,reads}){app.state.attemptMode='memory';before=reads();}});await f.app.boot();f.flush();assert.equal(f.app.state.attemptMode,'memory');assert.equal(f.reads(),before);
});
test('account invalidation during initial loading keeps the privacy screen and blocks old geometry',async()=>{
 let before;const f=fixture({duringLoad({app,reads}){app.handleServiceAccountChange();before=reads();}});await f.app.boot();f.flush();assert.match(f.root.innerHTML,/Аккаунт или сессия изменились/);assert.equal(f.reads(),before);
});
test('the latest selected lesson is followed instead of restoring the old initial lesson',async()=>{
 const f=fixture({duringLoad({app}){app.selectLesson(LEFT);}});await f.app.boot();f.flush();assert.equal(f.app.state.lesson.id,LEFT);assert.equal(f.inside(),true);assert.equal(f.privateCalls(),0);
});
test('a temporary route-load failure still leaves the selected lesson visible',async()=>{
 const f=fixture({loadError:true});await f.app.boot();f.flush();assert.equal(f.app.state.lesson.id,RIGHT);assert.match(f.app.state.message,/Маршрут временно недоступен/);assert.equal(f.inside(),true);
});
test('initially disabled follow never starts a geometric correction during boot',async()=>{
 const f=fixture({initialFollow:false});await f.app.boot();assert.equal(f.flush(),0);assert.equal(f.reads(),0);assert.equal(f.side().scrollTop,0);assert.equal(f.app.state.sidebarFollow,false);
});

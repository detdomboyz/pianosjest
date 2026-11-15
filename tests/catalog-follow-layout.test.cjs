'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs');

// This boundary models a row whose height/position changes after layout.
// The actual shipped follow function runs; real rendering is checked in browser.
function fixture(){
 const frames=[];let offset=420,top=0,writes=0,currentSide,currentActive,geometryReads=0;
 const active={getBoundingClientRect(){geometryReads++;return{top:100+offset-top,bottom:180+offset-top,height:80};}};
 const side={style:{},scrollHeight:600,clientHeight:200,get scrollTop(){return top;},set scrollTop(v){top=v;writes++;},getBoundingClientRect(){return{top:100,bottom:300,height:200};},querySelector(){return currentActive;}};
 currentSide=side;currentActive=active;
 const root={innerHTML:''};const doc={documentElement:{style:{setProperty(){}}},getElementById:id=>id==='app'?root:null,querySelector:s=>s==='.lessons'?currentSide:null,querySelectorAll:()=>[],addEventListener(){}};
 const app=loadApp({document:doc,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},serviceClient:{storage:{getItem(){return null;},setItem(){throw Error('No private writes');}},status(){return{user:null,locked:false};}},timers:{setTimeout(){return 0;},clearTimeout(){}}});
 app.state.keyWidthMode='manual';app.state.sidebarFollow=true;app.state.sidebarFollowPending=true;
 const flush=()=>{let count=0;while(frames.length){assert.ok(count++<3,'Follow correction must be bounded');frames.shift()();}};
 return{app,side,active,frames,root,flush,grow(){offset=560;side.scrollHeight=800;},replaceSide(){currentSide={};},replaceActive(){currentActive={};},writes:()=>writes,geometryReads:()=>geometryReads,inside(){const r=active.getBoundingClientRect();return r.top>=100&&r.bottom<=300;}};
}

test('late offscreen row growth is corrected after layout and the selected row remains visible',()=>{
 const f=fixture();f.app.restoreSidebarPosition();assert.equal(f.side.scrollTop,360);
 f.grow();assert.equal(f.inside(),false);f.flush();
 assert.equal(f.inside(),true);assert.equal(f.side.scrollTop,f.app.state.sidebarScroll);
});
test('a row that stays visible receives no unnecessary second scroll write',()=>{
 const f=fixture();f.app.restoreSidebarPosition();const n=f.writes();f.flush();assert.equal(f.writes(),n);assert.equal(f.inside(),true);
});
test('a stale follow callback cannot scroll a replaced sidebar',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.grow();const n=f.writes();f.replaceSide();f.flush();assert.equal(f.writes(),n);
});
test('a stale follow callback cannot use a row replaced by search results',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.grow();const n=f.writes();f.replaceActive();f.flush();assert.equal(f.writes(),n);
});
test('a changed filter cancels the pending follow correction',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.grow();const n=f.writes();f.app.state.lessonFilter='левая';f.flush();assert.equal(f.writes(),n);
});
test('memory mode prevents a pending callback from reading the old lesson geometry',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.grow();f.app.state.attemptMode='memory';const n=f.geometryReads();f.flush();assert.equal(f.geometryReads(),n);
});
test('disabling follow cancels a pending post-layout scroll',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.grow();const n=f.writes();f.app.state.sidebarFollow=false;f.flush();assert.equal(f.writes(),n);
});
test('account invalidation blocks a pending follow callback even if an old row reference survives',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.grow();f.app.handleServiceAccountChange();const n=f.geometryReads();f.flush();assert.equal(f.geometryReads(),n);assert.match(f.root.innerHTML,/Аккаунт или сессия изменились/);
});

test('automatic keyboard fitting preserves the catalog/search DOM and updates its own width controls',()=>{
 const input={id:'lesson-search',selectionStart:4,selectionEnd:4},body={},width={value:'60'},value={textContent:'60px'},note={textContent:'',classList:{add(){}}};
 let rootWrites=0,keyboardWrites=0;const saved=[];
 const keyboard={clientWidth:720,get innerHTML(){return'';},set innerHTML(v){assert.match(v,/class="piano"/);keyboardWrites++;}};
 const root={get innerHTML(){return'';},set innerHTML(v){rootWrites++;doc.activeElement=body;}};
 const doc={activeElement:input,documentElement:{style:{setProperty(){}}},addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];},getElementById(id){return({'app':root,'keyboard-root':keyboard,'lesson-search':input,'key-width':width,'key-width-value':value,'keyboard-fit-status':note})[id]||null;}};
 const app=loadApp({document:doc,storage:{getItem(){return null;},setItem(key,text){saved.push({key,data:JSON.parse(text)});}}});
 app.state.keyWidth=60;app.state.keyWidthMode='auto';app.state.keyWidthInitialized=false;
 assert.equal(app.autoFitKeyboardWidth(false),true);
 assert.equal(rootWrites,0,'Fitting the keyboard must not replace search/results/player');assert.equal(doc.activeElement,input);assert.equal(input.selectionStart,4);
 assert.equal(keyboardWrites,1);assert.equal(width.value,String(app.state.keyWidth));assert.equal(value.textContent,app.state.keyWidth+'px');assert.match(note.textContent,new RegExp(String(app.state.keyWidth)+'px'));
 assert.equal(saved.at(-1).data.keyWidth,app.state.keyWidth,'The saved fit must contain the actual fitted width');
 assert.equal(app.autoFitKeyboardWidth(false),false);assert.equal(keyboardWrites,1);assert.equal(rootWrites,0);
});

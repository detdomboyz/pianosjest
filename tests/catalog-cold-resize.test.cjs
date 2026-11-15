'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{loadApp}=require('./helpers/load-app.cjs');
// Actual window resize handler and follow function;small DOM geometry boundary.
// Browser cold/warm resizing is checked separately without this fixture.
function fixture(){
 const frames=[],windowEvents=new Map();let offset=420,top=0,writes=0,reads=0,currentSide,currentActive;
 const active={getBoundingClientRect(){reads++;return{top:100+offset-top,bottom:180+offset-top,height:80};}};
 const side={style:{},scrollHeight:600,clientHeight:200,get scrollTop(){return top;},set scrollTop(v){top=v;writes++;},getBoundingClientRect(){return{top:100,bottom:300,height:200};},querySelector(){return currentActive;}};
 currentSide=side;currentActive=active;const input={value:'',selectionStart:0},player={},root={writes:0,_html:'',get innerHTML(){return this._html;},set innerHTML(v){this._html=v;this.writes++;}};
 const doc={documentElement:{style:{setProperty(){}}},getElementById:id=>({'app':root,'lesson-search':input,'game-player-root':player})[id]||null,querySelector:s=>s==='.lessons'?currentSide:null,querySelectorAll:()=>[],addEventListener(){}};
 const app=loadApp({document:doc,onWindowEvent:(type,fn)=>windowEvents.set(type,fn),requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},serviceClient:{storage:{getItem(){return null;},setItem(){throw Error('No private writes');}},status(){return{user:null,locked:false};}},timers:{setTimeout(){return 0;},clearTimeout(){}}});
 app.state.keyWidthMode='manual';app.state.sidebarFollow=true;app.state.sidebarFollowPending=true;
 const flush=()=>{let count=0;while(frames.length){assert.ok(count++<8,'Resize correction must be bounded,not a polling loop');frames.shift()();}return count;};
 app.restoreSidebarPosition();flush();
 return{app,side,frames,input,player,root,flush,resize:()=>windowEvents.get('resize')(),grow(){offset=560;side.scrollHeight=800;},replaceSide(){currentSide={};},replaceRow(){currentActive={};},reads:()=>reads,writes:()=>writes,inside(){const r=active.getBoundingClientRect();return r.top>=100&&r.bottom<=300;}};
}
test('cold width-dependent row shift is corrected by the actual resize event without replacing trainer DOM',()=>{
 const f=fixture(),lesson=f.app.state.lesson;f.grow();assert.equal(f.inside(),false);f.resize();assert.ok(f.frames.length>0,'Resize must schedule selected-row correction');assert.ok(f.flush()<=3);assert.equal(f.inside(),true);assert.equal(f.root.writes,0);assert.equal(f.app.state.lesson,lesson);assert.equal(f.app.state.sidebarScroll,f.side.scrollTop);assert.equal(f.app.state.sidebarFollowPending,false);
});
test('rapid resize events coalesce before reading or scrolling selected-row geometry',()=>{
 const f=fixture();f.grow();const reads=f.reads(),writes=f.writes();f.resize();f.resize();f.resize();assert.equal(f.reads(),reads);f.frames.shift()();f.frames.shift()();assert.equal(f.reads(),reads);assert.equal(f.writes(),writes);assert.ok(f.flush()<=3);assert.equal(f.inside(),true);
});
test('follow disabled preserves the manually scrolled sidebar and schedules no correction',()=>{
 const f=fixture();f.grow();f.app.state.sidebarFollow=false;f.side.scrollTop=95;const reads=f.reads(),writes=f.writes();f.resize();f.flush();assert.equal(f.reads(),reads);assert.equal(f.writes(),writes);assert.equal(f.side.scrollTop,95);
});
test('changing the filter cancels a queued resize before geometry reads',()=>{
 const f=fixture();f.grow();f.resize();f.app.state.lessonFilter='левая';const reads=f.reads(),writes=f.writes();f.flush();assert.equal(f.reads(),reads);assert.equal(f.writes(),writes);
});
test('memory hides the old row before a pending resize can inspect its geometry',()=>{
 const f=fixture();f.grow();f.resize();f.app.state.attemptMode='memory';const reads=f.reads();f.flush();assert.equal(f.reads(),reads);
});
test('account invalidation cancels pending resize and keeps the authoritative privacy screen',()=>{
 const f=fixture();f.grow();f.resize();f.app.handleServiceAccountChange();const reads=f.reads(),writes=f.writes();f.flush();assert.equal(f.reads(),reads);assert.equal(f.writes(),writes);assert.match(f.root.innerHTML,/Аккаунт или сессия изменились/);
});
test('replacing a sidebar or filtered row cancels stale resize callbacks',()=>{
 for(const change of ['replaceSide','replaceRow']){const f=fixture();f.grow();f.resize();f[change]();const reads=f.reads(),writes=f.writes();f.flush();assert.equal(f.reads(),reads,change);assert.equal(f.writes(),writes,change);}
});
test('selecting a different lesson cancels the old resize correction',()=>{
 const f=fixture();f.grow();f.resize();f.app.state.lesson=f.app.lessons.find(l=>l.id!==f.app.state.lesson.id);const reads=f.reads(),writes=f.writes();f.flush();assert.equal(f.reads(),reads);assert.equal(f.writes(),writes);
});

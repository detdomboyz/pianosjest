'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{loadApp}=require('./helpers/load-app.cjs');
// A bounded DOM/geometry boundary,not a browser layout simulator. The actual
// shipped input handler,filter,partial renderer and follower run unchanged.
function fixture({section='learning',raf=true,fullOffset=600}={}){
 const frames=[];let app,currentSide,currentRow,currentHeader,offset=fullOffset,top=0,reads=0,writes=0,extent=1000;
 const body={},input={id:'lesson-search',tagName:'INPUT',value:'',selectionStart:0,selectionEnd:0},tip={innerHTML:''};
 const header=()=>({getBoundingClientRect(){reads++;return{top:100,bottom:150,height:50};}}),row=()=>({dataset:{lesson:app.state.lesson.id},closest(){return{querySelector:()=>currentHeader};},getBoundingClientRect(){reads++;return{top:100+offset-top,bottom:160+offset-top,height:60};}});
 const side={style:{},_html:'',get scrollHeight(){return extent;},clientHeight:200,get scrollTop(){return top;},set scrollTop(v){top=Math.max(0,Math.min(Number(v)||0,Math.max(0,extent-200)));writes++;},getBoundingClientRect(){reads++;return{top:100,bottom:300,height:200};},querySelector(){return currentRow;},get innerHTML(){return this._html;},set innerHTML(value){this._html=value;const ids=[...value.matchAll(/data-lesson="([^"]+)"/g)].map(x=>x[1]);extent=ids.length>1?1000:200;offset=ids.length>1?fullOffset:80;top=Math.max(0,Math.min(top,Math.max(0,extent-200)));currentHeader=header();currentRow=ids.includes(app.state.lesson.id)?row():null;}};
 const root={writes:0,_html:'',get innerHTML(){return this._html;},set innerHTML(v){this._html=v;this.writes++;doc.activeElement=body;}};
 const doc={activeElement:input,documentElement:{style:{setProperty(){}}},addEventListener(){},getElementById:id=>({'app':root,'lesson-search':input})[id]||null,querySelector:s=>s==='.lessons'?currentSide:s==='.drag-tip'?tip:null,querySelectorAll:()=>[]};
 currentSide=side;app=loadApp({document:doc,requestAnimationFrame:raf?fn=>{frames.push(fn);return frames.length;}:undefined,serviceClient:{storage:{getItem(){return null;},setItem(){throw Error('No private writes');}},status(){return{user:null,locked:false};}},timers:{setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){}}});app.state.lesson=app.lessons.find(l=>l.id===(section==='pieces'?'chopin-midi-final':'detail-p-improv-three-key-answer-left-01'));assert.ok(app.state.lesson);app.state.contentSection=section;app.state.keyWidthMode='manual';app.state.sidebarFollow=true;app.state.sidebarFollowPending=false;currentHeader=header();currentRow=row();app.bindAfterRender();
 const type=value=>{input.value=value;input.selectionStart=input.selectionEnd=value.length;doc.activeElement=input;input.oninput({target:input});};
 const flush=()=>{let count=0;while(frames.length){assert.ok(count++<8,'Search correction must be bounded');frames.shift()();}return count;};
 return{app,doc,input,side,root,frames,type,flush,clear(){type(app.state.lesson.title);type('');},reads:()=>reads,writes:()=>writes,inside:()=>100+offset-top>=150&&160+offset-top<=300,replaceSide(){currentSide={};},replaceRow(){currentRow={};},replaceHeader(){currentHeader=header();}};
}
test('clearing a selected-title search follows the actual row while retaining input,caret and trainer DOM',()=>{
 const f=fixture(),lesson=f.app.state.lesson;f.clear();assert.equal(f.reads(),0,'Correction waits for its frame');assert.ok(f.frames.length>0,'Clearing must schedule the bounded follower');assert.ok(f.flush()<=3);assert.ok(f.inside());assert.equal(f.app.state.sidebarScroll,f.side.scrollTop);assert.equal(f.app.state.lesson,lesson);assert.equal(f.root.writes,0);assert.equal(f.doc.activeElement,f.input);assert.equal(f.input.selectionStart,0);assert.equal(f.app.state.sidebarFollowPending,false);
});
test('ordinary queries and unchanged empty events do not schedule follow or replace trainer DOM',()=>{
 const f=fixture();for(const query of ['','левая',f.app.state.lesson.title,f.app.state.lesson.title])f.type(query);assert.equal(f.frames.length,0);assert.equal(f.reads(),0);assert.equal(f.root.writes,0);assert.equal(f.doc.activeElement,f.input);assert.equal(f.input.selectionStart,f.app.state.lesson.title.length);
});
test('a clear through intermediate whitespace coalesces and does not lose the final callback',()=>{
 const f=fixture();f.type(f.app.state.lesson.title);f.type('  ');f.type('');assert.ok(f.frames.length>=1,'Whitespace clear must leave a valid callback');const writes=f.writes();if(f.frames.length>1){f.frames.shift()();assert.equal(f.reads(),0);assert.equal(f.writes(),writes);}assert.ok(f.flush()<=3);assert.ok(f.inside());assert.equal(f.doc.activeElement,f.input);assert.equal(f.input.selectionStart,0);
});
test('rapid query-clear cycles cancel the stale callback before geometry and perform one correction',()=>{
 const f=fixture();f.clear();f.clear();assert.ok(f.frames.length>=2,'Both clear events must queue their tickets');const writes=f.writes();f.frames.shift()();assert.equal(f.reads(),0);assert.equal(f.writes(),writes);assert.ok(f.flush()<=3);assert.ok(f.inside());assert.equal(f.writes(),writes+1,'Only final centering writes scrollTop');
});
test('turning off follow and invisible foreign-section rows cause no geometry correction',()=>{
 const off=fixture();off.app.state.sidebarFollow=false;off.clear();off.flush();assert.equal(off.reads(),0);assert.equal(off.side.scrollTop,0);const foreign=fixture();foreign.app.state.contentSection='pieces';foreign.type('not-found-166');foreign.type('');foreign.flush();assert.equal(foreign.reads(),0);assert.equal(foreign.app.state.lesson.id,'detail-p-improv-three-key-answer-left-01');assert.ok(!foreign.side.innerHTML.includes('data-lesson="detail-p-improv-three-key-answer-left-01"'));
});
test('memory,account,lesson,filter and section changes cancel queued search follow before geometry',()=>{
 for(const change of ['memory','account','lesson','filter','section']){const f=fixture();f.clear();assert.ok(f.frames.length>0,'Clear must create a callback before '+change);if(change==='memory')f.app.state.attemptMode='memory';if(change==='account')f.app.handleServiceAccountChange();if(change==='lesson')f.app.state.lesson=f.app.lessons.find(l=>l.id==='course01-01');if(change==='filter')f.app.state.lessonFilter='новый поиск';if(change==='section')f.app.state.contentSection='pieces';const reads=f.reads(),writes=f.writes();f.flush();assert.equal(f.reads(),reads,change);assert.equal(f.writes(),writes,change);if(change==='account')assert.match(f.root.innerHTML,/Аккаунт или сессия изменились/);}
});
test('replacement sidebar,row or own header invalidates a pending clear correction',()=>{
 for(const method of ['replaceSide','replaceRow','replaceHeader']){const f=fixture();f.clear();assert.ok(f.frames.length>0);f[method]();const reads=f.reads(),writes=f.writes();f.flush();assert.equal(f.reads(),reads,method);assert.equal(f.writes(),writes,method);}
});
test('the post-layout correction cancels when the section changes without touching old geometry',()=>{
 const f=fixture();f.app.state.sidebarFollowPending=true;f.app.restoreSidebarPosition();assert.ok(f.frames.length>0);const reads=f.reads(),writes=f.writes();f.app.state.contentSection='pieces';f.flush();assert.equal(f.reads(),reads);assert.equal(f.writes(),writes);
});
test('pieces use the same bounded clear path and the no-RAF fallback stays clamped',()=>{
 const pieces=fixture({section:'pieces'}),id=pieces.app.state.lesson.id;pieces.clear();assert.ok(pieces.frames.length>0);pieces.flush();assert.ok(pieces.inside());assert.equal(pieces.app.state.contentSection,'pieces');assert.equal(pieces.app.state.lesson.id,id);const fallback=fixture({raf:false,fullOffset:920});fallback.clear();assert.equal(fallback.frames.length,0);assert.ok(fallback.inside());assert.equal(fallback.side.scrollTop,800);assert.equal(fallback.app.state.sidebarScroll,800);
});

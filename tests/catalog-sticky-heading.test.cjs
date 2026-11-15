'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{loadApp}=require('./helpers/load-app.cjs');
// Run the shipped follower and resize handler. This boundary represents the
// documented160 overlap; real current browser cases are recorded separately.
function fixture({headerHeight=60,headerTop=90,rowHeight=98,offset=420,headerPresent=true}={}){
 const frames=[],events=new Map();let top=0,writes=0,rowReads=0,headerReads=0,currentSide,currentRow,currentHeader;
 const header={getBoundingClientRect(){headerReads++;return{top:headerTop,bottom:headerTop+headerHeight,height:headerHeight};}};
 const group={querySelector(selector){assert.equal(selector,'.theme-row');return currentHeader;}};
 const row={closest(selector){assert.equal(selector,'.theme-group');return headerPresent?group:null;},getBoundingClientRect(){rowReads++;return{top:100+offset-top,bottom:100+offset-top+rowHeight,height:rowHeight};}};
 const side={style:{},scrollHeight:2000,clientHeight:360,get scrollTop(){return top;},set scrollTop(value){top=value;writes++;},getBoundingClientRect(){return{top:100,bottom:460,height:360};},querySelector(selector){assert.equal(selector,'.lesson-btn.active');return currentRow;}};
 currentSide=side;currentRow=row;currentHeader=header;const root={innerHTML:''};
 const document={documentElement:{style:{setProperty(){}}},addEventListener(){},getElementById:id=>id==='app'?root:null,querySelector:s=>s==='.lessons'?currentSide:null,querySelectorAll:()=>[]};
 const app=loadApp({document,onWindowEvent:(event,fn)=>events.set(event,fn),requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},serviceClient:{storage:{getItem(){return null;},setItem(){throw Error('No private writes');}},status(){return{user:null,locked:false};}},timers:{setTimeout(){return 0;},clearTimeout(){}}});
 app.state.keyWidthMode='manual';app.state.sidebarFollow=true;app.state.sidebarFollowPending=true;
 const flush=()=>{let n=0;while(frames.length){assert.ok(n++<8,'A correction must remain bounded');frames.shift()();}return n;};
 return{app,side,row,header,root,frames,flush,resize:()=>events.get('resize')(),shift(delta){offset+=delta;},replaceHeader(){currentHeader={};},replaceSide(){currentSide={};},replaceRow(){currentRow={};},reads:()=>({row:rowReads,header:headerReads}),writes:()=>writes,position:()=>({top:100+offset-top,bottom:100+offset-top+rowHeight}),headerBottom:()=>headerTop+headerHeight};
}
test('an inside-list row moved beneath a two-line sticky heading gets one bounded correction',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.shift(-110);assert.ok(f.position().top>=100&&f.position().bottom<=460);assert.ok(f.position().top<f.headerBottom());const n=f.writes();assert.equal(f.flush(),2);assert.equal(f.writes(),n+1);assert.ok(f.position().top>=f.headerBottom());assert.ok(f.position().bottom<=460);assert.equal(f.app.state.sidebarScroll,f.side.scrollTop);
});
test('a shorter sticky heading is measured rather than assigned the two-line height',()=>{
 const f=fixture({headerHeight:40});f.app.restoreSidebarPosition();f.shift(-110);f.flush();assert.ok(f.position().top>=130);assert.ok(f.position().bottom<=460);
});
test('a row taller than the available area keeps its beginning below the heading',()=>{
 const f=fixture({headerHeight:300});f.app.restoreSidebarPosition();f.flush();assert.equal(f.position().top,390);assert.ok(f.side.scrollTop>=0);assert.equal(f.frames.length,0);
});
test('a heading wholly below the viewport does not shrink the currently visible area',()=>{
 const f=fixture({headerTop:500});f.app.restoreSidebarPosition();const n=f.writes();f.flush();assert.equal(f.writes(),n);
});
test('a heading wholly above the viewport does not produce an unnecessary correction',()=>{
 const f=fixture({headerTop:-60,headerHeight:40});f.app.restoreSidebarPosition();const n=f.writes();f.flush();assert.equal(f.writes(),n);
});
test('the no-heading catalog fallback preserves a row already inside the list',()=>{
 const f=fixture({headerPresent:false});f.app.restoreSidebarPosition();f.shift(-110);const n=f.writes();f.flush();assert.equal(f.writes(),n);assert.ok(f.position().top>=100);
});
test('a row already visible below its own heading receives no second write',()=>{
 const f=fixture();f.app.restoreSidebarPosition();const n=f.writes();f.flush();assert.equal(f.writes(),n);
});
test('replacing only the heading cancels a pending correction before row or heading geometry',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.shift(-110);f.replaceHeader();const reads=f.reads(),n=f.writes();f.flush();assert.deepEqual(f.reads(),reads);assert.equal(f.writes(),n);
});
test('a queued resize with a replaced heading is stale before its first geometry read',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.flush();f.resize();f.replaceHeader();const reads=f.reads(),n=f.writes();f.flush();assert.deepEqual(f.reads(),reads);assert.equal(f.writes(),n);
});
test('privacy,selection,filter and DOM replacement guards run before heading geometry',()=>{
 for(const change of ['memory','follow-off','filter','lesson','account','sidebar','row']){const f=fixture();f.app.restoreSidebarPosition();f.shift(-110);if(change==='memory')f.app.state.attemptMode='memory';if(change==='follow-off')f.app.state.sidebarFollow=false;if(change==='filter')f.app.state.lessonFilter='левая';if(change==='lesson')f.app.state.lesson=f.app.lessons.find(l=>l.id!==f.app.state.lesson.id);if(change==='account')f.app.handleServiceAccountChange();if(change==='sidebar')f.replaceSide();if(change==='row')f.replaceRow();const reads=f.reads(),n=f.writes();f.flush();assert.deepEqual(f.reads(),reads,change);assert.equal(f.writes(),n,change);}
});
test('rapid resizes retain ticket coalescing before any current row or header geometry',()=>{
 const f=fixture();f.app.restoreSidebarPosition();f.flush();f.shift(-110);const reads=f.reads(),n=f.writes();f.resize();f.resize();f.resize();f.frames.shift()();f.frames.shift()();assert.deepEqual(f.reads(),reads);assert.equal(f.writes(),n);assert.ok(f.flush()<=3);assert.ok(f.position().top>=f.headerBottom());assert.equal(f.app.state.sidebarFollowPending,false);
});
test('a correction at the start of the scroll range remains clamped and finite',()=>{
 const f=fixture({offset:30});f.app.restoreSidebarPosition();assert.ok(f.flush()<=2);assert.equal(f.side.scrollTop,0);assert.equal(f.app.state.sidebarScroll,0);
});

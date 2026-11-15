'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs');
const {createHash}=require('node:crypto');
function catalogHash(app){const {savedAt,...data}=app.catalogSnapshot();return createHash('sha256').update(JSON.stringify(data)).digest('hex');}

// Deliberately small DOM boundary,not a browser or layout simulator. The actual
// shipped renderer/filter/handlers run; any full-app replacement loses focus.
function fixture({guest=false}={}){
  const body={tagName:'BODY'},input={id:'lesson-search',tagName:'INPUT',value:'',selectionStart:0,selectionEnd:0};
  const row={dataset:{lesson:'course01-01'}},edit={dataset:{editLesson:'course01-01'},setAttribute(){}},drag={draggable:true,setAttribute(){},addEventListener(){}};
  const side={scrollTop:37,scrollHeight:1000,clientHeight:200,style:{},querySelector(){return null;},writes:0,_html:'',set innerHTML(value){this._html=value;this.writes++;},get innerHTML(){return this._html;}};
  const tip={innerHTML:''},root={writes:0,_html:'',set innerHTML(value){this._html=value;this.writes++;doc.activeElement=body;},get innerHTML(){return this._html;}};
  const doc={activeElement:input,documentElement:{style:{setProperty(){}}},addEventListener(){},getElementById:id=>id==='app'?root:id==='lesson-search'?input:null,
    querySelector:selector=>selector==='.lessons'?side:selector==='.drag-tip'?tip:null,
    querySelectorAll(selector){if(selector==='[data-lesson]')return[row];if(selector==='[data-edit-lesson]')return[edit];if(selector==='[data-edit-theme],[data-edit-lesson],.drag-handle')return[edit,drag];return[];}};
  const app=loadApp({document:doc,serviceClient:guest?{storage:{getItem(){return null;},setItem(){throw Error('Guest fixture must not persist');}},status(){return{user:null,locked:false};}}:null,timers:{setTimeout(){return 0;},clearTimeout(){}}});
  app.state.keyWidthMode='manual';app.state.guidedPath=true;app.bindAfterRender();
  const type=value=>{input.value=value;input.selectionStart=input.selectionEnd=value.length;doc.activeElement=input;input.oninput({target:input});};
  return{app,doc,input,side,tip,root,row,edit,drag,type};
}

test('search input retains focus/caret and leaves the selected trainer DOM untouched',()=>{
  const f=fixture(),lesson=f.app.state.lesson,version=catalogHash(f.app);
  f.type('пауза');
  assert.equal(f.root.writes,0,'Search must not replace the whole app');
  assert.equal(f.doc.activeElement,f.input);assert.equal(f.input.selectionStart,5);assert.equal(f.input.selectionEnd,5);
  assert.equal(f.side.writes,1);assert.match(f.side.innerHTML,/data-lesson="detail-p-eighth-rest-offbeat-left-01"/);
  assert.equal(f.app.state.lesson,lesson);assert.equal(catalogHash(f.app),version);
});

test('repeated queries use actual section filter/order and recover from no matches',()=>{
  const f=fixture();
  for(const section of ['learning','pieces'])for(const guided of [true,false]){
    f.app.state.contentSection=section;f.app.state.guidedPath=guided;
    for(const query of ['пауза','левая','zz-not-found-113','']){
      f.type(query);
      const expected=f.app.filteredCatalog().flatMap(g=>g.lessons.map(l=>l.id));
      const actual=[...f.side.innerHTML.matchAll(/data-lesson="([^"]+)"/g)].map(m=>m[1]);
      assert.deepEqual(actual,Array.from(expected),section+'/'+guided+'/'+query);
      if(!expected.length)assert.match(f.side.innerHTML,/Ничего не найдено/);
      assert.equal(f.root.writes,0);assert.equal(f.app.state.sidebarFollowPending,false);
    }
  }
});

test('refreshed rows remain selectable and guest edit/drag controls remain disabled',()=>{
  const f=fixture({guest:true});f.type('пауза');
  assert.equal(typeof f.row.onclick,'function');assert.equal(typeof f.edit.onclick,'function');
  assert.equal(f.edit.disabled,true);assert.equal(f.drag.disabled,true);assert.equal(f.drag.draggable,false);
  f.type('');assert.equal(f.edit.disabled,true);assert.equal(f.drag.draggable,false);
  assert.equal(f.root.writes,0);
});

test('free-order drag help follows the query without rebuilding the trainer',()=>{
  const f=fixture();f.app.state.guidedPath=false;
  f.type('пауза');assert.match(f.tip.innerHTML,/Очисти строку поиска/);assert.match(f.side.innerHTML,/draggable="false"/);
  f.type('');assert.doesNotMatch(f.tip.innerHTML,/Очисти строку поиска/);assert.match(f.side.innerHTML,/draggable="true"/);
});

test('a stale search event in memory mode uses the full hidden-hints renderer',()=>{
  const f=fixture();f.app.state.attemptMode='memory';f.type('пауза');
  assert.equal(f.root.writes,1);assert.equal(f.side.writes,0);
  assert.doesNotMatch(f.root.innerHTML,/id="lesson-search"|data-lesson="|C4|D4/);
});

test('a stale search event after account invalidation cannot repopulate results',()=>{
  const f=fixture({guest:true});f.app.handleServiceAccountChange();const before=f.root.writes;
  f.type('пауза');assert.equal(f.root.writes,before+1);assert.equal(f.side.writes,0);
  assert.match(f.root.innerHTML,/Аккаунт или сессия изменились/);assert.doesNotMatch(f.root.innerHTML,/data-lesson="/);
});
